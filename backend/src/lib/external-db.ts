import pg from "pg";
import { AppError } from "./http-errors.js";
import { logger } from "./logger.js";

export interface ExternalDbConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  sslMode?: string;
}

export interface ParsedConnectionUrl {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  sslMode: "require" | "prefer" | "disable";
}

const CONNECTION_URL_PATTERN = /^postgres(?:ql)?:\/\//i;

const decodeCredential = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const parseConnectionUrl = (
  value: string,
  fallback?: Partial<ExternalDbConfig>,
): ParsedConnectionUrl | null => {
  const trimmed = value.trim();
  if (!CONNECTION_URL_PATTERN.test(trimmed)) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!url.hostname) return null;

  const sslModeParam = url.searchParams.get("sslmode");
  const database = url.pathname.split("/").filter(Boolean)[0] ?? "";
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : (fallback?.port ?? 5432),
    database: database || fallback?.database || "",
    username: decodeCredential(url.username) || fallback?.username || "",
    password: decodeCredential(url.password) || fallback?.password || "",
    sslMode:
      sslModeParam === "disable"
        ? "disable"
        : sslModeParam === "prefer"
          ? "prefer"
          : (fallback?.sslMode as "require" | "prefer" | "disable" | undefined) ?? "require",
  };
};

export interface DiscoveredTable {
  schemaName: string;
  tableName: string;
  columnCount: number;
  rowEstimate: number;
}

type Row = Record<string, unknown>;

export interface TableColumn {
  name: string;
  dataType: string;
}

export interface PgDriver {
  connect(): Promise<void>;
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>;
  end(): Promise<void>;
}

class PgClientDriver implements PgDriver {
  constructor(private readonly config: ExternalDbConfig) {}

  async connect(): Promise<void> {
    const client = new pg.Client({
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.username,
      password: this.config.password,
      ssl: this.config.sslMode === "disable" ? false : { rejectUnauthorized: false },
      options: "-c default_transaction_read_only=on",
      connectionTimeoutMillis: 15_000,
      statement_timeout: 30_000,
    });
    await client.connect();
    this.client = client;
  }

  query(text: string, values?: unknown[]): Promise<{ rows: Row[] }> {
    if (!this.client) {
      throw new AppError("EXT_DB_CONNECTION_FAILED", "Not connected.");
    }
    return this.client.query(text, values);
  }

  async end(): Promise<void> {
    await this.client?.end();
  }

  private client: pg.Client | null = null;
}

export function identifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

interface PgConnectError extends Error {
  code?: string;
}

export const describeConnectionError = (
  error: unknown,
  config: ExternalDbConfig,
): string => {
  const mapped = describeKnownConnectionError(error, config);
  if (mapped !== null) return mapped;
  const message = error instanceof Error ? error.message : "";
  const hint =
    message.length > 0
      ? ` Underlying driver error: "${message}".`
      : "";
  return `Could not connect to the external database.${hint}`;
};

const describeKnownConnectionError = (
  error: unknown,
  config: ExternalDbConfig,
): string | null => {
  if (!(error instanceof Error)) return null;
  switch ((error as PgConnectError).code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return `Cannot resolve host "${config.host}". Host must be the hostname only (for example ep-xxxx.region.aws.neon.tech) — paste the full postgresql:// URL into Host and it will be parsed automatically.`;
    case "ECONNREFUSED":
    case "EHOSTUNREACH":
    case "ECONNRESET":
    case "ETIMEDOUT":
      return `Could not reach the database at ${config.host}:${config.port}. Check the host/port, that the database is reachable at this IP, and the Neon IP allowlist.`;
    case "28P01":
      return `Password authentication failed for "${config.username}". This is usually one of: (1) the wrong/rotated role password — generate a fresh connection string or reset the password in Neon; (2) the Neon IP allowlist blocking this server's IP — allow it (or disable the allowlist) under Project → Settings → Security; (3) percent-encoding — if the password came from a URL, paste the whole URL into Host so it is decoded automatically.`;
    case "28000":
      return `Access denied for user "${config.username}". Verify the role exists and is allowed to log in from this IP (Neon: check the IP allowlist).`;
    case "3D000":
      return `Database "${config.database}" does not exist on the server.`;
    default:
      if (/ssl/i.test((error as PgConnectError).message ?? "")) {
        return 'SSL connection failed. Keep SSL Mode set to "require" (Neon requires TLS).';
      }
      return null;
  }
};

export async function connectReadOnly(
  config: ExternalDbConfig,
  driver: PgDriver = new PgClientDriver(config),
): Promise<PgDriver> {
  try {
    await driver.connect();
  } catch (error) {
    await driver.end().catch(() => undefined);
    const code = error instanceof Error ? (error as PgConnectError).code : undefined;
    const detail = error instanceof Error ? error.message : String(error);
    logger.error(
      {
        driver: "pg",
        code,
        detail,
        config: {
          host: config.host,
          port: config.port,
          database: config.database,
          username: config.username,
          password: config.password,
          sslMode: config.sslMode,
        },
      },
      "External DB connection failed. Verify the exact host/database/username against the Neon console; if the pooler (-pooler) host keeps failing, try the direct hostname from Neon → Connect → Direct connection.",
    );
    throw new AppError(
      "EXT_DB_CONNECTION_FAILED",
      describeConnectionError(error, config),
    );
  }

  const verified = await verifyReadOnly(driver);
  if (!verified) {
    await driver.end().catch(() => undefined);
    throw new AppError(
      "EXT_DB_NOT_READ_ONLY",
      "The database connection must be read-only.",
    );
  }

  return driver;
}

export async function verifyReadOnly(driver: PgDriver): Promise<boolean> {
  try {
    const result = await driver.query(
      "SELECT current_setting('transaction_read_only') AS read_only",
    );
    return result.rows[0]?.read_only === "on";
  } catch {
    return false;
  }
}

const SYSTEM_SCHEMAS = [
  "pg_catalog",
  "information_schema",
  "pg_toast",
  "pg_temp_1",
  "pg_toast_temp_1",
];

export async function discoverTables(
  driver: PgDriver,
): Promise<DiscoveredTable[]> {
  const result = await driver.query(
    `SELECT
       n.nspname AS "schemaName",
       c.relname AS "tableName"
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'r'
       AND n.nspname NOT IN (${SYSTEM_SCHEMAS.map((_, index) => `$${index + 1}`).join(", ")})
     ORDER BY n.nspname, c.relname`,
    SYSTEM_SCHEMAS,
  );

  const tables: DiscoveredTable[] = [];
  for (const row of result.rows) {
    const schemaName = String(row.schemaName);
    const tableName = String(row.tableName);
    const columns = await listColumns(driver, schemaName, tableName);
    const count = await estimateRowCount(driver, schemaName, tableName);
    tables.push({
      schemaName,
      tableName,
      columnCount: columns.length,
      rowEstimate: count,
    });
  }
  return tables;
}

export async function listColumns(
  driver: PgDriver,
  schemaName: string,
  tableName: string,
): Promise<TableColumn[]> {
  const result = await driver.query(
    `SELECT column_name AS "name", data_type AS "dataType"
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position`,
    [schemaName, tableName],
  );
  return result.rows.map((row) => ({
    name: String(row.name),
    dataType: String(row.dataType),
  }));
}

export async function estimateRowCount(
  driver: PgDriver,
  schemaName: string,
  tableName: string,
): Promise<number> {
  try {
    const result = await driver.query(
      `SELECT reltuples::bigint AS estimate
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relname = $2`,
      [schemaName, tableName],
    );
    return Number(result.rows[0]?.estimate ?? 0);
  } catch {
    return 0;
  }
}

export async function streamSelect(
  driver: PgDriver,
  schemaName: string,
  tableName: string,
  cap: number,
  onRow: (row: Row) => void | Promise<void>,
): Promise<void> {
  const result = await driver.query(
    `SELECT * FROM ${identifier(schemaName)}.${identifier(tableName)} LIMIT $1`,
    [cap],
  );
  for (const row of result.rows) {
    await onRow(row);
  }
}

export function externalValueToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}