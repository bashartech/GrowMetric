import type { QualityStatus } from "@prisma/client";
import type { ColumnProfile } from "./infer.js";
import { parseValue } from "./infer.js";

export interface QualityInput {
  rows: string[][];
  columns: ColumnProfile[];
}

export interface ColumnWarning {
  column: string;
  messages: string[];
}

export interface QualitySummary {
  totalRows: number;
  columnCount: number;
  missingValuePct: number;
  duplicateRowPct: number;
  invalidNumberPct: number;
  invalidDatePct: number;
  numericOutlierCount: number;
  status: QualityStatus;
  warnings: ColumnWarning[];
}

/**
 * Tolerances for the signals that gate dataset status.
 *
 * These were previously zero-tolerance: a single empty cell, a single duplicate
 * row, or a single flagged outlier moved the whole dataset to WARNINGS, so
 * READY was effectively unreachable for real-world data. Percentages are the
 * honest form of "is this table usable" — a few blanks in a large export is
 * normal, a column that is half unparseable is not.
 *
 * Outliers are deliberately absent from this list. A bulk order or a
 * promotional spike is legitimate business data, not a data error, so the
 * count is reported for visibility but never blocks READY.
 */
const MISSING_WARN_PCT = 5;
const DUPLICATE_WARN_PCT = 5;
const INVALID_NUMBER_WARN_PCT = 1;
const INVALID_DATE_WARN_PCT = 1;

/**
 * Below this row count a percentage stops describing the data and starts
 * describing the sample size: one blank cell in a 4-row table is already >5%,
 * so tiny but perfectly usable imports came back WARNINGS.
 *
 * The gate is skipped entirely for such tables; the counts are still reported,
 * so the quality panel shows the gaps rather than hiding them.
 */
const MIN_ROWS_FOR_MISSING_GATE = 10;

function pct(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Number(((part / whole) * 100).toFixed(2));
}

function rowKey(row: string[]): string {
  return JSON.stringify(row.map((cell) => cell.trim()));
}

function iqrOutliers(values: number[]): number {
  if (values.length < 4) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = (lo: number, hi: number): number => {
    const slice = sorted.slice(lo, hi);
    const center = Math.floor(slice.length / 2);
    if (slice.length % 2 === 1) return slice[center]!;
    return (slice[center - 1]! + slice[center]!) / 2;
  };
  const q1 = mid(0, Math.floor(sorted.length / 2));
  const q3 = mid(Math.ceil(sorted.length / 2), sorted.length);
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  return sorted.filter((value) => value < lo || value > hi).length;
}

export function computeQuality(input: QualityInput): QualitySummary {
  const { columns, rows } = input;
  const totalRows = rows.length;
  const columnCount = columns.length;
  const totalCells = totalRows * columnCount;

  let missing = 0;
  let invalidNumeric = 0;
  let invalidDate = 0;
  let numericCount = 0;
  let dateCount = 0;
  const duplicates = new Set<string>();
  let duplicateCount = 0;
  /**
   * One bucket per column, not one bucket for the whole table. Pooling every
   * numeric column into a single array made `iqrOutliers` compare a quantity
   * against a revenue: with `quantity` spanning 1-100 and `revenue` spanning
   * 1000-50000, the low fence sat far above every quantity value and flagged
   * them all. The tell was the same 20-row, 15-column dataset reporting CLEAN in
   * one version and 6 outliers in the next purely because the column mix
   * shifted.
   */
  const numericValuesByColumn: number[][] = columns.map(() => []);

  for (const row of rows) {
    const key = rowKey(row);
    if (duplicates.has(key)) {
      duplicateCount += 1;
    } else {
      duplicates.add(key);
    }

    columns.forEach((column, index) => {
      const raw = row[index] ?? "";
      if (raw.trim() === "") {
        missing += 1;
        return;
      }
      const parsed = parseValue(raw, column.type);
      if (!parsed.ok) {
        if (column.type === "DECIMAL" || column.type === "INTEGER") {
          invalidNumeric += 1;
          numericCount += 1;
        } else if (
          column.type === "DATE" ||
          column.type === "TIME" ||
          column.type === "TIMESTAMP"
        ) {
          invalidDate += 1;
          dateCount += 1;
        }
        return;
      }
      if (column.type === "DECIMAL" || column.type === "INTEGER") {
        numericCount += 1;
        if (typeof parsed.value === "number") {
          numericValuesByColumn[index]!.push(parsed.value);
        }
      } else if (
        column.type === "DATE" ||
        column.type === "TIME" ||
        column.type === "TIMESTAMP"
      ) {
        dateCount += 1;
      }
    });
  }

  // Collected per column index so outlier findings merge into the same entry as
  // that column's other messages instead of producing a separate list.
  const messagesByColumn: string[][] = columns.map(() => []);
  for (const [index, column] of columns.entries()) {
    const messages = messagesByColumn[index]!;
    if (column.isNullable) {
      messages.push(
        `Column "${column.name}" contains ${column.nullCount} empty cells.`,
      );
    }
    if (column.mixed) {
      messages.push(
        `Column "${column.name}" had mixed values and was stored as TEXT.`,
      );
    }
  }

  let numericOutlierCount = 0;
  for (const [index, values] of numericValuesByColumn.entries()) {
    const count = iqrOutliers(values);
    if (count === 0) continue;
    numericOutlierCount += count;
    const column = columns[index]!;
    messagesByColumn[index]!.push(
      `Column "${column.name}" has ${count} statistical outlier${
        count === 1 ? "" : "s"
      } by IQR. Informational only — this does not affect dataset readiness.`,
    );
  }

  const warnings: ColumnWarning[] = [];
  for (const [index, column] of columns.entries()) {
    const messages = messagesByColumn[index]!;
    if (messages.length > 0) {
      warnings.push({ column: column.name, messages });
    }
  }

  const missingValuePct = pct(missing, totalCells);
  const invalidNumberPct = pct(invalidNumeric, numericCount || 1);
  const invalidDatePct = pct(invalidDate, dateCount || 1);
  const duplicateRowPct = pct(duplicateCount, totalRows);

  /**
   * Only signals that indicate genuinely unusable data gate the status.
   *
   * Unparseable numbers and dates are the hard failures — the values cannot be
   * trusted downstream at all. Everything else (missing cells, duplicate rows,
   * outliers, nullable or mixed columns) is reported as a warning message and
   * surfaced in the quality report without downgrading the dataset.
   *
   * A nullable column no longer contributes here. Nearly every real table has
   * one, so including it made READY unreachable regardless of the data.
   */
  const hasWarnings =
    (totalRows >= MIN_ROWS_FOR_MISSING_GATE &&
      missingValuePct > MISSING_WARN_PCT) ||
    duplicateRowPct > DUPLICATE_WARN_PCT ||
    invalidNumberPct > INVALID_NUMBER_WARN_PCT ||
    invalidDatePct > INVALID_DATE_WARN_PCT;

  const status: QualityStatus = hasWarnings ? "WARNINGS" : "CLEAN";

  return {
    totalRows,
    columnCount,
    missingValuePct,
    duplicateRowPct,
    invalidNumberPct,
    invalidDatePct,
    numericOutlierCount,
    status,
    warnings,
  };
}