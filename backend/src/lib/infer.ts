import type { ColumnType } from "@prisma/client";

export const SAMPLE_ROWS = 200;
export const TYPE_CONFIDENCE = 0.95;

export interface ColumnProfile {
  name: string;
  type: ColumnType;
  isNullable: boolean;
  mixed: boolean;
  sample: string[];
  nullCount: number;
}

export interface ParsedCell {
  ok: boolean;
  value?: string | number | boolean | Date | null;
}

const INTEGER_RE = /^[+-]?\d+$/;
const DECIMAL_RE = /^[+-]?(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?$/;
const TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})?$/;

function isEmpty(value: string): boolean {
  return value.trim() === "";
}

export function isInteger(value: string): boolean {
  return INTEGER_RE.test(value.trim());
}

export function isDecimal(value: string): boolean {
  return DECIMAL_RE.test(value.trim()) && !isInteger(value);
}

export function isBooleanLiteral(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return ["true", "false", "yes", "no", "1", "0"].includes(normalized);
}

export function isDate(value: string): boolean {
  const candidate = value.trim();
  if (!DATE_RE.test(candidate)) return false;
  const [year, month, day] = candidate.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month! - 1 &&
    date.getUTCDate() === day
  );
}

export function isTime(value: string): boolean {
  return TIME_RE.test(value.trim());
}

export function isTimestamp(value: string): boolean {
  const candidate = value.trim();
  if (!TIMESTAMP_RE.test(candidate)) return false;
  return !Number.isNaN(Date.parse(candidate.replace(" ", "T")));
}

function toTypeScore(values: string[], type: ColumnType): { rate: number; total: number } {
  let parsed = 0;
  let total = 0;
  for (const value of values) {
    if (isEmpty(value)) continue;
    total += 1;
    const matches =
      type === "INTEGER"
        ? isInteger(value)
        : type === "DECIMAL"
          ? isDecimal(value) || isInteger(value)
          : type === "BOOLEAN"
            ? isBooleanLiteral(value)
            : type === "DATE"
              ? isDate(value)
              : type === "TIME"
                ? isTime(value)
                : type === "TIMESTAMP"
                  ? isTimestamp(value)
                  : true;
    if (matches) parsed += 1;
  }
  return { rate: total === 0 ? 0 : parsed / total, total };
}

const TYPE_ORDER: ColumnType[] = [
  "TIMESTAMP",
  "DATE",
  "TIME",
  "INTEGER",
  "DECIMAL",
  "BOOLEAN",
];

export function inferColumnType(values: string[]): { type: ColumnType; mixed: boolean } {
  const nonEmpty = values.filter((value) => !isEmpty(value));
  if (nonEmpty.length === 0) {
    return { type: "TEXT", mixed: false };
  }

  let selected: ColumnType = "TEXT";

  for (const candidate of TYPE_ORDER) {
    const { rate, total } = toTypeScore(values, candidate);
    if (total > 0 && rate >= TYPE_CONFIDENCE) {
      selected = candidate;
      break;
    }
  }

  const ambiguous =
    selected === "TEXT" &&
    nonEmpty.some(
      (value) =>
        isDecimal(value) || isInteger(value) || isDate(value) || isTimestamp(value) || isTime(value),
    );

  return { type: selected, mixed: ambiguous };
}

export function sampleValues(
  rows: string[][],
  columnIndex: number,
  max = SAMPLE_ROWS,
): string[] {
  const values: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const value = row[columnIndex] ?? "";
    if (seen.has(value)) continue;
    seen.add(value);
    values.push(value);
    if (values.length >= max) break;
  }
  return values;
}

export function profileColumns(
  headers: string[],
  rows: string[][],
): ColumnProfile[] {
  return headers.map((name, index) => {
    const columnName = name.trim() === "" ? `column_${index + 1}` : name;
    const sampled = rows.slice(0, SAMPLE_ROWS).map((row) => row[index] ?? "");
    const { type, mixed } = inferColumnType(sampled);
    const nullCount = rows.filter((row) => isEmpty(row[index] ?? "")).length;
    const sample = Array.from(new Set(sampled.filter((value) => !isEmpty(value)))).slice(0, 5);
    return {
      name: columnName,
      type,
      isNullable: nullCount > 0,
      mixed,
      sample,
      nullCount,
    };
  });
}

export function parseValue(
  value: string,
  type: ColumnType,
): ParsedCell {
  const trimmed = value.trim();
  if (isEmpty(trimmed)) return { ok: true, value: null };

  switch (type) {
    case "INTEGER": {
      if (!isInteger(trimmed)) return { ok: false };
      return { ok: true, value: Number.parseInt(trimmed, 10) };
    }
    case "DECIMAL": {
      if (!isDecimal(trimmed) && !isInteger(trimmed)) return { ok: false };
      return { ok: true, value: Number(trimmed.replace(/,/g, "")) };
    }
    case "BOOLEAN": {
      if (!isBooleanLiteral(trimmed)) return { ok: false };
      const isTrue = ["true", "yes", "1"].includes(trimmed.toLowerCase());
      return { ok: true, value: isTrue };
    }
    case "DATE": {
      if (!isDate(trimmed)) return { ok: false };
      const [year, month, day] = trimmed.split("-").map(Number);
      return { ok: true, value: new Date(Date.UTC(year!, month! - 1, day!)) };
    }
    case "TIME": {
      if (!isTime(trimmed)) return { ok: false };
      const [hours, minutes, seconds = "0"] = trimmed.split(":");
      const date = new Date(0);
      date.setUTCHours(Number(hours), Number(minutes), Number(seconds.split(".")[0]));
      return { ok: true, value: date };
    }
    case "TIMESTAMP": {
      if (!isTimestamp(trimmed)) return { ok: false };
      return { ok: true, value: new Date(trimmed.replace(" ", "T")) };
    }
    default:
      return { ok: true, value: trimmed };
  }
}