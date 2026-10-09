import type { Job } from "@prisma/client";
import { completeJob, failJob } from "../../jobs/queue.js";
import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";
import { recordUsage, checkFeatureAvailability } from "../../modules/entitlements/entitlement.service.js";
import { AlertRuleService } from "../../modules/alerts/alert-rule.service.js";
import { NotificationService } from "../../modules/notifications/notification.service.js";
import { resolveWorkspaceId } from "../../lib/workspace.js";

const alertRuleService = new AlertRuleService(prisma);
const notificationService = new NotificationService(prisma);

export async function processEvaluateAlertRulesJob(job: Job): Promise<void> {
  try {
    const orgId = job.organizationId!;
    const payload = (job.payload ?? {}) as { workspaceId?: string };
    // Never forward an empty/malformed workspaceId into a `@db.Uuid` filter.
    const wid = await resolveWorkspaceId(orgId, payload.workspaceId);

    // An evaluation raises one alert per breached rule, and the exact count is
    // only known afterwards, so this pre-check catches the two cases that are
    // decidable up front: the plan has no alerting at all, or the quota is
    // already spent. A tenant with one unit of headroom that trips ten rules
    // still over-delivers; that is logged below rather than hidden.
    const availability = await checkFeatureAvailability(orgId, "alerts");
    if (!availability.allowed) {
      logger.warn(
        { jobId: job.id, organizationId: orgId, reason: availability.reason },
        "Skipping alert evaluation: plan does not allow it.",
      );
      await completeJob(job.id);
      return;
    }

    await alertRuleService.evaluateAll(orgId, wid);
    const alerts = await prisma.alert.findMany({
      where: { organizationId: orgId, status: "OPEN" as const },
    });
    for (const alert of alerts) {
      await notificationService.createForOrganization(orgId, `Alert: ${alert.title}`, alert.message);
    }
    if (alerts.length > 0) {
      try {
        await recordUsage(orgId, "alerts", alerts.length);
      } catch (error) {
        // The alerts already exist, so failing the job would not undo them and
        // would retry a non-idempotent notify loop. Surface the overage for
        // billing instead of swallowing it.
        logger.error(
          { jobId: job.id, organizationId: orgId, alerts: alerts.length, error },
          "Alert metering exceeded the plan quota after evaluation.",
        );
      }
    }
    await completeJob(job.id);
    logger.info({ jobId: job.id }, "Alert rules evaluation completed");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown alert evaluation failure";
    logger.error({ jobId: job.id, error }, "Alert rules evaluation failed");
    await failJob(job.id, message);
  }
}
