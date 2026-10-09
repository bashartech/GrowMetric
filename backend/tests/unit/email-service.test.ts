import { describe, expect, it, vi, beforeEach } from "vitest";
import { sendEmail } from "../../src/lib/email/email.service.js";
import { prisma } from "../../src/lib/prisma.js";

vi.mock("../../src/lib/prisma.js", () => ({
  prisma: {
    emailDelivery: {
      create: vi.fn(async () => ({ id: "email-1", status: "QUEUED", error: null, jobId: null, from: "noreply@GrowMetrics.com", to: [], subject: "", template: "", organizationId: "", createdAt: new Date(), updatedAt: new Date(), sentAt: null })),
      update: vi.fn(async () => ({ id: "email-1", status: "QUEUED", error: null, jobId: null, from: "noreply@GrowMetrics.com", to: [], subject: "", template: "", organizationId: "", createdAt: new Date(), updatedAt: new Date(), sentAt: null })),
    },
  },
}));

vi.mock("../../src/jobs/queue.js", () => ({
  enqueueJob: vi.fn(async () => ({ id: "job-1" })),
}));

describe("email service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an EmailDelivery record and enqueues a SEND_EMAIL job", async () => {
    const createMock = vi.mocked(prisma.emailDelivery.create);
    createMock.mockResolvedValue({ id: "email-1", status: "QUEUED", error: null, jobId: null, from: "noreply@GrowMetrics.com", to: [], subject: "", template: "", organizationId: "", createdAt: new Date(), updatedAt: new Date(), sentAt: null });
    const updateMock = vi.mocked(prisma.emailDelivery.update);
    updateMock.mockResolvedValue({ id: "email-1", status: "QUEUED", error: null, jobId: null, from: "noreply@GrowMetrics.com", to: [], subject: "", template: "", organizationId: "", createdAt: new Date(), updatedAt: new Date(), sentAt: null });

    const result = await sendEmail({
      to: ["admin@example.com"],
      subject: "Test",
      template: "alert_fired",
      templateVars: { ruleName: "Test Rule" },
      organizationId: "org-1",
    });

    expect(result.id).toBe("email-1");
    expect(result.jobId).toBe("job-1");
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "QUEUED",
          to: ["admin@example.com"],
          // E4: the delivery must be owned by a real organization, not a
          // placeholder string that violates the uuid column.
          organizationId: "org-1",
        }),
      }),
    );
  });

  it("refuses to create a delivery without an organizationId", async () => {
    const createMock = vi.mocked(prisma.emailDelivery.create);

    await expect(
      sendEmail({
        to: ["admin@example.com"],
        subject: "Test",
        template: "alert_fired",
        organizationId: "",
      }),
    ).rejects.toThrow(/organizationId/);

    expect(createMock).not.toHaveBeenCalled();
  });

  it("links the job id to the EmailDelivery record", async () => {
    const updateMock = vi.mocked(prisma.emailDelivery.update);
    updateMock.mockResolvedValue({ id: "email-1", status: "QUEUED", error: null, jobId: null, from: "noreply@GrowMetrics.com", to: [], subject: "", template: "", organizationId: "", createdAt: new Date(), updatedAt: new Date(), sentAt: null });

    await sendEmail({
      to: ["admin@example.com"],
      subject: "Test",
      template: "alert_fired",
      organizationId: "org-1",
    });

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ jobId: "job-1" }) }),
    );
  });
});
