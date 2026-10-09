import { Readable } from "node:stream";
import { parse } from "csv-parse";
import ExcelJS from "exceljs";
import { env } from "../config/env.js";
import { AppError } from "./http-errors.js";

export interface ParsedSheet {
  sheetName: string;
  headers: string[];
  rows: string[][];
}

const ROW_CAP = env.IMPORT_ROW_CAP;

function toRows(records: string[][]): { headers: string[]; rows: string[][] } {
  if (records.length === 0) {
    throw new AppError("FILE_EMPTY", "The file contains no data.");
  }
  const headers = records[0]!.map((header) => String(header).trim());
  const rows = records.slice(1);
  if (rows.length === 0) {
    throw new AppError("FILE_EMPTY", "The file contains a header but no data rows.");
  }
  return { headers, rows };
}

function assertRowCap(rowCount: number, fileName: string): void {
  if (rowCount > ROW_CAP) {
    throw new AppError(
      "IMPORT_FAILED",
      `"${fileName}" exceeds the ${ROW_CAP.toLocaleString()} row limit.`,
    );
  }
}


export async function parseCsv(
  buffer: Buffer,
  fileName: string,
): Promise<ParsedSheet> {
  const records: string[][] = [];
  const parser = parse({
    bom: true,
    delimiter: sniffDelimiter(buffer),
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  });

  const stream = Readable.from(buffer);
  await new Promise<void>((resolve, reject) => {
    stream
      .pipe(parser)
      .on("data", (row: string[]) => {
        records.push(row);
        if (records.length > ROW_CAP) {
          parser.destroy(new Error("row_cap_exceeded"));
        }
      })
      .on("error", reject)
      .on("end", resolve);
  });

  assertRowCap(records.length, fileName);
  const { headers, rows } = toRows(records);
  return { sheetName: fileName, headers, rows };
}

function sniffDelimiter(buffer: Buffer): string {
  const sample = buffer.subarray(0, 4096).toString("utf8");
  if (!sample.includes(",")) {
    if (sample.includes("\t")) return "\t";
    if (sample.includes(";")) return ";";
  }
  const firstLine = sample.split(/\r?\n/)[0] ?? "";
  const countDelimiter = (char: string): number =>
    firstLine.split(char).length - 1;
  const comma = countDelimiter(",");
  const semicolon = countDelimiter(";");
  const tab = countDelimiter("\t");
  if (semicolon > comma && semicolon >= tab) return ";";
  if (tab > comma && tab >= semicolon) return "\t";
  return ",";
}

export async function parseXlsx(
  buffer: Buffer,
  fileName: string,
): Promise<ParsedSheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

  const firstWorksheet = workbook.worksheets[0];
  if (!firstWorksheet) {
    throw new AppError("FILE_EMPTY", "The workbook contains no worksheets.");
  }
  const sheetName = firstWorksheet.name;

  let headers: string[] = [];
  const rows: string[][] = [];
  let rowCount = 0;

  firstWorksheet.eachRow({ includeEmpty: true }, (row) => {
    const values = (Array.isArray(row.values) ? row.values : []).slice(1);
    const cells = values.map(normalizeXlsxCell);
    if (rowCount === 0) {
      headers = cells.map((cell) => cell.trim());
    } else {
      rows.push(cells);
    }
    rowCount += 1;
  });

  assertRowCap(rowCount, fileName);
  if (headers.length === 0 || rows.length === 0) {
    throw new AppError("FILE_EMPTY", "The file contains no usable data rows.");
  }

  return { sheetName, headers, rows };
}

function normalizeXlsxCell(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return toDateText(value);
  if (value instanceof Buffer) return value.toString("utf8");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.error === "string") return record.error;
    if (record.result !== undefined && record.result !== record) {
      return normalizeXlsxCell(record.result);
    }
    if (record.text !== undefined) return normalizeXlsxCell(record.text);
    if (Array.isArray(record.richText)) {
      return record.richText
        .map((fragment) =>
          normalizeXlsxCell((fragment as Record<string, unknown> | null)?.text),
        )
        .join("");
    }
  }
  return "";
}

function toDateText(value: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  const datePart = `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  const hasTime =
    value.getUTCHours() !== 0 ||
    value.getUTCMinutes() !== 0 ||
    value.getUTCSeconds() !== 0 ||
    value.getUTCMilliseconds() !== 0;
  if (!hasTime) return datePart;
  return `${datePart} ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`;
}

export async function parseSpreadsheet(
  buffer: Buffer,
  fileName: string,
): Promise<ParsedSheet> {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "xlsx") {
    return parseXlsx(buffer, fileName);
  }
  return parseCsv(buffer, fileName);
}