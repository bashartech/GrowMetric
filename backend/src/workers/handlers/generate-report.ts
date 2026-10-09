import type { Job } from "@prisma/client";
import { completeJob, failJob } from "../../jobs/queue.js";
import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { sendEmail } from "../../lib/email/email.service.js";
import { recordUsage, checkFeatureAvailability } from "../../modules/entitlements/entitlement.service.js";
import { AppError } from "../../lib/http-errors.js";
import { ReportService } from "../../modules/reports/report.service.js";
import { NotificationService } from "../../modules/notifications/notification.service.js";

interface GenerateReportPayload {
  reportId: string;
  /** Present when the run came from a report schedule rather than the API. */
  scheduleId?: string;
  /** Schedule recipients. Only a scheduled run emails; a manual run does not. */
  recipients?: string[];
}

/**
 * Where a generated report can be viewed, for the `report_generated` email.
 *
 * `APP_URL` is optional so a backend-only deployment still works; without it
 * the email links to the in-app path, which is useless on its own but honest
 * about the report existing rather than sending a broken absolute link.
 */
function reportUrl(reportId: string): string {
  const path = `/reports/${reportId}`;
  return env.APP_URL ? `${env.APP_URL.replace(/\/$/, "")}${path}` : path;
}

/**
 * Emails the schedule's recipients after a scheduled report is generated.
 *
 * This runs here, after `generate` has returned a GENERATED report, rather than
 * as a separate SEND_EMAIL job enqueued by the scheduler: the email must not be
 * able to go out before the PDF exists, and two independent jobs have no
 * ordering guarantee.
 *
 * A manual run has no `recipients` and is never emailed.
 */
async function notifyRecipients(
  organizationId: string,
  report: { id: string; title: string },
  recipients: string[],
): Promise<void> {
  if (recipients.length === 0) {
    logger.info({ reportId: report.id }, "Scheduled report has no recipients; skipping email.");
    return;
  }

  await sendEmail({
    to: recipients,
    organizationId,
    // The subject is resolved from the template; `sendEmail` ignores this field
    // and uses the template's own subject line.
    subject: `Report generated: ${report.title}`,
    template: "report_generated",
    templateVars: {
      title: report.title,
      reportId: report.id,
      reportUrl: reportUrl(report.id),
    },
  });

  logger.info({ reportId: report.id, recipients: recipients.length }, "Scheduled report emailed.");
}

export async function processGenerateReportJob(job: Job): Promise<void> {
  try {
    const service = new ReportService(prisma);
    const orgId = job.organizationId!;
    const payload = (job.payload ?? {}) as unknown as GenerateReportPayload;

    // A scheduled run has no HTTP response to reject, so the route gate never
    // sees it: a tenant at its report ceiling would otherwise keep receiving
    // scheduled PDFs for free. Manual runs already passed the gate in the
    // controller, so this only applies to `payload.scheduleId`.
    if (payload.scheduleId !== undefined) {
      const availability = await checkFeatureAvailability(orgId, "reports");
      if (!availability.allowed) {
        throw new AppError(
          "ENTITLEMENT_REQUIRED",
          "Scheduled report skipped: the plan does not include reports, or the report quota is exhausted.",
          { reason: availability.reason, limit: availability.limit, used: availability.used },
        );
      }
    }

    const result = await service.generate({ reportId: payload.reportId }, orgId);
    const notificationService = new NotificationService(prisma);
    await notificationService.createForOrganization(orgId, `Report generated: ${result.report.title}`, `Report ${result.report.id} has been generated.`);
    try {
      await recordUsage(orgId, "reports", 1);
    } catch (error) {
      // The report is already generated, so failing here would leave the job
      // retrying a non-idempotent render. Log the unbilled unit instead.
      logger.error(
        { jobId: job.id, reportId: result.report.id, error },
        "Report generated but could not be metered.",
      );
    }

    // Email failures must not undo a report that was generated successfully,
    // and must not leave the job looking successful when nothing was sent.
    try {
      await notifyRecipients(orgId, result.report, payload.recipients ?? []);
    } catch (error) {
      logger.error(
        { jobId: job.id, reportId: result.report.id, error },
        "Report generated but the notification email could not be queued.",
      );
    }

    await completeJob(job.id);
    logger.info(
      { reportId: result.report.id, scheduled: payload.scheduleId !== undefined },
      "Report generated.",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown report generation failure.";
    logger.error({ jobId: job.id, error }, "Report generation job failed.");
    await failJob(job.id, message);
  }
}
