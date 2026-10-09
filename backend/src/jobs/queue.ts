import { Prisma } from "@prisma/client";
import type { Job, JobStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { signalQueuedJob } from "../lib/redis.js";

export const MAX_ATTEMPTS = 3;

/**
 * Job types the user is actively waiting on. `claimNextJob` claims these
 * before any older background job (anomaly scans, alert evaluations, report
 * generation), so a scheduler burst can never park a chat question behind
 * minutes of automation work.
 */
export const INTERACTIVE_JOB_TYPES = [
  "RUN_ANALYST",
  "RUN_INVESTIGATION",
  "RUN_SIMULATION",
  "SUGGEST_MAPPING",
] as const;

export type JobInput = Pick<
  Job,
  "type" | "payload" | "organizationId"
> & {
  runInSeconds?: number;
};

export async function enqueueJob(input: JobInput): Promise<Job> {
  const job = await prisma.job.create({
    data: {
      type: input.type,
      payload: (input.payload ?? {}) as Prisma.InputJsonValue,
      organizationId: input.organizationId,
      status: "PENDING",
      runAt: new Date(Date.now() + (input.runInSeconds ?? 0) * 1000),
    },
  });
  await signalQueuedJob(job.type, job.id);
  return job;
}

/**
 * Claims the oldest PENDING job matching `where`, guarded by a conditional
 * UPDATE so two workers racing the same row produce exactly one claim.
 */
const claimCandidate = async (where: Prisma.JobWhereInput): Promise<Job | null> => {
  const job = await prisma.job.findFirst({
    where,
    orderBy: { runAt: "asc" },
    take: 1,
  });
  if (!job) return null;
  const updated = await prisma.job.updateMany({
    where: { id: job.id, status: "PENDING" },
    data: {
      status: "RUNNING",
      attempts: { increment: 1 },
      startedAt: new Date(),
    },
  });
  return updated.count === 1 ? job : null;
};

export async function claimNextJob(): Promise<Job | null> {
  const due: Prisma.JobWhereInput = {
    status: "PENDING",
    runAt: { lte: new Date() },
    attempts: { lt: MAX_ATTEMPTS },
  };

  const interactive = await claimCandidate({
    ...due,
    type: { in: [...INTERACTIVE_JOB_TYPES] },
  });
  if (interactive) return interactive;

  return claimCandidate(due);
}

export async function claimById(jobId: string): Promise<Job | null> {
  const updated = await prisma.job.updateMany({
    where: { id: jobId, status: "PENDING" },
    data: { status: "RUNNING", attempts: { increment: 1 }, startedAt: new Date() },
  });
  if (updated.count !== 1) return null;
  return prisma.job.findUnique({ where: { id: jobId } });
}

/**
 * Claims the oldest PENDING job of a specific type — used by Redis-signal
 * consumers so a wake-up never races another worker into the same job.
 */
export async function claimByType(type: string): Promise<Job | null> {
  const job = await prisma.job.findFirst({
    where: {
      type,
      status: "PENDING",
      runAt: { lte: new Date() },
      attempts: { lt: MAX_ATTEMPTS },
    },
    orderBy: { runAt: "asc" },
    take: 1,
  });
  if (!job) return null;
  return claimById(job.id);
}

export async function completeJob(jobId: string): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
}

export async function failJob(jobId: string, error: string): Promise<void> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  const attempts = (job?.attempts ?? 0) + 1;
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
      lastError: error.slice(0, 500),
      ...(attempts >= MAX_ATTEMPTS
        ? {}
        : { runAt: new Date(Date.now() + 60_000) }),
    },
  });
}

export async function requeueJobForMapping(jobId: string): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: "PENDING", runAt: new Date(Date.now() + 30_000) },
  });
}

/**
 * Terminally voids a job without retry — used when a user cancels an in-flight
 * analyst run before the worker picks it up. The conversation stays intact.
 */
export async function cancelJob(jobId: string, reason: string): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: "FAILED",
      lastError: reason.slice(0, 500),
      completedAt: new Date(),
    },
  });
}

/**
 * Returns `RUNNING` jobs abandoned by a dead worker back to `PENDING`.
 *
 * A job flips to `RUNNING` when claimed and only leaves that state via
 * `completeJob`/`failJob`, both of which run inside the worker process. If the
 * process is killed — Ctrl+C during `npm run worker`, a crash, a terminal
 * closing — the job stays `RUNNING` forever. `claimNextJob` only ever looks at
 * `PENDING`, so nothing picks it up again: the work is silently lost and its
 * `EmailDelivery` sits at `QUEUED` indefinitely. That is exactly how alerts
 * created minutes before a worker restart appeared to "never send".
 *
 * Only jobs older than `staleAfterMs` are touched, so a slow-but-alive job on
 * another worker instance is never stolen out from under it.
 */
export async function reclaimStaleJobs(staleAfterMs = 5 * 60_000): Promise<number> {
  const cutoff = new Date(Date.now() - staleAfterMs);
  const { count } = await prisma.job.updateMany({
    where: { status: "RUNNING", startedAt: { lt: cutoff } },
    data: {
      status: "PENDING",
      // Clear the claim so the retry is scheduled immediately rather than being
      // blocked by the original runAt, and record why it came back.
      runAt: new Date(),
      startedAt: null,
      lastError: "Reclaimed: previous worker died while this job was RUNNING.",
    },
  });
  return count;
}

export function isTerminalStatus(status: JobStatus): boolean {
  return status === "COMPLETED" || status === "FAILED";
}