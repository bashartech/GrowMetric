import nodemailer from "nodemailer";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";

export interface SendEmailResult {
  accepted: boolean;
  messageId?: string;
  error?: string;
  /**
   * True when nothing was transmitted because SMTP is not configured. The
   * delivery row must not be marked SENT in this case: a preview that reports
   * success is indistinguishable from a real send, which made a working
   * provider look broken and a broken one look fine.
   */
  simulated?: boolean;
}

interface EmailProvider {
  readonly kind: "smtp" | "log-sink";
  sendEmail(to: string[], subject: string, html: string): Promise<SendEmailResult>;
}

export class LogSinkProvider implements EmailProvider {
  readonly kind = "log-sink" as const;

  async sendEmail(to: string[], subject: string, _html: string): Promise<SendEmailResult> {
    logger.warn(
      { to, subject },
      "[EMAIL NOT SENT] SMTP is not configured; email was NOT delivered.",
    );
    return {
      accepted: false,
      simulated: true,
      error: "SMTP is not configured (SMTP_HOST is empty); no email was sent.",
    };
  }
}

class SmtpProvider implements EmailProvider {
  readonly kind = "smtp" as const;

  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      // Port 465 is implicit TLS; 587/2525 upgrade via STARTTLS. Hardcoding
      // `secure: false` made every 465 provider fail to connect at all.
      secure: env.SMTP_PORT === 465,
      requireTLS: env.SMTP_PORT !== 465,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
      // Without these a dead SMTP host blocks the worker's only job loop
      // indefinitely, stalling every other job behind it.
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    });
  }

  async sendEmail(to: string[], subject: string, html: string): Promise<SendEmailResult> {
    try {
      const info = await this.transporter.sendMail({
        from: env.EMAIL_FROM,
        to: to.join(","),
        subject,
        html,
      });
      return { accepted: true, messageId: info.messageId };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown email error.";
      return { accepted: false, error: message };
    }
  }
}

export function getEmailProvider(): EmailProvider {
  if (env.SMTP_HOST) {
    return new SmtpProvider();
  }
  return new LogSinkProvider();
}

export const emailProvider = getEmailProvider();

/**
 * One line at worker startup so the active mode is never a mystery. Without it
 * the only way to tell real sending from a preview was to inspect the log for
 * a marker nobody knew to look for.
 */
export function describeEmailProvider(): string {
  if (emailProvider.kind === "smtp") {
    return `SMTP ${env.SMTP_USER ?? "(no user)"} via ${env.SMTP_HOST}:${env.SMTP_PORT}, from ${env.EMAIL_FROM}`;
  }
  return "NOT CONFIGURED - emails are logged, NOT sent (set SMTP_HOST/SMTP_USER/SMTP_PASS)";
}

logger.info(`[EMAIL] ${describeEmailProvider()}`);
