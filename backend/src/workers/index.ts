import { claimNextJob, failJob, reclaimStaleJobs } from "../jobs/queue.js";
import { logger } from "../lib/logger.js";
import { isRedisEnabled, consumeAiSignal } from "../lib/redis.js";
import { runHandler } from "./registry.js";
import { startScheduler, type SchedulerHandle } from "./scheduler.js";

export async function pollOnce(): Promise<void> {
  const job = await claimNextJob();
  if (!job) return;
  try {
    await runHandler(job);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown job failure.";
    logger.error({ jobId: job.id, type: job.type, error }, "Job handler threw.");
    await failJob(job.id, message);
  }
}

/**
 * Waits up to signalTimeoutSeconds for a Redis wake-up, claims the job by id
 * (atomic UPDATE on the jobs table), then runs it. The signal is an optional
 * accelerator — the polling loop below remains the always-on fallback (R4).
 */
export async function consumeOneSignal(timeoutSeconds = 1): Promise<boolean> {
  const signal = await consumeAiSignal(timeoutSeconds);
  if (!signal) return false;
  const { claimById } = await import("../jobs/queue.js");
  const job = await claimById(signal.jobId);
  if (!job) {
    logger.debug({ jobId: signal.jobId }, "Signal received but job was already claimed.");
    return true;
  }
  try {
    await runHandler(job);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown job failure.";
    logger.error({ jobId: job.id, type: job.type, error }, "Job handler threw.");
    await failJob(job.id, message);
  }
  return true;
}

export async function startWorker(options: { intervalMs?: number; runOnce?: boolean } = {}): Promise<void> {
  const intervalMs = options.intervalMs ?? 2_000;
  const redisEnabled = isRedisEnabled();

  // Anything left RUNNING by a previous process was abandoned when that process
  // died, so it has to go back into the queue before polling starts. Skipped in
  // `--run-once` mode: a single-shot worker must not mutate the shared queue.
  if (!options.runOnce) {
    try {
      const reclaimed = await reclaimStaleJobs();
      if (reclaimed > 0) {
        logger.warn({ reclaimed }, "Reclaimed jobs abandoned by a previous worker.");
      }
    } catch (error) {
      logger.error({ error }, "Failed to reclaim stale jobs; continuing to poll.");
    }
  }

  logger.info({ intervalMs, redisEnabled }, "Job worker started.");

  // The scheduler runs alongside the poll loop, but never in `--run-once` mode:
  // a single-shot worker must not leave cron timers behind that enqueue jobs
  // into an unrelated test run.
  let scheduler: SchedulerHandle | null = null;
  if (!options.runOnce) {
    scheduler = startScheduler();
  }

  const stopScheduler = () => {
    scheduler?.stop();
    scheduler = null;
  };
  process.once("SIGINT", stopScheduler);
  process.once("SIGTERM", stopScheduler);

  try {
    while (true) {
      try {
        if (redisEnabled) {
          const consumed = await consumeOneSignal(0.5);
          if (consumed) {
            if (options.runOnce) break;
            continue;
          }
        }
        await pollOnce();
      } catch (error) {
        logger.error({ error }, "Worker poll cycle failed.");
      }
      if (options.runOnce) break;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  } finally {
    stopScheduler();
  }
}