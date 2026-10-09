import { beforeEach, describe, expect, it, vi } from "vitest";
import { afterAll } from "vitest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { registerUser } from "../helpers/auth.js";
import { cleanupByEmails } from "../helpers/db.js";
import { sendEmail } from "../../src/lib/email/email.service.js";

vi.mock("../../src/lib/redis.js", () => {
  const inbox: Array<{ type: string; jobId: string }> = [];
  return {
    inbox,
    signalQueuedJob: vi.fn(async (type: string, jobId: string) => {
      inbox.push({ type, jobId });
      return true;
    }),
    consumeAiSignal: vi.fn(async () => inbox.shift() ?? null),
    isRedisEnabled: vi.fn(() => false),
    closeRedis: vi.fn(async () => undefined),
  };
});

vi.mock("../../src/lib/email/email.provider.js", () => {
  const sendEmail = vi.fn();
  return {
    emailProvider: { sendEmail },
  };
});

import { pollOnce } from "../../src/workers/index.js";
import { emailProvider } from "../../src/lib/email/email.provider.js";

const app = createApp();
const createdEmails: string[] = [];

afterAll(async () => {
  await cleanupByEmails(createdEmails);
  await prisma.$disconnect();
});

beforeEach(() => {
  (emailProvider.sendEmail as any).mockReset();
  (emailProvider.sendEmail as any).mockResolvedValue({ accepted: true, messageId: "sink-1" });
});

async function setupScenario() {
  const { email } = await registerUser(app);
  createdEmails.push(email);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { userId: user.id, organizationId: user.organizationId };
}

async function awaitTerminal(jobId: string) {
  const deadline = Date.now() + 30_000;
  let job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
  while (!["COMPLETED", "FAILED"].includes(job.status) && Date.now() < deadline) {
    await pollOnce();
    job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
  }
  return job;
}

describe("SEND_EMAIL job → EmailDelivery (T139/T140)", () => {
  it("transitions QUEUED→SENT via the log sink when SMTP is not configured", async () => {
    const { organizationId } = await setupScenario();

    const { id: deliveryId, jobId } = await sendEmail({
      to: ["admin@example.com"],
      subject: "Revenue exceeded $140k",
      template: "alert_fired",
      templateVars: {
        ruleName: "Revenue threshold",
        message: "Revenue exceeded threshold",
        metricKind: "REVENUE",
        currentValue: "150000",
        threshold: "140000",
        period: "2024-Q1",
      },
      organizationId,
    });

    const queued = await prisma.emailDelivery.findUniqueOrThrow({
      where: { id: deliveryId },
    });
    expect(queued.status).toBe("QUEUED");

    const job = await awaitTerminal(jobId);
    expect(job.status).toBe("COMPLETED");
    expect(emailProvider.sendEmail).toHaveBeenCalledTimes(1);

    const sent = await prisma.emailDelivery.findUniqueOrThrow({
      where: { id: deliveryId },
    });
    expect(sent.status).toBe("SENT");
    expect(sent.sentAt).not.toBeNull();
  });

  it("transitions QUEUED→FAILED with a sanitized error when the provider rejects", async () => {
    (emailProvider.sendEmail as any).mockResolvedValue({ accepted: false, error: "SMTP timeout" });
    const { organizationId } = await setupScenario();

    const { id: deliveryId, jobId } = await sendEmail({
      to: ["admin@example.com"],
      subject: "Revenue exceeded $140k",
      template: "alert_fired",
      templateVars: {
        ruleName: "Revenue threshold",
        message: "Revenue exceeded threshold",
        metricKind: "REVENUE",
        currentValue: "150000",
        threshold: "140000",
        period: "2024-Q1",
      },
      organizationId,
    });

    const deadline = Date.now() + 5_000;
    let job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    while (!["COMPLETED", "FAILED"].includes(job.status) && Date.now() < deadline) {
      await pollOnce();
      job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    }
    expect(["COMPLETED", "FAILED"]).toContain(job.status);
    expect(emailProvider.sendEmail).toHaveBeenCalledTimes(1);

    const failed = await prisma.emailDelivery.findUniqueOrThrow({
      where: { id: deliveryId },
    });
    expect(failed.status).toBe("FAILED");
    expect(failed.error).toMatch(/SMTP timeout/);
  });
});