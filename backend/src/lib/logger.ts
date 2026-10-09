import pino, { type LoggerOptions } from "pino";
import { env } from "../config/env.js";

export const redactPaths = [
  "req.headers.cookie",
  "req.headers.authorization",
  "res.headers['set-cookie']",
  "password",
  "*.password",
  "passwordHash",
  "*.passwordHash",
  "token",
  "*.token",
  "refreshToken",
  "*.refreshToken",
  "accessToken",
  "*.accessToken",
  "apiKey",
  "*.apiKey",
  "api_key",
  "*.api_key",
  "secret",
  "*.secret",
  "authorization",
  "*.authorization",
  "OPENROUTER_API_KEY",
  "*.OPENROUTER_API_KEY",
  "agent.config.OPENROUTER_API_KEY",
  "GROQ_API_KEY",
  "*.GROQ_API_KEY",
  "agent.config.GROQ_API_KEY",
  "*.GROQ_API_KEY",
  "DATABASE_URL",
  "REDIS_URL",
  "SMTP_PASS",
  "*.SMTP_PASS",
  "SMTP_USER",
  "*.SMTP_USER",
  "file",
  "*.file",
  "fileBuffer",
  "*.fileBuffer",
  "buffer",
  "*.buffer",
  "contents",
  "*.contents",
];

export const censor = "[REDACTED]";

/**
 * Value-level sanitizer: recursively replaces credential-like strings
 * (e.g. Groq keys `gsk_...`) with the censor marker regardless of the
 * object key they appear under. Used before persisting agent tool I/O
 * and before handing data to the provider/logger (Principle XII).
 */
export function redactSensitiveStrings<T>(value: T): T {
  return redactWalk(value) as T;
}

function redactWalk(value: unknown): unknown {
  if (typeof value === "string") {
    return isSensitiveString(value) ? censor : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactWalk(item));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = redactWalk(entry);
    }
    return out;
  }
  return value;
}

export function isSensitiveString(value: string): boolean {
  return (
    value.startsWith("gsk_") ||
    /(Bearer\s+|)(sk-[A-Za-z0-9_-]{4,})/.test(value) ||
    /(api[_-]?key|secret|authorization)\s*[=:]\s*\S+/i.test(value)
  );
}

export function buildLoggerOptions(nodeEnv: string): LoggerOptions {
  const options: LoggerOptions = {
    level: nodeEnv === "test" ? "silent" : "info",
    redact: { paths: redactPaths, censor },
  };

  if (nodeEnv === "development") {
    options.transport = {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
      },
    };
  }

  return options;
}

export const logger = pino(buildLoggerOptions(env.NODE_ENV));
