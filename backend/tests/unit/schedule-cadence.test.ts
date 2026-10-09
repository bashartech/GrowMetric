import { describe, it, expect } from 'vitest';
import {
  nextCronOccurrence,
  nextRunAt,
  nextRunAtAfterNow,
  parseCron,
} from '../../src/lib/schedule-cadence.js';

/**
 * The scheduler advances `ReportSchedule.nextRunAt` from this module, so these
 * tests pin the cadence maths rather than the wiring around it.
 */
describe('schedule cadence', () => {
  describe('parseCron', () => {
    it('expands wildcards, ranges, lists and steps', () => {
      const everyFifteen = parseCron('*/15 * * * *');
      expect([...everyFifteen!.minutes].sort((a, b) => a - b)).toEqual([0, 15, 30, 45]);

      const workHours = parseCron('0 9-17 * * *');
      expect([...workHours!.hours].sort((a, b) => a - b)).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);

      const list = parseCron('0,30 * * * *');
      expect([...list!.minutes].sort((a, b) => a - b)).toEqual([0, 30]);
    });

    it('treats both 0 and 7 as Sunday', () => {
      expect([...parseCron('0 0 * * 7')!.daysOfWeek]).toEqual([0]);
      expect([...parseCron('0 0 * * 0')!.daysOfWeek]).toEqual([0]);
    });

    it('records whether each day field is a wildcard', () => {
      const mondayFirst = parseCron('0 9 1 * 1');
      expect(mondayFirst!.dayOfMonthWildcard).toBe(false);
      expect(mondayFirst!.dayOfWeekWildcard).toBe(false);
      expect(parseCron('0 9 * * *')!.dayOfMonthWildcard).toBe(true);
    });

    it('rejects malformed expressions instead of guessing', () => {
      expect(parseCron('* * * *')).toBeNull();
      expect(parseCron('* * * * * *')).toBeNull();
      expect(parseCron('99 * * * *')).toBeNull();
      expect(parseCron('*/0 * * * *')).toBeNull();
      expect(parseCron('5-1 * * * *')).toBeNull();
      expect(parseCron('a * * * *')).toBeNull();
      expect(parseCron('')).toBeNull();
    });
  });

  describe('nextCronOccurrence', () => {
    it('finds the next matching minute later the same day', () => {
      const from = new Date('2026-03-10T14:05:00.000Z');
      const next = nextCronOccurrence('0 * * * *', from);
      expect(next!.toISOString()).toBe('2026-03-10T15:00:00.000Z');
    });

    it('rolls over to the next day when today no longer matches', () => {
      const from = new Date('2026-03-10T23:30:00.000Z');
      const next = nextCronOccurrence('0 9 * * *', from);
      expect(next!.toISOString()).toBe('2026-03-11T09:00:00.000Z');
    });

    it('honours a weekly schedule', () => {
      // 2026-03-10 is a Tuesday; the next Monday is 2026-03-16.
      const from = new Date('2026-03-10T12:00:00.000Z');
      const next = nextCronOccurrence('30 9 * * 1', from);
      expect(next!.toISOString()).toBe('2026-03-16T09:30:00.000Z');
    });

    it('unions day-of-month and day-of-week when both are restricted', () => {
      // Cron semantics: the 1st of the month OR any Monday, not the
      // intersection. From 2026-03-10 the next match is Monday 2026-03-16,
      // not 2026-04-01.
      const from = new Date('2026-03-10T12:00:00.000Z');
      const next = nextCronOccurrence('0 9 1 * 1', from);
      expect(next!.toISOString()).toBe('2026-03-16T09:00:00.000Z');
    });

    it('applies only the day-of-month rule when day-of-week is a wildcard', () => {
      const from = new Date('2026-03-10T12:00:00.000Z');
      const next = nextCronOccurrence('0 9 15 * *', from);
      expect(next!.toISOString()).toBe('2026-03-15T09:00:00.000Z');
    });

    it('is strictly later than the reference time', () => {
      // Without the "next minute" reset this would return the same instant
      // forever and the scheduler would spin.
      const from = new Date('2026-03-10T09:00:00.000Z');
      const next = nextCronOccurrence('0 9 * * *', from);
      expect(next!.getTime()).toBeGreaterThan(from.getTime());
      expect(next!.toISOString()).toBe('2026-03-11T09:00:00.000Z');
    });

    it('returns null for an unparseable expression', () => {
      expect(nextCronOccurrence('not a cron', new Date('2026-03-10T12:00:00.000Z'))).toBeNull();
    });

    it('skips a month the expression excludes', () => {
      // Only February; from March the next match is 2027-02-01.
      const from = new Date('2026-03-10T12:00:00.000Z');
      const next = nextCronOccurrence('0 0 1 2 *', from);
      expect(next!.toISOString()).toBe('2027-02-01T00:00:00.000Z');
    });

    it('evaluates the expression in the schedule timezone, not the server one', () => {
      // 09:00 in New York is 14:00 UTC in March (EDT, UTC-5). If this used the
      // server's local time the same schedule would fire at a different moment
      // on a UTC container than on a dev machine.
      const from = new Date('2026-03-10T12:00:00.000Z');
      const newYork = nextCronOccurrence('0 9 * * *', from, 'America/New_York');
      expect(newYork!.toISOString()).toBe('2026-03-10T13:00:00.000Z');
    });

    it('accounts for a timezone that is ahead of UTC', () => {
      // 09:00 in Karachi (UTC+5) is 04:00 UTC.
      const from = new Date('2026-03-10T12:00:00.000Z');
      const karachi = nextCronOccurrence('0 9 * * *', from, 'Asia/Karachi');
      expect(karachi!.toISOString()).toBe('2026-03-11T04:00:00.000Z');
    });

    it('keeps a 09:00 local run at 09:00 local across a DST boundary', () => {
      // US DST starts 2026-03-08. A 09:00 New York schedule is 14:00Z before
      // the change and 13:00Z after — the wall-clock time must not drift.
      const before = nextCronOccurrence('0 9 * * *', new Date('2026-03-06T12:00:00.000Z'), 'America/New_York');
      expect(before!.toISOString()).toBe('2026-03-06T14:00:00.000Z');

      const after = nextCronOccurrence('0 9 * * *', new Date('2026-03-10T20:00:00.000Z'), 'America/New_York');
      expect(after!.toISOString()).toBe('2026-03-11T13:00:00.000Z');
    });

    it('returns null for an unknown timezone', () => {
      expect(nextCronOccurrence('0 9 * * *', new Date('2026-03-10T12:00:00.000Z'), 'Mars/Olympus')).toBeNull();
    });
  });

  describe('nextRunAt', () => {
    const from = new Date('2026-03-10T14:00:00.000Z');
    const day = 24 * 60 * 60 * 1000;

    it('advances DAILY by 24h', () => {
      expect(nextRunAt('DAILY', null, from).getTime() - from.getTime()).toBe(day);
    });

    it('advances WEEKLY by 7 days', () => {
      expect(nextRunAt('WEEKLY', null, from).getTime() - from.getTime()).toBe(7 * day);
    });

    it('advances MONTHLY to the same day next month', () => {
      expect(nextRunAt('MONTHLY', null, from, 'UTC').toISOString()).toBe('2026-04-10T14:00:00.000Z');
    });

    it('clamps MONTHLY to the last day of a shorter month', () => {
      // 2026-01-31 + 1 month has no 31st, so it must land on the 28th rather
      // than overflowing into March.
      const jan31 = new Date('2026-01-31T09:00:00.000Z');
      expect(nextRunAt('MONTHLY', null, jan31, 'UTC').toISOString()).toBe('2026-02-28T09:00:00.000Z');
    });

    it('rolls a December schedule into the next year', () => {
      const dec = new Date('2026-12-15T09:00:00.000Z');
      expect(nextRunAt('MONTHLY', null, dec, 'UTC').toISOString()).toBe('2027-01-15T09:00:00.000Z');
    });

    it('advances MONTHLY in the schedule timezone, not the server one', () => {
      // 2026-04-01T00:00 in Karachi (UTC+5) is 2026-03-31T19:00Z. One month
      // later is 2026-05-01T00:00 Karachi = 2026-04-30T19:00Z.
      const first = new Date('2026-03-31T19:00:00.000Z');
      expect(nextRunAt('MONTHLY', null, first, 'Asia/Karachi').toISOString())
        .toBe('2026-04-30T19:00:00.000Z');
      expect(nextRunAt('MONTHLY', null, first, 'UTC').toISOString())
        .toBe('2026-04-30T19:00:00.000Z');
    });

    it('uses the cron expression for CUSTOM', () => {
      expect(nextRunAt('CUSTOM', '0 9 * * *', from).toISOString()).toBe('2026-03-11T09:00:00.000Z');
    });

    it('falls back to daily when a CUSTOM expression is unusable', () => {
      // Better a daily report than one silently firing at a time nobody chose.
      expect(nextRunAt('CUSTOM', 'garbage', from).getTime() - from.getTime()).toBe(day);
      expect(nextRunAt('CUSTOM', null, from).getTime() - from.getTime()).toBe(day);
    });

    it('falls back to daily for an unknown frequency', () => {
      expect(nextRunAt('HOURLY', null, from).getTime() - from.getTime()).toBe(day);
    });

    it('passes the timezone through to CUSTOM schedules', () => {
      expect(nextRunAt('CUSTOM', '0 9 * * *', from, 'Asia/Karachi').toISOString())
        .toBe('2026-03-11T04:00:00.000Z');
      expect(nextRunAt('CUSTOM', '0 9 * * *', from, 'UTC').toISOString())
        .toBe('2026-03-11T09:00:00.000Z');
    });
  });

  describe('nextRunAtAfterNow', () => {
    it('skips occurrences already in the past', () => {
      // A schedule disabled for a month must fire once, not replay 30 slots.
      const now = new Date('2026-04-10T12:00:00.000Z');
      const next = nextRunAtAfterNow('DAILY', null, now);
      expect(next.getTime()).toBeGreaterThan(now.getTime());
    });
  });
});
