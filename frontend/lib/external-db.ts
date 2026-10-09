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

export const isConnectionUrl = (value: string): boolean =>
  CONNECTION_URL_PATTERN.test(value.trim());

export const parseConnectionUrl = (
  value: string,
): ParsedConnectionUrl | null => {
  const trimmed = value.trim();
  if (!isConnectionUrl(trimmed)) return null;

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
    port: url.port ? Number(url.port) : 5432,
    database,
    username: decodeCredential(url.username),
    password: decodeCredential(url.password),
    sslMode:
      sslModeParam === "disable"
        ? "disable"
        : sslModeParam === "prefer"
          ? "prefer"
          : "require",
  };
};