import { prisma } from "../../lib/prisma.js";
import { enqueueJob } from "../../jobs/queue.js";
import { env } from "../../config/env.js";
import { logger } from "../logger.js";
import { AppError } from "../http-errors.js";
import { resolveTemplate, type EmailTemplateVars } from "./email-templates.js";

export interface EmailDeliveryInput {
  to: string[];
  subject: string;
  template: string;
  templateVars?: EmailTemplateVars;
  /**
   * The organization that owns the delivery. `EmailDelivery.organizationId` is a
   * non-nullable uuid, so this is required rather than defaulted to a
   * placeholder that would throw at insert time (E4).
   */
  organizationId: string;
  recipientUserId?: string;
}

export interface CreateEmailDeliveryResult {
  id: string;
  jobId: string;
}

/**
 * Creates an EmailDelivery record and enqueues a SEND_EMAIL job.
 * Returns the EmailDelivery id.
 */
export async function sendEmail(input: EmailDeliveryInput): Promise<CreateEmailDeliveryResult> {
  const { to, subject: _subject, template, templateVars, organizationId, recipientUserId } = input;

  if (!organizationId) {
    throw new AppError("VALIDATION_ERROR", "sendEmail requires an organizationId");
  }

  const resolved = resolveTemplate(template, templateVars ?? {});

  const emailDelivery = await prisma.emailDelivery.create({
    data: {
      status: "QUEUED",
      from: env.EMAIL_FROM,
      to: to,
      subject: resolved.subject,
      template: template,
      organizationId,
    },
  });

  const job = await enqueueJob({
    type: "SEND_EMAIL",
    payload: {
      emailDeliveryId: emailDelivery.id,
      to,
      subject: resolved.subject,
      html: resolved.body,
    },
    organizationId,
    runInSeconds: 0,
  });

  await prisma.emailDelivery.update({
    where: { id: emailDelivery.id },
    data: { jobId: job.id },
  });

  if (recipientUserId) {
    logger.info(
      { emailDeliveryId: emailDelivery.id, recipientUserId },
      "Email delivery created for a single user.",
    );
  }

  return { id: emailDelivery.id, jobId: job.id };
}
