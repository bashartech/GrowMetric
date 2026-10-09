import type { DatasetColumn } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { redactSensitiveStrings } from "../logger.js";

export const SQL_TOOL_DEFAULT_LIMIT = 50;
export const SQL_TOOL_MAX_LIMIT = 50;
export const SQL_TOOL_MAX_MATCHING_COLUMNS = 40;
export const SQL_TOOL_TIMEOUT_MS = 10_000;

/** Keywords/functions that can touch system state or non-projected data. */
const FORBIDDEN_PATTERNS = [
  /\b(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|MERGE|CALL|COPY|EXECUTE|VACUUM|REFRESH|REINDEX|ANALYZE|CLUSTER|LISTEN|NOTIFY)\b/i,
  /\b(pg_sleep|pg_read_file|pg_ls_dir|pg_read_binary_file|lo_import|lo_export|dblink|pg_create_extension|inet_server_addr|pg_stat_file)\b/i,
  /(::\s*regclass)/i,
  /\b(information_schema|pg_catalog|pg_toast|pg_type)\./i,
];

const MUTATION_NAMES = [
  "drop",
  "delete",
  "update",
  "insert",
  "alter",
  "create",
  "truncate",
  "grant",
  "revoke",
  "merge",
  "call",
  "copy",
  "execute",
  "vacuum",
  "refresh",
  "reindex",
  "analyze",
  "cluster",
  "listen",
  "notify",
];

export const runSqlToolSchema = z.object({
  datasetId: z.string().uuid(),
  /** SELECT query over the virtual table named `dataset`. */
  statement: z.string().min(7).max(2000),
});

export type RunSqlToolArgs = z.infer<typeof runSqlToolSchema>;

export interface SqlToolResult {
  ok: boolean;
  content: unknown;
  error?: string;
  rowCount: number;
}

/**
 * Validates and executes a read-only SELECT over a scoped, read-only
 * projection of one dataset (FR-005, Principle XI). Mutation keywords,
 * dangerous functions, `SELECT *`, script splitting and unbounded scans are
 * rejected; a result cap is always enforced. Runs against platform storage
 * via the same analytics tables used by the metric tools.
 */
export async function runReadonlySql(
  args: RunSqlToolArgs,
  organizationId: string,
  workspaceId: string,
): Promise<SqlToolResult> {
  const dataset = await prisma.dataset.findFirst({
    where: { id: args.datasetId, organizationId, workspaceId },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });

  if (!dataset) {
    return fail("Dataset not found or not in this workspace.");
  }
  if (!dataset.currentVersionId || !dataset.versions[0]) {
    return fail("Dataset has no current version to query.");
  }
  const versionId = dataset.currentVersionId;

  const columns = await prisma.datasetColumn.findMany({
    where: { datasetId: dataset.id, datasetVersionId: versionId },
    orderBy: { ordinalPosition: "asc" },
  });
  if (columns.length === 0) {
    return fail("Dataset has no projected columns to query.");
  }

  const limited = columns.slice(0, SQL_TOOL_MAX_MATCHING_COLUMNS);

  const statement = sanitizeStatement(args.statement);
  if (!statement) {
    return fail("Statement is empty or uses unsupported SQL features.");
  }

  const validationError = validateSelect(statement);
  if (validationError) {
    return fail(validationError);
  }

  const wideSql = buildWideProjection(versionId, limited);
  const scoped = statement.replace(/\bdataset\b/g, "(\n" + wideSql + "\n) AS dataset");

  const capped = capStatement(scoped, limited, statement);
  if (!capped.ok) {
    return fail(capped.error ?? "Statement failed validation.");
  }

  const params = [dataset.id, versionId];
  params.push(...limited.map((column) => column.id));

  try {
    const startedAt = Date.now();
    const rows = (await Promise.race([
      prisma.$queryRawUnsafe(
        capped.sql,
        ...(params as unknown[]),
      ) as Promise<unknown[]>,
      timeoutAfter(SQL_TOOL_TIMEOUT_MS),
    ])) as unknown[];
    const latencyMs = Date.now() - startedAt;

    const safe = redactSensitiveStrings(
      (rows as Array<Record<string, unknown>>).map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [key, normalizeJsonValue(value)]),
        ),
      ),
    );
    return {
      ok: true,
      content: { rows: safe, rowCount: rows.length, latencyMs },
      rowCount: rows.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Query failed.";
    if (/timeout/i.test(message)) {
      return fail("Query timed out.");
    }
    return fail(message);
  }
}

function fail(content: string): SqlToolResult {
  return { ok: false, content: null, error: content, rowCount: 0 };
}

function timeoutAfter(ms: number): Promise<never> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error("Query timed out.")), ms);
  });
}

/** Converts a DB value into something JSON.stringify can serialize (BigInt -> Number). */
function normalizeJsonValue(value: unknown): unknown {
  return typeof value === "bigint" ? Number(value) : value;
}

export function sanitizeStatement(statement: string): string | null {
  const trimmed = statement.trim();
  if (!/^select\b/i.test(trimmed)) {
    return null;
  }
  if (/;/.test(trimmed)) {
    return null;
  }
  if (/--|\/\*|\*\//.test(trimmed)) {
    return null;
  }
  if (/\bselect\s+\*/i.test(trimmed)) {
    return null;
  }
  if (
    MUTATION_NAMES.some((name) =>
      new RegExp(`\\b${name}\\b`, "i").test(trimmed),
    )
  ) {
    return null;
  }
  return trimmed;
}

export function validateSelect(statement: string): string | null {
  if (
    FORBIDDEN_PATTERNS.some((pattern) => pattern.test(statement))
  ) {
    return "Statement uses forbidden functions or destructive keywords.";
  }
  return null;
}

/**
 * Caps the result of the SELECT at SQL_TOOL_MAX_LIMIT rows and returns true
 * only when the raw statement references no internal identifiers outside the
 * dataset's projected columns plus a safe grammar set.
 */
export function capStatement(
  scoped: string,
  columns: DatasetColumn[],
  original: string,
): { sql: string; ok: boolean; error?: string } {
  const allowed = new Set<string>();
  for (const column of columns) {
    allowed.add(column.name.toLowerCase());
  }
  const aliasPattern = /\bAS\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/gi;
  for (const match of original.matchAll(aliasPattern)) {
    allowed.add((match[1] ?? "").toLowerCase());
  }
  const SAFE_WORDS = new Set(
    (
      "select from where group by order having limit offset asc desc as on join left right inner outer and or not " +
      "in is null notnull between like ilike exists case when then else end distinct count sum avg min max " +
      "coalesce round abs floor ceil cast union all true false " +
      "date_year date_month date_quarter data_month dataset group min max value count"
    ).split(" "),
  );

  const tokens = original
    .split(/[^a-z0-9_"]+/i)
    .map((token) => token.replace(/^"|"$/g, "").toLowerCase())
    .filter(Boolean);
  for (const token of tokens) {
    if (SAFE_WORDS.has(token)) continue;
    if (allowed.has(token)) continue;
    if (/^\d+(\.\d+)?$/.test(token)) continue;
    if (token === "dataset") continue;
    return {
      sql: "",
      ok: false,
      error: `Statement references unknown identifier "${token}".`,
    };
  }

  const cleaned = scoped.trim();
  return {
    sql: `SELECT * FROM (\n${cleaned}\n) AS _q LIMIT ${SQL_TOOL_MAX_LIMIT}`,
    ok: true,
  };
}

/**
 * Builds a read-only wide projection of one dataset version: one row per
 * DatasetRow with one column per DatasetColumn (value cast to text), scoped
 * by $1 (datasetId) and $2 (versionId) with column ids bound from $3 on. All
 * identifiers are generated — the model only ever names the virtual table
 * `dataset` and the projected column names.
 */
export function buildWideProjection(versionId: string, columns: DatasetColumn[]): string {
  const rowCap = SQL_TOOL_MAX_LIMIT * 25;
  const selects = columns.map((column, index) => {
    const alias = valueAlias(index);
    return `  ${alias}."value" AS ${quoteColumn(column)}`;
  });

  const joins = columns
    .map((column, index) => {
      const alias = valueAlias(index);
      const idParam = index + 3;
      const table = valueTableFor(column.type);
      return `LEFT JOIN ${table} AS ${alias} ON ${alias}."rowId" = r."id"
        AND ${alias}."columnId" = $${idParam}::uuid`;
    })
    .join("\n");

  return `SELECT scoped."__idx",
${selects.join(",\n")}
      FROM (
        SELECT r."id" AS "__idx"
        FROM "DatasetRow" r
        WHERE r."datasetId" = $1::uuid AND r."datasetVersionId" = $2::uuid
        ORDER BY r."rowIndex" ASC
        LIMIT ${rowCap}
      ) scoped
      JOIN "DatasetRow" r ON r."id" = scoped."__idx"
${joins}`;
}

/**
 * Unique per-column instance alias. Columns are bound from $3 onward, so the
 * alias is numbered from 3 down to keep the projection readable; distinct from
 * the "$" placeholder used in the JOIN condition.
 */
function valueAlias(index: number): string {
  return `t${index + 3}`;
}

function valueTableFor(type: DatasetColumn["type"]): string {
  switch (type) {
    case "INTEGER":
    case "DECIMAL":
      return '"DatasetNumericValue"';
    case "BOOLEAN":
      return '"DatasetBooleanValue"';
    case "DATE":
    case "TIME":
    case "TIMESTAMP":
      return '"DatasetDatetimeValue"';
    default:
      return '"DatasetTextValue"';
  }
}

function quoteColumn(column: DatasetColumn): string {
  const name = column.name.replace(/"/g, "");
  return `"${name}"`;
}