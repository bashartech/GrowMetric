import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

export const AI_JOB_TYPES = [
  "RUN_ANALYST",
  "RUN_INVESTIGATION",
  "RUN_SIMULATION",
  "SUGGEST_MAPPING",
  "RUN_ANOMALY_DETECTION",
  "EVALUATE_ALERT_RULES",
  "GENERATE_REPORT",
  "SEND_EMAIL",
] as const;

export type AiJobType = (typeof AI_JOB_TYPES)[number];

export function signalKeyFor(type: string): string {
  return `queue:${type}:signal`;
}

let redisClient: Redis | null | undefined;

/**
 * Failure warnings are throttled so an outage logs once per minute instead of
 * once per poll cycle: the fallback path (polling) always keeps the queue
 * moving, so repeated warnings would be pure noise.
 */
const WARN_THROTTLE_MS = 60_000;
let lastSignalWarnAt = 0;
let lastConsumeWarnAt = 0;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const throttled = (lastAt: number): boolean => {
  const now = Date.now();
  if (now - lastAt < WARN_THROTTLE_MS) return false;
  return true;
};

export function isRedisEnabled(): boolean {
  return Boolean(env.REDIS_URL);
}

async function getRedis(): Promise<Redis | null> {
  if (!isRedisEnabled()) return null;
  if (redisClient !== undefined) {
    return redisClient;
  }
  // lazyConnect: the first command opens the connection and ioredis keeps it
  // alive afterwards. Calling `connect()` per command (the old behaviour)
  // threw "Redis is already connecting/connected" on every call after the
  // first, so every signal after boot failed and the worker degraded to
  // pure polling while logging a warning per enqueue.
  redisClient = new Redis(env.REDIS_URL as string, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    connectionName: "dd-worker",
  });
  redisClient.on("error", (error: Error) => {
    logger.warn({ error: errorMessage(error) }, "Redis signal client error.");
  });
  return redisClient;
}

/**
 * LPUSHes a wake-up signal for a queued job. The jobs table stays the system
 * of record; Redis is only an optional prompt for consumeAiSignal (R4).
 */
export async function signalQueuedJob(type: string, jobId: string): Promise<boolean> {
  const client = await getRedis();
  if (!client) return false;
  try {
    await client.lpush(signalKeyFor(type), jobId);
    return true;
  } catch (error) {
    if (throttled(lastSignalWarnAt)) {
      lastSignalWarnAt = Date.now();
      logger.warn(
        { error: errorMessage(error), type },
        "Failed to push queue signal; polling will cover it.",
      );
    }
    return false;
  }
}

/**
 * Blocks up to timeoutSeconds for a signal LPUSHed by signalQueuedJob. Returns
 * the first available {type, jobId}. Consumers then claim the job atomically
 * on the jobs table so lost signals are never data loss (polling remains).
 */
export async function consumeAiSignal(timeoutSeconds: number): Promise<{ type: string; jobId: string } | null> {
  const client = await getRedis();
  if (!client) return null;
  try {
    // Redis takes an integer BRPOP timeout; a fractional value is rejected
    // outright, which would disable the signal path the moment it connects.
    const timeout = Math.max(1, Math.ceil(timeoutSeconds));
    const keys = AI_JOB_TYPES.map((type) => signalKeyFor(type));
    const result = await client.brpop(keys, timeout);
    if (!result) return null;
    const [key, jobId] = result;
    return { type: key.replace(/^queue:|:signal$/g, ""), jobId };
  } catch (error) {
    if (throttled(lastConsumeWarnAt)) {
      lastConsumeWarnAt = Date.now();
      logger.warn(
        { error: errorMessage(error) },
        "Failed to consume Redis signal; falling back to polling.",
      );
    }
    return null;
  }
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    try {
      await redisClient.disconnect();
    } catch {
      // ignore
    }
    redisClient = undefined;
  }
}