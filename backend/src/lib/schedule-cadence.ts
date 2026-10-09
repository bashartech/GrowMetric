import type { ReportScheduleFrequency } from "@prisma/client";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * Cron field bounds, in the order the expression is written:
 * minute, hour, day-of-month, month, day-of-week.
 */
const FIELDS = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  // 7 is an accepted alias for Sunday and normalised away after parsing.
  { min: 0, max: 7 },
] as const;

/** Cron treats both 0 and 7 as Sunday. */
const DAY_OF_WEEK_ALIASES = new Set([0, 7]);

/** Four years of days — past any real cron expression's next match. */
const MAX_DAYS_AHEAD = 1500;

/**
 * Expands one cron field into the set of values it matches.
 *
 * Supports `*`, single values, ranges (`1-5`), lists (`1,3,5`) and steps
 * (`*\/15`, `1-30\/5`).
 */
function parseField(field: string, index: number): Set<number> | null {
  const { min, max } = FIELDS[index]!;
  const values = new Set<number>();

  for (const part of field.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    if (!rangePart) return null;

    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) return null;

    let start: number = min;
    let end: number = max;
    if (rangePart !== "*") {
      const bounds = rangePart.split("-");
      if (bounds.length > 2) return null;
      start = Number(bounds[0]);
      end = bounds.length === 2 ? Number(bounds[1]) : start;
      if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
    }

    if (start < min || end > max || start > end) return null;

    for (let value = start; value <= end; value += step) {
      values.add(value);
    }
  }

  return values.size > 0 ? values : null;
}

export interface ParsedCron {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  /** True when the day-of-month field is unrestricted (`*`). */
  dayOfMonthWildcard: boolean;
  /** True when the day-of-week field is unrestricted (`*`). */
  dayOfWeekWildcard: boolean;
}

/**
 * Parses a standard 5-field cron expression. Returns `null` for anything it
 * cannot understand so callers can fall back rather than silently scheduling
 * the wrong time.
 */
export function parseCron(expression: string): ParsedCron | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields as [
    string, string, string, string, string,
  ];

  const minutes = parseField(minute, 0);
  const hours = parseField(hour, 1);
  const daysOfMonth = parseField(dayOfMonth, 2);
  const months = parseField(month, 3);
  const daysOfWeek = parseField(dayOfWeek, 4);

  if (!minutes || !hours || !daysOfMonth || !months || !daysOfWeek) return null;

  const normalizedDaysOfWeek = new Set<number>();
  for (const day of daysOfWeek) {
    normalizedDaysOfWeek.add(DAY_OF_WEEK_ALIASES.has(day) ? 0 : day);
  }

  return {
    minutes,
    hours,
    daysOfMonth,
    months,
    daysOfWeek: normalizedDaysOfWeek,
    dayOfMonthWildcard: dayOfMonth === "*",
    dayOfWeekWildcard: dayOfWeek === "*",
  };
}

/**
 * Cron's day rule: when *both* day fields are restricted the match is a union
 * (either may fire), which is what users expect from `0 9 1 * 1`. When only one
 * is restricted, it is the only rule that applies.
 */
function matchesDay(cron: ParsedCron, calendar: Date): boolean {
  const dayOfMonthMatch = cron.daysOfMonth.has(calendar.getUTCDate());
  const dayOfWeekMatch = cron.daysOfWeek.has(calendar.getUTCDay());

  if (cron.dayOfMonthWildcard && cron.dayOfWeekWildcard) return true;
  if (cron.dayOfMonthWildcard) return dayOfWeekMatch;
  if (cron.dayOfWeekWildcard) return dayOfMonthMatch;
  return dayOfMonthMatch || dayOfWeekMatch;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

/** The wall-clock time in `timeZone` at the given instant. */
function wallClockIn(instant: Date, timeZone: string): WallClock {
  const parts = zoneFormatter(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    return found ? Number(found.value) : 0;
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    // `h23` can still emit "24" for midnight in some ICU versions.
    hour: read("hour") % 24,
    minute: read("minute"),
  };
}

/** How far `timeZone` is ahead of UTC at `instant`, in milliseconds. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = wallClockIn(instant, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  // Drop the seconds the formatter truncated so the offset stays a whole minute.
  return asUtc - Math.floor(instant.getTime() / MINUTE_MS) * MINUTE_MS;
}

/**
 * The instant at which `timeZone` reads the given wall-clock time.
 *
 * Two passes because the offset depends on the instant we are solving for: a
 * single pass lands on the wrong side of a DST transition for roughly one hour
 * twice a year.
 */
function instantForWallClock(parts: WallClock, timeZone: string): Date {
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const firstOffset = zoneOffsetMs(new Date(asUtc), timeZone);
  const candidate = asUtc - firstOffset;
  const secondOffset = zoneOffsetMs(new Date(candidate), timeZone);
  return new Date(secondOffset === firstOffset ? candidate : asUtc - secondOffset);
}

/**
 * The next instant strictly after `from` that satisfies `expression`.
 * Returns `null` when the expression is unparseable or has no match in range.
 *
 * Iteration is day-then-hour-then-minute rather than minute-by-minute: a
 * minute-stepping scan of four years would be ~2M checks per call. The cursor
 * is a UTC-backed pseudo-date holding *wall-clock* fields, so day-of-week and
 * day-of-month are evaluated against the schedule's timezone rather than the
 * server's — otherwise the same schedule fires at a different time depending on
 * whether it runs in UTC (Hugging Face) or a local dev container.
 */
export function nextCronOccurrence(
  expression: string,
  from: Date,
  timeZone = "UTC",
): Date | null {
  const cron = parseCron(expression);
  if (!cron) return null;

  let zone: string;
  try {
    zoneFormatter(timeZone);
    zone = timeZone;
  } catch {
    return null;
  }

  const wall = wallClockIn(from, timeZone);
  // Start at the top of the next wall-clock minute so the result is always
  // strictly later than `from`.
  const calendar = new Date(
    Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute + 1),
  );

  for (let day = 0; day < MAX_DAYS_AHEAD; day += 1) {
    const monthMatches = cron.months.has(calendar.getUTCMonth() + 1);
    if (!monthMatches || !matchesDay(cron, calendar)) {
      calendar.setUTCDate(calendar.getUTCDate() + 1);
      calendar.setUTCHours(0, 0, 0, 0);
      continue;
    }

    // On the first day the cursor still holds `from`'s wall-clock time, so
    // hours before it would resolve to a moment already in the past.
    const firstHour = day === 0 ? calendar.getUTCHours() : 0;
    for (let hour = firstHour; hour < 24; hour += 1) {
      if (!cron.hours.has(hour)) continue;
      const firstMinute = day === 0 && hour === firstHour ? calendar.getUTCMinutes() : 0;
      for (let minute = firstMinute; minute < 60; minute += 1) {
        if (!cron.minutes.has(minute)) continue;
        return instantForWallClock(
          {
            year: calendar.getUTCFullYear(),
            month: calendar.getUTCMonth() + 1,
            day: calendar.getUTCDate(),
            hour,
            minute,
          },
          zone,
        );
      }
    }

    calendar.setUTCDate(calendar.getUTCDate() + 1);
    calendar.setUTCHours(0, 0, 0, 0);
  }

  return null;
}

/**
 * The same day-of-month one month later, evaluated in `timeZone`.
 *
 * Calendar arithmetic has to happen in the schedule's timezone: a server whose
 * local date differs from the user's would otherwise roll a "monthly on the
 * 1st" schedule onto the wrong day. Day-of-month is clamped to the target
 * month's length so a schedule created on the 31st lands on the 28th/30th
 * rather than overflowing into the following month.
 */
function nextMonthSameWallClockDay(from: Date, timeZone: string): Date {
  const wall = wallClockIn(from, timeZone);
  const targetMonthIndex = wall.month === 12 ? 1 : wall.month + 1;
  const targetYear = wall.month === 12 ? wall.year + 1 : wall.year;

  // Day 0 of the next month is the last day of this one.
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonthIndex, 0)).getUTCDate();
  const day = Math.min(wall.day, daysInTargetMonth);

  return instantForWallClock(
    { year: targetYear, month: targetMonthIndex, day, hour: wall.hour, minute: wall.minute },
    timeZone,
  );
}

/**
 * When a schedule should next fire, relative to `from` (defaults to now).
 *
 * The named cadences advance by a fixed interval or calendar month, which is
 * what the product exposes. `CUSTOM` defers to the user's cron expression
 * evaluated in the schedule's own timezone; an unparseable expression falls
 * back to daily rather than firing at a time the user never asked for.
 */
export function nextRunAt(
  frequency: ReportScheduleFrequency | string,
  cron?: string | null,
  from: Date = new Date(),
  timeZone = "UTC",
): Date {
  switch (frequency) {
    case "DAILY":
      return new Date(from.getTime() + DAY_MS);
    case "WEEKLY":
      return new Date(from.getTime() + 7 * DAY_MS);
    case "MONTHLY":
      return nextMonthSameWallClockDay(from, timeZone);
    case "CUSTOM": {
      if (cron) {
        const next = nextCronOccurrence(cron, from, timeZone);
        if (next) return next;
      }
      return new Date(from.getTime() + DAY_MS);
    }
    default:
      return new Date(from.getTime() + DAY_MS);
  }
}

/**
 * The first future run for a schedule, skipping any occurrences already in the
 * past. A schedule left disabled for a week fires once on re-enable rather than
 * replaying every missed slot.
 */
export function nextRunAtAfterNow(
  frequency: ReportScheduleFrequency | string,
  cron: string | null | undefined,
  from: Date = new Date(),
  timeZone = "UTC",
): Date {
  let next = nextRunAt(frequency, cron, from, timeZone);
  // Two guards covers both a long-disabled schedule and an expression that
  // resolves to the current minute.
  for (let guard = 0; guard < 2 && next.getTime() <= from.getTime(); guard += 1) {
    next = nextRunAt(frequency, cron, next, timeZone);
  }
  return next;
}

export { MINUTE_MS };
