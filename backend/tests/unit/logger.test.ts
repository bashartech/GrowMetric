import pino from "pino";
import { describe, expect, it } from "vitest";
import {
  buildLoggerOptions,
  censor,
  isSensitiveString,
  redactPaths,
  redactSensitiveStrings,
} from "../../src/lib/logger.js";

function captureLog(payload: Record<string, unknown>): string {
  const chunks: string[] = [];
  const destination = {
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
  };

  const logger = pino(
    { ...buildLoggerOptions("production"), level: "info" },
    destination,
  );
  logger.info(payload, "test event");

  return chunks.join("");
}

describe("logger redaction", () => {
  it("redacts cookies, authorization, and credentials", () => {
    const output = captureLog({
      req: {
        headers: {
          cookie: "dd_access=super-secret-token",
          authorization: "Bearer super-secret-token",
        },
      },
      password: "super-secret-password",
      refreshToken: "super-secret-refresh",
    });

    expect(output).not.toContain("super-secret");
    expect(output).toContain(censor);
  });

  it("redacts file payloads so upload contents never appear in logs", () => {
    const output = captureLog({
      file: {
        originalName: "sales.csv",
        buffer: Buffer.from("super-secret-file-bytes"),
      },
      imported: {
        file: { contents: "super-secret-file-bytes-part-two" },
      },
    });

    expect(output).not.toContain("super-secret-file-bytes");
    expect(output).not.toContain("sales.csv");
    expect(output).toContain(censor);
  });

  it("redacts DATABASE_URL", () => {
    const output = captureLog({
      DATABASE_URL: "postgres://user:super-secret-pw@host:5432/db",
    });

    expect(output).not.toContain("super-secret-pw");
    expect(output).toContain(censor);
  });

  it("exposes a non-empty redaction path list including env secrets", () => {
    expect(redactPaths).toContain("req.headers.cookie");
    expect(redactPaths).toContain("password");
    expect(redactPaths).toContain("GROQ_API_KEY");
    expect(redactPaths).toContain("DATABASE_URL");
  });

  it("redacts SMTP_PASS values", () => {
    const output = captureLog({
      SMTP_PASS: "smtp-super-secret",
    });
    expect(output).not.toContain("smtp-super-secret");
    expect(output).toContain(censor);
  });

  it("redacts GROQ_API_KEY values regardless of the key they appear under", () => {
    const output = captureLog({
      agent: {
        config: {
          GROQ_API_KEY: "gsk_secret-value-that-must-never-leak",
          baseUrl: "https://api.groq.com/openai/v1",
        },
      },
    });

    expect(output).not.toContain("secret-value-that-must-never-leak");
    expect(output).toContain(censor);
  });

  it("redacts a top-level GROQ_API_KEY payload", () => {
    const output = captureLog({
      GROQ_API_KEY: "gsk_top-level-secret-key",
    });

    expect(output).not.toContain("gsk_top-level-secret-key");
  });

  it("classifies credential-like strings for value-level sanitization", () => {
    expect(isSensitiveString("gsk_abcdef123456")).toBe(true);
    expect(isSensitiveString("Bearer sk-proj-1234567890")).toBe(true);
    expect(isSensitiveString("apiKey=super-secret")).toBe(true);
    expect(isSensitiveString("llama-3.3-70b-versatile")).toBe(false);
    expect(isSensitiveString("revenue grew 8.2%")).toBe(false);
  });

  it("recursively sanitizes nested tool output without structural loss", () => {
    const sanitized = redactSensitiveStrings({
      tool: "run_readonly_sql",
      args: { apiKey: "gsk_nested-secret" },
      output: { rows: [{ total: 482100.5 }], providerNote: "Bearer sk-live-x" },
    });

    expect(sanitized).toEqual({
      tool: "run_readonly_sql",
      args: { apiKey: censor },
      output: {
        rows: [{ total: 482100.5 }],
        providerNote: censor,
      },
    });
  });
});
