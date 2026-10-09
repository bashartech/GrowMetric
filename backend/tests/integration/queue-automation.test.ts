import { beforeEach, describe, expect, it, vi } from "vitest";
import { afterAll } from "vitest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { registerUser } from "../helpers/auth.js";
import { cleanupByEmails } from "../helpers/db.js";
import { createDatasetFixture } from "../helpers/dataset-fixture.js";

const redisMocks = vi.hoisted(() => {
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

vi.mock("../../src/lib/redis.js", () => ({
  signalQueuedJob: redisMocks.signalQueuedJob,
  consumeAiSignal: redisMocks.consumeAiSignal,
  isRedisEnabled: redisMocks.isRedisEnabled,
  closeRedis: redisMocks.closeRedis,
}));

import { enqueueJob } from "../../src/jobs/queue.js";
import { consumeOneSignal, pollOnce } from "../../src/workers/index.js";

const app = createApp();
const createdEmails: string[] = [];

afterAll(async () => {
  await cleanupByEmails(createdEmails);
  await redisMocks.closeRedis();
  await prisma.$disconnect();
});

beforeEach(() => {
  redisMocks.inbox.length = 0;
  redisMocks.signalQueuedJob.mockClear();
  redisMocks.consumeAiSignal.mockClear();
  redisMocks.isRedisEnabled.mockReturnValue(false);
  redisMocks.consumeAiSignal.mockImplementation(async () => redisMocks.inbox.shift() ?? null);
});

async function setupScenario() {
  const { email } = await registerUser(app);
  createdEmails.push(email);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const workspace = await prisma.workspace.findFirstOrThrow({
    where: { organizationId: user.organizationId },
  });
  // A metrics report needs a real dataset: generation refuses to invent numbers
  // for a report with no dataset, so the job would fail instead of completing.
  const fixture = await createDatasetFixture(prisma, user.organizationId, workspace.id);
  const report = await prisma.report.create({
    data: {
      organizationId: user.organizationId,
      workspaceId: workspace.id,
      kind: "WEEKLY" as const,
      reportType: "METRICS" as const,
      title: "Queue automation report",
      status: "DRAFT",
      datasetId: fixture.datasetId,
      metricKeys: ["REVENUE"],
    },
  });
  return { organizationId: user.organizationId, userId: user.id, report, datasetId: fixture.datasetId };
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

describe("Automation job signal path (T151)", () => {
  it("enqueues a GENERATE_REPORT job, consumes a Redis signal, claims and completes it", async () => {
    redisMocks.isRedisEnabled.mockReturnValue(true);
    const { userId, organizationId, report } = await setupScenario();

    const job = await enqueueJob({
      type: "GENERATE_REPORT",
      organizationId,
      payload: { reportId: report.id },
    });
    expect(redisMocks.signalQueuedJob).toHaveBeenCalledWith("GENERATE_REPORT", job.id);

    const consumed = await consumeOneSignal(0.05);
    expect(consumed).toBe(true);

    const updated = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(updated.status).toBe("COMPLETED");
    expect(updated.attempts).toBe(1);

    const generated = await prisma.report.findUniqueOrThrow({ where: { id: report.id } });
    expect(generated.status).toBe("GENERATED");
    expect(generated.pdfUrl).toMatch(/\.pdf$/);
    expect(generated.content).toBeTruthy();

    const notification = await prisma.notification.findFirst({
      where: { userId, body: { contains: "has been generated" } },
    });
    expect(notification).not.toBeNull();
    expect(notification?.body).toContain("has been generated");
  });

  it("falls back to table polling when Redis is not configured", async () => {
    redisMocks.isRedisEnabled.mockReturnValue(false);
    redisMocks.signalQueuedJob.mockResolvedValue(false);
    const { organizationId, report } = await setupScenario();

    const job = await enqueueJob({
      type: "GENERATE_REPORT",
      organizationId,
      payload: { reportId: report.id },
    });
    expect(redisMocks.consumeAiSignal).not.toHaveBeenCalled();

    const updated = await awaitTerminal(job.id);
    expect(updated.status).toBe("COMPLETED");
    expect(updated.attempts).toBe(1);

    const generated = await prisma.report.findUniqueOrThrow({ where: { id: report.id } });
    expect(generated.status).toBe("GENERATED");
  });
});