import type { Job } from "@prisma/client";
import { completeJob, failJob } from "../../jobs/queue.js";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";
import { emailProvider } from "../../lib/email/email.provider.js";

export async function processSendEmailJob(job: Job): Promise<void> {
  const payload = typeof job.payload === "string" ? JSON.parse(job.payload) : job.payload;
  const emailDeliveryId = (payload as { emailDeliveryId: string }).emailDeliveryId;
  const to = (payload as { to: string[] }).to;
  const subject = (payload as { subject: string }).subject;
  const html = (payload as { html: string }).html;

  try {
    const result = await emailProvider.sendEmail(to, subject, html);

    if (result.accepted) {
      await prisma.emailDelivery.update({
        where: { id: emailDeliveryId },
        data: {
          status: "SENT",
          sentAt: new Date(),
          error: undefined,
        },
      });
      logger.info({ emailDeliveryId, messageId: result.messageId }, "Email sent successfully.");
    } else if (result.simulated) {
      // The provider never transmitted anything. Recording SENT here is what
      // made a preview look like a delivery, so this stays FAILED on purpose.
      const error = result.error ?? "Email was not sent because SMTP is not configured.";
      await prisma.emailDelivery.update({
        where: { id: emailDeliveryId },
        data: { status: "FAILED", error: error.slice(0, 500) },
      });
      logger.error({ emailDeliveryId, error }, "Email NOT sent: SMTP is not configured.");
    } else {
      const error = result.error ?? "Unknown email delivery failure.";
      await prisma.emailDelivery.update({
        where: { id: emailDeliveryId },
        data: {
          status: "FAILED",
          error: error.slice(0, 500),
        },
      });
      logger.error({ emailDeliveryId, error }, "Email delivery failed.");
    }

    await completeJob(job.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown email delivery failure.";
    logger.error({ emailDeliveryId, error }, "Email delivery threw.");
    await failJob(job.id, message.slice(0, 500));
  }
}
