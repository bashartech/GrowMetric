import cron from "node-cron";
import type { ScheduledTask } from "node-cron";
import type { ReportScheduleFrequency } from "@prisma/client";
import type { JsonValue } from "@prisma/client/runtime/library";
import { env } from "../config/env.js";
import { ANALYTICS_READY_STATUSES } from "../lib/dataset-status.js";
import { enqueueJob } from "../jobs/queue.js";
import { logger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import { nextRunAt } from "../lib/schedule-cadence.js";
import { checkFeatureAvailability } from "../modules/entitlements/entitlement.service.js";

/**
 * Automation scheduler (research R1, fixes C1-C4).
 *
 * Nothing in the system ever enqueued `RUN_ANOMALY_DETECTION`,
 * `EVALUATE_ALERT_RULES` or scheduled `GENERATE_REPORT`, so the entire
 * automation loop was dormant: alerts, anomaly detection and recurring reports
 * only worked if a human triggered them over HTTP.
 *
 * Every tick is defensive in the same three ways:
 *
 *  1. **Idempotent** — a tick that finds work already queued skips it, so a
 *     restart (or several replicas on Hugging Face) cannot stack duplicate
 *     scans or send the same report twice.
 *  2. **Atomic** — `nextRunAt` is advanced with a conditional `updateMany`
 *     that only matches a still-due row, so two schedulers racing the same
 *     schedule produce exactly one job.
 *  3. **Isolated** — one failing organization or schedule is logged and
 *     skipped rather than aborting the whole tick.
 */

/**
 * node-cron only offers sub-minute resolution through six-field expressions
 * (a seconds field with a step), which caps out at 59 seconds. The default
 * anomaly interval is an hour, so mapping an interval onto a cron field is not
 * possible for the intervals that actually matter.
 *
 * Instead every interval-driven tick runs on a fixed one-minute heartbeat and
 * decides for itself whether enough time has passed. The interval is enforced
 * against the jobs table (see `recentlyScheduled`), not process memory: an
 * in-memory gate resets on every worker restart, and its first tick after boot
 * always fires, which is what used to enqueue the full anomaly + alert backlog
 * within seconds of a restart. The jobs table survives restarts, so a tenant is
 * due only when it has had no job of that type within `intervalMs`.
 */
const HEARTBEAT_CRON = "* * * * *";

/** Reads the `workspaceId` a job payload is keyed on, if present. */
const payloadWorkspaceId = (payload: unknown): string => {
  const workspaceId = (payload as { workspaceId?: unknown } | null)?.workspaceId;
  return typeof workspaceId === "string" ? workspaceId : "";
};

/**
 * Tenants that already had a job of `type` enqueued within the last
 * `intervalMs`, keyed `organizationId:workspaceId` (or `organizationId:` for
 * callers with no workspace to key on).
 */
const recentlyScheduled = async (
  type: string,
  intervalMs: number,
): Promise<Set<string>> => {
  const rows = await prisma.job.findMany({
    where: { type, createdAt: { gte: new Date(Date.now() - intervalMs) } },
    select: { organizationId: true, payload: true },
  });
  return new Set(
    rows.map((row) => `${row.organizationId ?? ""}:${payloadWorkspaceId(row.payload)}`),
  );
};

/**
 * Whether a job of this type is already queued or running for the tenant.
 *
 * `workspaceId` is part of the key for every job that is scoped per workspace
 * (anomaly scans, alert rules): deduping on the organization alone would let
 * one workspace's pending job suppress every other workspace in the same
 * tenant, leaving those workspaces silently unscanned.
 */
async function hasOutstandingJob(
  type: string,
  organizationId: string,
  workspaceId?: string,
): Promise<boolean> {
  const existing = await prisma.job.findFirst({
    where: {
      type,
      organizationId,
      status: { in: ["PENDING", "RUNNING"] },
      ...(workspaceId === undefined
        ? // Only used by callers that genuinely have no workspace to key on.
          {}
        : { payload: { path: ["workspaceId"], equals: workspaceId } }),
    },
    select: { id: true },
  });
  return existing !== null;
}

/**
 * Reads `ReportSchedule.recipients`, which is a `Json` column, into a list of
 * email addresses.
 *
 * The column is untyped, so it can hold a bare string, a non-array, or objects.
 * Anything that is not a non-empty string is dropped rather than forwarded to
 * the mailer: an invalid address would fail the whole generation job, and a
 * report that cannot be emailed should still be generated.
 */
function normalizeRecipients(stored: unknown): string[] {
  const list = Array.isArray(stored) ? stored : [stored];
  const seen = new Set<string>();
  for (const entry of list) {
    if (typeof entry !== "string") continue;
    const address = entry.trim();
    // Deliberately permissive: full RFC validation belongs to the mailer, and
    // over-filtering here would silently drop a valid address.
    if (address.includes("@")) seen.add(address);
  }
  return [...seen];
}

/**
 * Tick A — periodic anomaly detection (C2).
 *
 * Runs once per `ANOMALY_SCAN_INTERVAL_MS` for every `(organization, workspace)`
 * that has at least one analytics-ready dataset, since there is nothing to scan
 * otherwise. `READY_WITH_WARNINGS` counts as ready: the scan itself accepts it,
 * so filtering it out here would skip exactly the workspaces most likely to
 * want anomaly detection.
 *
 * The job is scoped per workspace rather than per organization because the scan
 * and the recommendations it produces both belong to a workspace. One
 * organization-wide job would leave every non-default workspace unscanned and
 * write all of its recommendations into the default workspace.
 */
export async function runAnomalyDetectionTick(): Promise<number> {
  // Durable interval gate first: a tenant that was scanned within the
  // configured interval is skipped even if the worker restarted in between,
  // so a restart can never replay the whole backlog.
  const due = await recentlyScheduled("RUN_ANOMALY_DETECTION", env.ANOMALY_SCAN_INTERVAL_MS);

  // Selected through the Organization relation rather than
  // `dataset.organizationId: { not: "" }`: datasets written before the email
  // tenant fix carry an empty-string organizationId, and filtering on that
  // column makes Postgres fail casting those rows — the tick would throw on
  // every run. Joining from Organization cannot match a real id to "", so the
  // orphaned rows are simply ignored. Without the join, `distinct` would also
  // hand us `organizationId: ""` and the enqueue would fail on the UUID cast.
  const organizations = await prisma.organization.findMany({
    where: { datasets: { some: { status: { in: ANALYTICS_READY_STATUSES } } } },
    select: {
      id: true,
      datasets: {
        where: { status: { in: ANALYTICS_READY_STATUSES } },
        distinct: ["workspaceId"],
        select: { workspaceId: true },
      },
    },
  });

  let enqueued = 0;
  for (const { id: organizationId, datasets } of organizations) {
    const dueWorkspaces = datasets.filter(
      (dataset) => !due.has(`${organizationId}:${dataset.workspaceId}`),
    );
    if (dueWorkspaces.length === 0) continue;

    // Scheduled work bypasses the API, so the entitlement that normally gates
    // anomaly detection at the route boundary has to be checked here. Without
    // this, a free tenant accrues a full scan of every workspace every hour.
    const anomalyAvailability = await checkFeatureAvailability(organizationId, "anomalyDetection");
    if (!anomalyAvailability.allowed) {
      logger.debug(
        { organizationId, reason: anomalyAvailability.reason },
        "Anomaly detection not in plan or quota exhausted; skipping.",
      );
      continue;
    }
    for (const { workspaceId } of dueWorkspaces) {
      try {
        if (await hasOutstandingJob("RUN_ANOMALY_DETECTION", organizationId, workspaceId)) {
          logger.debug({ organizationId, workspaceId }, "Anomaly scan already queued; skipping.");
          continue;
        }
        await enqueueJob({
          type: "RUN_ANOMALY_DETECTION",
          organizationId,
          payload: { workspaceId },
        });
        enqueued += 1;
      } catch (error) {
        logger.error({ organizationId, workspaceId, error }, "Failed to enqueue anomaly detection.");
      }
    }
  }

  return enqueued;
}

/**
 * Tick B — periodic alert rule evaluation (C3).
 *
 * Rules are stored per workspace, so each `(organization, workspace)` pair with
 * at least one enabled rule gets its own job.
 */
export async function runAlertRuleTick(): Promise<number> {
  // Same durable interval gate as the anomaly tick: the jobs table decides who
  // is due, so a worker restart cannot replay alert evaluations either. Alert
  // evaluation shares ANOMALY_SCAN_INTERVAL_MS by design.
  const due = await recentlyScheduled("EVALUATE_ALERT_RULES", env.ANOMALY_SCAN_INTERVAL_MS);

  const rules = await prisma.alertRule.findMany({
    where: { enabled: true },
    distinct: ["organizationId", "workspaceId"],
    select: { organizationId: true, workspaceId: true },
  });

  let enqueued = 0;
  for (const { organizationId, workspaceId } of rules) {
    try {
      if (due.has(`${organizationId}:${workspaceId}`)) continue;
      const alertAvailability = await checkFeatureAvailability(organizationId, "alerts");
      if (!alertAvailability.allowed) {
        logger.debug(
          { organizationId, workspaceId, reason: alertAvailability.reason },
          "Alerts not in plan or quota exhausted; skipping.",
        );
        continue;
      }
      if (await hasOutstandingJob("EVALUATE_ALERT_RULES", organizationId, workspaceId)) {
        logger.debug({ organizationId, workspaceId }, "Alert evaluation already queued; skipping.");
        continue;
      }
      await enqueueJob({
        type: "EVALUATE_ALERT_RULES",
        organizationId,
        payload: { workspaceId },
      });
      enqueued += 1;
    } catch (error) {
      logger.error({ organizationId, workspaceId, error }, "Failed to enqueue alert rule evaluation.");
    }
  }

  return enqueued;
}

/**
 * Tick C — due report schedules (C4).
 *
 * For every enabled schedule whose `nextRunAt` has passed, atomically claim the
 * slot and enqueue a generation job. The claim happens *before* the enqueue so
 * a crash mid-tick cannot re-fire the same run.
 */
/** A due schedule, as read by the tick. */
export interface DueSchedule {
  id: string;
  organizationId: string;
  workspaceId: string;
  reportId: string;
  frequency: ReportScheduleFrequency;
  cron: string | null;
  timezone: string;
  recipients: unknown;
  nextRunAt: Date;
}

/**
 * Claims one due schedule and enqueues its generation job.
 *
 * `enqueue` is injectable so the rollback path can be exercised without
 * stubbing Prisma. Spying on a Prisma delegate corrupts it for the rest of the
 * process, which silently breaks every later test in the file.
 *
 * Returns true when a job was enqueued for this schedule.
 */
export async function runDueSchedule(
  schedule: DueSchedule,
  now: Date,
  enqueue: (input: {
    type: string;
    organizationId: string;
    payload: JsonValue;
  }) => Promise<unknown>,
): Promise<boolean> {
  // A schedule created on a paid plan keeps firing after a downgrade. Claiming
  // first and then standing down would leave it advanced by a run that never
  // happened, so the entitlement is checked before the claim.
  const reportAvailability = await checkFeatureAvailability(schedule.organizationId, "reports");
  if (!reportAvailability.allowed) {
    logger.info(
      {
        scheduleId: schedule.id,
        organizationId: schedule.organizationId,
        reason: reportAvailability.reason,
        limit: reportAvailability.limit,
        used: reportAvailability.used,
      },
      "Reports not in plan or report quota exhausted; schedule run skipped.",
    );
    return false;
  }

  // Claim before enqueueing so a crash mid-tick cannot re-fire the same run.
  // The predicate requires the row to still be due, so a scheduler that already
  // advanced it gets count === 0 and stands down.
  // (`advancedRunAt`, not `nextRunAt`: a local named `nextRunAt` would shadow
  // the imported function for the whole block.)
  const advancedRunAt = nextRunAt(
    schedule.frequency,
    schedule.cron,
    now,
    schedule.timezone,
  );
  const claimed = await prisma.reportSchedule.updateMany({
    where: { id: schedule.id, enabled: true, nextRunAt: { lte: now } },
    data: { nextRunAt: advancedRunAt },
  });
  if (claimed.count !== 1) return false;

  try {
    await enqueue({
      type: "GENERATE_REPORT",
      organizationId: schedule.organizationId,
      // Recipients travel with the job rather than a separate SEND_EMAIL job:
      // the email must not be sent before the PDF exists, and two independent
      // jobs cannot be ordered against each other. The generation handler sends
      // once the report is actually GENERATED.
      payload: {
        reportId: schedule.reportId,
        scheduleId: schedule.id,
        recipients: normalizeRecipients(schedule.recipients),
      },
    });
  } catch (error) {
    // The slot was already advanced, so a transient enqueue failure would
    // silently skip this run. Restore the due value — only if it is still the
    // one we wrote, so a concurrent advance is not rolled back — and let the
    // next tick retry.
    await prisma.reportSchedule
      .updateMany({
        where: { id: schedule.id, nextRunAt: advancedRunAt },
        data: { nextRunAt: schedule.nextRunAt },
      })
      .catch((rollbackError) => {
        logger.error(
          { scheduleId: schedule.id, error: rollbackError },
          "Failed to roll back nextRunAt after an enqueue failure; this run is skipped.",
        );
      });
    throw error;
  }

  return true;
}

export async function runReportScheduleTick(now: Date = new Date()): Promise<number> {
  const due = await prisma.reportSchedule.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
    select: {
      id: true,
      organizationId: true,
      workspaceId: true,
      reportId: true,
      frequency: true,
      cron: true,
      timezone: true,
      recipients: true,
      nextRunAt: true,
    },
  });

  let enqueued = 0;
  for (const schedule of due) {
    // A schedule whose tenant is gone can never produce a job: `Job` carries an
    // `ON DELETE CASCADE` foreign key to `Organization`, so the insert below
    // fails with P2003 on every tick, forever. That produced a wall of
    // `Job_organizationId_fkey` errors once per minute per stale row. Retire it
    // instead so the noise stops and the cause is visible once.
    const tenantExists = await prisma.organization.findUnique({
      where: { id: schedule.organizationId },
      select: { id: true },
    });
    if (!tenantExists) {
      await prisma.reportSchedule.update({
        where: { id: schedule.id },
        data: { enabled: false },
      });
      logger.warn(
        { scheduleId: schedule.id, organizationId: schedule.organizationId },
        "Disabled report schedule: its organization no longer exists.",
      );
      continue;
    }

    try {
      if (await runDueSchedule(schedule, now, enqueueJob)) {
        enqueued += 1;
      }
    } catch (error) {
      logger.error(
        { scheduleId: schedule.id, organizationId: schedule.organizationId, error },
        "Failed to enqueue scheduled report.",
      );
    }
  }

  return enqueued;
}

export interface SchedulerHandle {
  /** Stops every registered cron task. */
  stop: () => void;
}

/**
 * Registers the automation ticks with node-cron and starts them.
 *
 * Call this from the worker process. The returned handle is what lets a test
 * (or a graceful shutdown) tear the tasks down, so a suite never leaves timers
 * running that would enqueue jobs into the next test.
 */
export function startScheduler(): SchedulerHandle {
  const tasks: ScheduledTask[] = [];

  const register = (name: string, expression: string, run: () => Promise<unknown>) => {
    const task = cron.schedule(expression, () => {
      void run().catch((error) => {
        logger.error({ task: name, error }, "Scheduler tick failed.");
      });
    });
    tasks.push(task);
    logger.info({ task: name, expression }, "Scheduler tick registered.");
  };

  // Interval-driven ticks share the one-minute heartbeat; each tick enforces
  // its own interval against the jobs table (see `recentlyScheduled`), so the
  // schedule is identical before and after a worker restart. Keeping alert
  // evaluation on its own registration means a slow anomaly scan can never
  // delay it.
  register("anomaly-detection", HEARTBEAT_CRON, runAnomalyDetectionTick);
  register("alert-rules", HEARTBEAT_CRON, runAlertRuleTick);
  // Report schedules are stored with a `nextRunAt`, so the only thing the tick
  // does is look for due rows. A minute of resolution is plenty and keeps the
  // query cheap.
  register("report-schedules", HEARTBEAT_CRON, runReportScheduleTick);

  return {
    stop: () => {
      for (const task of tasks) {
        try {
          task.stop();
        } catch (error) {
          logger.error({ error }, "Failed to stop scheduler task.");
        }
      }
      tasks.length = 0;
      logger.info("Scheduler stopped.");
    },
  };
}
