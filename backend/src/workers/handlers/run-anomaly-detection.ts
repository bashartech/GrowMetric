import type { Job } from "@prisma/client";
import { completeJob, failJob } from "../../jobs/queue.js";
import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";
import { recordUsage, checkFeatureAvailability } from "../../modules/entitlements/entitlement.service.js";
import { scan } from "../../modules/anomalies/anomaly.service.js";
import { RecommendationService } from "../../modules/recommendations/recommendation.service.js";
import { NotificationService } from "../../modules/notifications/notification.service.js";
import { resolveWorkspaceId } from "../../lib/workspace.js";
import { sendEmail } from "../../lib/email/email.service.js";

/**
 * Anomalies used to create an in-app notification only, so "email me when the
 * data looks wrong" never happened: the `anomaly_detected` template existed but
 * nothing called it. Recipients come from the enabled alert rules in the same
 * workspace, which is where a user has already declared who wants telling.
 */
async function emailAnomaly(
  organizationId: string,
  workspaceId: string,
  anomaly: { metricId: string | null; kind: string; period: string; deviationPct: unknown },
): Promise<void> {
  try {
    const rules = await prisma.alertRule.findMany({
      where: { organizationId, workspaceId, enabled: true },
      select: { recipients: true },
    });
    const recipients = new Set<string>();
    for (const rule of rules) {
      const list = rule.recipients as unknown;
      if (!Array.isArray(list)) continue;
      for (const entry of list) {
        if (typeof entry === "string" && entry.includes("@")) recipients.add(entry);
      }
    }
    if (recipients.size === 0) {
      logger.debug(
        { organizationId, workspaceId },
        "Anomaly email skipped: no enabled alert rule declares recipients.",
      );
      return;
    }

    const deviation =
      anomaly.deviationPct !== null && anomaly.deviationPct !== undefined
        ? Number(anomaly.deviationPct)
        : null;
    await sendEmail({
      to: [...recipients],
      subject: `Anomaly detected: ${anomaly.metricId ?? "metric"}`,
      template: "anomaly_detected",
      templateVars: {
        metricKind: anomaly.metricId ?? "unknown metric",
        period: anomaly.period,
        kind: anomaly.kind,
        deviationPct: deviation === null ? "unknown" : deviation.toFixed(1),
        baseline: "compared against the previous periods",
        observed: "see the anomaly details in GrowMetrics",
      },
      organizationId,
    });
  } catch (error) {
    // The anomaly is already persisted and notified in-app. A failed email must
    // not fail the job or lose the anomaly.
    logger.error(
      { organizationId, workspaceId, error },
      "Anomaly email failed to enqueue.",
    );
  }
}

export async function processRunAnomalyDetectionJob(job: Job): Promise<void> {
  try {
    const orgId = job.organizationId!;
    const payload = (job.payload ?? {}) as { workspaceId?: string };
    // Never forward an empty/malformed workspaceId into a `@db.Uuid` filter.
    const wid = await resolveWorkspaceId(orgId, payload.workspaceId);

    // A scheduled scan costs the tenant an `anomalyDetection` unit, but a job
    // has no response to reject. Ask first and skip cleanly; billing after the
    // work and swallowing the 402 would hand out the scan for free.
    const availability = await checkFeatureAvailability(orgId, "anomalyDetection");
    if (!availability.allowed) {
      logger.warn(
        { jobId: job.id, organizationId: orgId, reason: availability.reason },
        "Skipping anomaly detection: plan does not allow it.",
      );
      await completeJob(job.id);
      return;
    }

    // The scan must be scoped to this job's tenant. It used to run unscoped,
    // which meant one organization's scheduled job read and wrote every other
    // organization's datasets.
    const scanResult = await scan({ organizationId: orgId, workspaceId: wid });
    const recService = new RecommendationService(prisma);
    await recService.generate(wid, orgId);
    const notifService = new NotificationService(prisma);
    for (const anomaly of scanResult.anomalies) {
      await notifService.createForOrganization(
        orgId,
        `Anomaly detected: ${anomaly.metricId}`,
        `${anomaly.kind} of ${anomaly.deviationPct.toFixed(1)}% in ${anomaly.period}`,
      );
      await emailAnomaly(orgId, wid, anomaly);
    }
    if (scanResult.anomalies.length > 0) {
        try {
          await recordUsage(orgId, "anomaly_detection", 1);
        } catch (error) {
          // The anomalies are already persisted, so failing here would undo
          // nothing and would re-run a non-idempotent notify loop. Log the
          // unbilled unit instead of swallowing it.
          logger.error(
            { jobId: job.id, organizationId: orgId, error },
            "Anomaly metering exceeded the plan quota after the scan.",
          );
        }
      }
    await completeJob(job.id);
    logger.info({ anomalies: scanResult.anomalies.length, scanned: scanResult.scanned }, "Anomaly detection job completed.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown anomaly detection failure.";
    logger.error({ jobId: job.id, error }, "Anomaly detection job failed.");
    await failJob(job.id, message);
  }
}
