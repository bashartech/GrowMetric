import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const envFile = resolve(process.cwd(), ".env");
if (existsSync(envFile) && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(envFile);
  } catch {
    // ignore; environment may already be populated
  }
}

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().optional(),
  JWT_ACCESS_SECRET: z
    .string()
    .min(16, "JWT_ACCESS_SECRET must be at least 16 characters"),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: z
    .string()
    .default("false")
    .transform((value) => value === "true"),
  OPENROUTER_API_KEY: z.string().optional(),
  AI_BASE_URL: z.string().default("https://openrouter.ai/api/v1"),
  AI_MODEL: z.string().default("nvidia/nemotron-3-ultra-550b-a55b:free"),
  AI_MAX_STEPS: z.coerce.number().int().positive().default(32),
  AI_MAX_TOOL_CALLS: z.coerce.number().int().positive().default(40),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(300000),
  AI_MAX_TOKENS: z.coerce.number().int().positive().default(8192),
  AI_MAX_INPUT_TOKENS: z.coerce.number().int().positive().optional(),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().optional(),
  AI_ENABLED: z
    .string()
    .default("true")
    .transform((value) => value === "true"),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_ENDPOINT: z.string().optional(),
  UPLOAD_DIR: z.string().default("./uploads"),
  IMPORT_ROW_CAP: z.coerce.number().int().positive().default(200000),
  IMPORT_MAX_FILE_BYTES: z.coerce.number().int().positive().default(26214400),
  DATA_SOURCE_ENCRYPTION_KEY: z.string().optional(),
  // Automation (Phase 4)
  ANOMALY_SCAN_INTERVAL_MS: z.coerce.number().int().positive().default(3600000),
  ANOMALY_DEVIATION_THRESHOLD: z.coerce.number().int().positive().default(30),
  /**
   * Width of the "current" period in days, and therefore of the baseline
   * period immediately before it. F1: the scan used to hardcode July 2026, so
   * every scan returned nothing for any other data.
   */
  ANOMALY_PERIOD_DAYS: z.coerce.number().int().positive().default(30),
  /**
   * How many trailing periods form the baseline (B11.3).
   *
   * The scan used to compare against exactly one preceding period, which is
   * noisy: a single odd week either hides a real trend or invents one. With
   * this many periods the deviation is measured against their mean, and the
   * spread between them is recorded so the evidence is auditable.
   */
  ANOMALY_BASELINE_PERIODS: z.coerce.number().int().min(1).default(4),
  ALERT_DEDUP_WINDOW_MS: z.coerce.number().int().positive().default(3600000),
  REPORT_MAX_RETRIES: z.coerce.number().int().positive().default(3),
  EMAIL_FROM: z.string().default("bashartc14@gmail.com"),
  /**
   * Public origin of the frontend. Used to build the link inside the
   * `report_generated` email, which the email template requires. Optional so a
   * backend-only deployment still boots; without it the email links to the
   * in-app path instead of an absolute URL.
   */
  APP_URL: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration -> ${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();

/**
 * Evaluated at call time so a worker/test process can flip AI_ENABLED without
 * reloading the whole config module (SUGGEST_MAPPING enqueue gate).
 */
export const isAiEnabled = (): boolean =>
  (process.env.AI_ENABLED ?? "false").toLowerCase() === "true";
