import { describe, expect, it } from "vitest";
import { isConnectionUrl, parseConnectionUrl } from "@/lib/external-db";

describe("isConnectionUrl", () => {
  it("accepts postgres and postgresql schemes", () => {
    expect(isConnectionUrl("postgres://user:pass@host/db")).toBe(true);
    expect(isConnectionUrl("postgresql://user:pass@host/db")).toBe(true);
  });

  it("accepts surrounding whitespace", () => {
    expect(isConnectionUrl("  postgresql://user:pass@host/db  ")).toBe(true);
  });

  it("rejects non-postgres schemes, plain hosts, and empty strings", () => {
    expect(isConnectionUrl("https://host/db")).toBe(false);
    expect(isConnectionUrl("db.example.com")).toBe(false);
    expect(isConnectionUrl("")).toBe(false);
  });
});

describe("parseConnectionUrl", () => {
  it("parses host, port, database, username and password", () => {
    expect(
      parseConnectionUrl("postgresql://readonly_user:secret@db.example.com:6432/analytics"),
    ).toEqual({
      host: "db.example.com",
      port: 6432,
      database: "analytics",
      username: "readonly_user",
      password: "secret",
      sslMode: "require",
    });
  });

  it("accepts the postgres scheme", () => {
    const parsed = parseConnectionUrl("postgres://u:p@h.pg/db");
    expect(parsed?.host).toBe("h.pg");
  });

  it("percent-decodes credentials", () => {
    const parsed = parseConnectionUrl(
      "postgresql://neo%40user:unreal%20p%40ss@host/db",
    );
    expect(parsed?.username).toBe("neo@user");
    expect(parsed?.password).toBe("unreal p@ss");
  });

  it("defaults the port to 5432 when absent", () => {
    expect(parseConnectionUrl("postgresql://u:p@host/db")?.port).toBe(5432);
  });

  it("defaults sslMode to require", () => {
    expect(parseConnectionUrl("postgresql://u:p@host/db")?.sslMode).toBe(
      "require",
    );
  });

  it("reads sslmode=disable and sslmode=prefer from the query string", () => {
    expect(
      parseConnectionUrl("postgresql://u:p@host/db?sslmode=disable")?.sslMode,
    ).toBe("disable");
    expect(
      parseConnectionUrl("postgresql://u:p@host/db?sslmode=prefer")?.sslMode,
    ).toBe("prefer");
  });

  it("allows an empty database path", () => {
    const parsed = parseConnectionUrl("postgresql://u:p@host?sslmode=disable");
    expect(parsed?.database).toBe("");
    expect(parsed?.host).toBe("host");
  });

  it("trims surrounding whitespace before parsing", () => {
    const parsed = parseConnectionUrl("  postgresql://u:p@host/db  ");
    expect(parsed?.host).toBe("host");
  });

  it("returns null for a plain hostname, invalid URLs, or empty input", () => {
    expect(parseConnectionUrl("db.example.com")).toBeNull();
    expect(parseConnectionUrl("postgresql://")).toBeNull();
    expect(parseConnectionUrl("")).toBeNull();
  });
});