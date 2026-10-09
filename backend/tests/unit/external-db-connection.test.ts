import { describe, expect, it } from "vitest";
import {
  describeConnectionError,
  parseConnectionUrl,
  type ExternalDbConfig,
} from "../../src/lib/external-db.js";

const CONFIG: ExternalDbConfig = {
  host: "ep-hidden-branch.us-east-2.aws.neon.tech",
  port: 5432,
  database: "neondb",
  username: "neondb_owner",
  password: "secret",
  sslMode: "require",
};

describe("parseConnectionUrl", () => {
  it("returns null for a plain hostname", () => {
    expect(parseConnectionUrl("ep-hidden.us-east-2.aws.neon.tech", {})).toBeNull();
  });

  it("parses a postgres connection string into separate fields", () => {
    const parsed = parseConnectionUrl(
      "postgresql://neondb_owner:plainsecret@ep-hidden-branch.us-east-2.aws.neon.tech:5432/neondb",
      {},
    );
    expect(parsed).not.toBeNull();
    expect(parsed).toEqual({
      host: "ep-hidden-branch.us-east-2.aws.neon.tech",
      port: 5432,
      database: "neondb",
      username: "neondb_owner",
      password: "plainsecret",
      sslMode: "require",
    });
  });

  it("percent-decodes credentials from the URL", () => {
    const parsed = parseConnectionUrl(
      "postgresql://dd%40company:p%40ss%23word@db.example.com:5432/sales",
      {},
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.username).toBe("dd@company");
    expect(parsed!.password).toBe("p@ss#word");
  });

  it("falls back to the provided defaults for missing parts", () => {
    const parsed = parseConnectionUrl("postgres://db.example.com/dbname", {
      port: 5433,
      username: "fallback_user",
      sslMode: "prefer",
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.port).toBe(5433);
    expect(parsed!.database).toBe("dbname");
    expect(parsed!.username).toBe("fallback_user");
    expect(parsed!.sslMode).toBe("prefer");
  });

  it("honors sslmode query parameter", () => {
    const parsed = parseConnectionUrl(
      "postgresql://u:p@db.example.com:5432/db?sslmode=disable",
      {},
    );
    expect(parsed!.sslMode).toBe("disable");
  });

  it("returns null on an unparseable URL shape", () => {
    expect(parseConnectionUrl("postgresql://", {})).toBeNull();
    expect(parseConnectionUrl("not a url at all", {})).toBeNull();
  });

  it("passes through Neon-style passwords with * and _ characters untouched", () => {
    const parsed = parseConnectionUrl(
      "postgresql://neondb_owner:np********tM9@ep-wandering-river-b5vksc1a-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
      {},
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.host).toBe(
      "ep-wandering-river-b5vksc1a-pooler.c-7.us-east-2.aws.neon.tech",
    );
    expect(parsed!.port).toBe(5432);
    expect(parsed!.database).toBe("neondb");
    expect(parsed!.username).toBe("neondb_owner");
    expect(parsed!.password).toBe("np********tM9");
    expect(parsed!.sslMode).toBe("require");
  });
});

describe("describeConnectionError", () => {
  it("maps an unresolvable host to an actionable message", () => {
    const error = new Error("getaddrinfo ENOTFOUND ep.example.com");
    (error as Error & { code?: string }).code = "ENOTFOUND";
    const message = describeConnectionError(error, CONFIG);
    expect(message).toContain(CONFIG.host);
    expect(message).toContain("hostname only");
  });

  it("maps password authentication failure to the 28P01 message", () => {
    const error = new Error('password authentication failed for user "neondb_owner"');
    (error as Error & { code?: string }).code = "28P01";
    expect(describeConnectionError(error, CONFIG)).toContain(
      "Password authentication failed",
    );
  });

  it("maps a missing database to the 3D000 message", () => {
    const error = new Error('database "neondb" does not exist');
    (error as Error & { code?: string }).code = "3D000";
    const message = describeConnectionError(error, CONFIG);
    expect(message).toContain("neondb");
    expect(message).toContain("does not exist");
  });

  it("advises SSL mode when the error mentions ssl", () => {
    const error = new Error('The server does not support SSL connections');
    expect(describeConnectionError(error, CONFIG)).toContain("SSL");
  });

  it("keeps the generic message plus the driver error for unknown failures", () => {
    const error = new Error("garbled internal error");
    (error as Error & { code?: string }).code = "XX000";
    const message = describeConnectionError(error, CONFIG);
    expect(message).toContain("Could not connect to the external database.");
    expect(message).toContain("garbled internal error");
  });
});