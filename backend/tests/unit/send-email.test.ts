import { describe, expect, it, vi, beforeEach } from "vitest";
import { processSendEmailJob } from "../../src/workers/handlers/send-email.js";
import { prisma } from "../../src/lib/prisma.js";

vi.mock("../../src/lib/prisma.js", () => ({
  prisma: {
    emailDelivery: {
      update: vi.fn(async () => ({ id: "email-1", status: "QUEUED", error: null, jobId: null, from: "", to: [], subject: "", template: "", organizationId: "", createdAt: new Date(), updatedAt: new Date(), sentAt: null })),
    },
  },
}));

vi.mock("../../src/lib/email/email.provider.js", () => ({
  emailProvider: {
    sendEmail: vi.fn(),
  },
}));

vi.mock("../../src/jobs/queue.js", () => ({
  completeJob: vi.fn(),
  failJob: vi.fn(),
}));

describe("send-email job handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("transitions EmailDelivery QUEUED→SENT on success", async () => {
    const updateMock = vi.mocked(prisma.emailDelivery.update);
    updateMock.mockResolvedValue({ id: "email-1", status: "QUEUED", error: null, jobId: null, from: "", to: [], subject: "", template: "", organizationId: "", createdAt: new Date(), updatedAt: new Date(), sentAt: null });
    const { emailProvider } = await import("../../src/lib/email/email.provider.js");
    vi.mocked(emailProvider.sendEmail).mockResolvedValue({ accepted: true, messageId: "msg-1" });

    const job = {
      id: "job-1",
      type: "SEND_EMAIL",
      payload: {
        emailDeliveryId: "email-1",
        to: ["admin@example.com"],
        subject: "Test",
        html: "<p>Body</p>",
      },
      organizationId: "org-1",
      status: "RUNNING",
    } as unknown as import("@prisma/client").Job;

    await processSendEmailJob(job);

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "email-1" },
        data: expect.objectContaining({ status: "SENT" }),
      }),
    );
  });

  it("transitions EmailDelivery QUEUED→FAILED on error", async () => {
    const updateMock = vi.mocked(prisma.emailDelivery.update);
    updateMock.mockResolvedValue({ id: "email-1", status: "QUEUED", error: null, jobId: null, from: "", to: [], subject: "", template: "", organizationId: "", createdAt: new Date(), updatedAt: new Date(), sentAt: null });
    const { emailProvider } = await import("../../src/lib/email/email.provider.js");
    vi.mocked(emailProvider.sendEmail).mockResolvedValue({ accepted: false, error: "SMTP timeout" });

    const job = {
      id: "job-1",
      type: "SEND_EMAIL",
      payload: {
        emailDeliveryId: "email-1",
        to: ["admin@example.com"],
        subject: "Test",
        html: "<p>Body</p>",
      },
      organizationId: "org-1",
      status: "RUNNING",
    } as unknown as import("@prisma/client").Job;

    await processSendEmailJob(job);

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "email-1" },
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
  });

  /**
   * A simulated send must never land in SENT. `accepted: false` with
   * `simulated: true` means SMTP is unconfigured and nothing was transmitted;
   * recording SENT is what made "email never arrives" look like a delivered
   * email in the database.
   */
  it("marks a simulated (unconfigured SMTP) delivery FAILED, never SENT", async () => {
    const updateMock = vi.mocked(prisma.emailDelivery.update);
    updateMock.mockResolvedValue({ id: "email-1", status: "QUEUED", error: null, jobId: null, from: "", to: [], subject: "", template: "", organizationId: "", createdAt: new Date(), updatedAt: new Date(), sentAt: null });
    const { emailProvider } = await import("../../src/lib/email/email.provider.js");
    vi.mocked(emailProvider.sendEmail).mockResolvedValue({
      accepted: false,
      simulated: true,
      error: "SMTP is not configured (SMTP_HOST is empty); no email was sent.",
    });

    const job = {
      id: "job-1",
      type: "SEND_EMAIL",
      payload: {
        emailDeliveryId: "email-1",
        to: ["admin@example.com"],
        subject: "Test",
        html: "<p>Body</p>",
      },
      organizationId: "org-1",
      status: "RUNNING",
    } as unknown as import("@prisma/client").Job;

    await processSendEmailJob(job);

    const { data } = updateMock.mock.calls[0]![0];
    expect(data).toMatchObject({ status: "FAILED" });
    expect(data).not.toMatchObject({ status: "SENT" });
    expect(data.sentAt).toBeUndefined();
    expect(data.error).toMatch(/not configured/i);
  });

  it("still completes the job when the delivery was only simulated", async () => {
    vi.mocked(prisma.emailDelivery.update).mockResolvedValue({ id: "email-1", status: "FAILED", error: "x", jobId: null, from: "", to: [], subject: "", template: "", organizationId: "", createdAt: new Date(), updatedAt: new Date(), sentAt: null });
    const { emailProvider } = await import("../../src/lib/email/email.provider.js");
    vi.mocked(emailProvider.sendEmail).mockResolvedValue({ accepted: false, simulated: true, error: "no smtp" });
    const { completeJob, failJob } = await import("../../src/jobs/queue.js");

    const job = {
      id: "job-1",
      type: "SEND_EMAIL",
      payload: { emailDeliveryId: "email-1", to: ["a@b.com"], subject: "s", html: "<p>b</p>" },
      organizationId: "org-1",
      status: "RUNNING",
    } as unknown as import("@prisma/client").Job;

    await processSendEmailJob(job);

    // Otherwise a permanently misconfigured install retries forever.
    expect(completeJob).toHaveBeenCalledWith("job-1");
    expect(failJob).not.toHaveBeenCalled();
  });
});
