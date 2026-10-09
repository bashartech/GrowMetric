import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { registerUser } from "../helpers/auth.js";
import { cleanupByEmails } from "../helpers/db.js";
import { processImportDataJob } from "../../src/workers/handlers/import-data.js";
import { claimById } from "../../src/jobs/queue.js";
import { runHandler } from "../../src/workers/registry.js";
import {
  setMappingProvider,
  type MappingProvider,
} from "../../src/lib/agent/mapping-provider.js";

vi.mock("../../src/lib/redis.js", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    isRedisEnabled: vi.fn(() => false),
    signalQueuedJob: vi.fn(async () => false),
    consumeAiSignal: vi.fn(async () => null),
    closeRedis: vi.fn(async () => undefined),
  };
});

const app = createApp();
const createdEmails: string[] = [];

afterAll(async () => {
  setMappingProvider(null);
  process.env.AI_ENABLED = "false";
  await cleanupByEmails(createdEmails);
  await prisma.$disconnect();
});

async function setupUser() {
  const { email, response } = await registerUser(app);
  createdEmails.push(email);
  return { email, authCookie: response.headers["set-cookie"]?.[0] ?? "" };
}

async function uploadAmbiguous(
  authCookie: string,
): Promise<{ importId: string; datasetId: string }> {
  const csvPath = join(__dirname, "../fixtures/ambiguous.csv");
  const csvBuffer = await readFile(csvPath);

  const res = await request(app)
    .post("/api/v1/data-sources")
    .set("Cookie", authCookie)
    .field("name", "Mapping Source")
    .attach("file", csvBuffer, "ambiguous.csv");
  expect(res.status).toBe(201);

  const importJob = await prisma.importJob.findUnique({
    where: { id: res.body.data.import.id },
    include: { job: true },
  });
  expect(importJob).not.toBeNull();

  await processImportDataJob(importJob!.job);

  const processed = await prisma.importJob.findUnique({
    where: { id: res.body.data.import.id },
  });
  expect(processed?.datasetId).not.toBeNull();

  return { importId: res.body.data.import.id, datasetId: processed!.datasetId! };
}

async function runEnqueuedSuggestJobs(importId: string): Promise<void> {
  const jobs = await prisma.job.findMany({
    where: {
      type: "SUGGEST_MAPPING",
      status: { in: ["PENDING"] },
    },
    orderBy: { createdAt: "asc" },
  });
  for (const job of jobs) {
    const payload = (job.payload ?? {}) as { importJobId?: string };
    if (payload.importJobId !== importId) continue;
    const claimed = await claimById(job.id);
    expect(claimed).not.toBeNull();
    await runHandler(claimed!);
  }
}

async function pendingSuggestions(importId: string) {
  return prisma.mappingSuggestion.findMany({
    where: { importJobId: importId },
    orderBy: { createdAt: "asc" },
  });
}

class RevenueMappingProvider implements MappingProvider {
  readonly model = "mock-mapping-v1";
  async complete(): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    return {
      content: JSON.stringify({
        semanticKey: "revenue",
        businessMeaning: "Total revenue",
        confidence: 0.91,
      }),
      inputTokens: 12,
      outputTokens: 6,
    };
  }
}

class FailingMappingProvider implements MappingProvider {
  readonly model = "mock-mapping-v1";
  async complete(): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    throw new Error("provider unavailable");
  }
}

describe("AI mapping suggestions (T056/T057)", () => {
  beforeEach(() => {
    process.env.AI_ENABLED = "true";
  });

  it("pauses at REQUESTING_MAPPING, persists RULES rows, then a PENDING AI suggestion that maps the column (T056)", async () => {
    const { authCookie } = await setupUser();
    setMappingProvider(new RevenueMappingProvider());

    const { importId, datasetId } = await uploadAmbiguous(authCookie);

    const importJob = await prisma.importJob.findUnique({ where: { id: importId } });
    expect(importJob?.status).toBe("REQUESTING_MAPPING");

    let rows = await pendingSuggestions(importId);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.source === "RULES" && row.status === "PENDING")).toBe(true);
    expect(rows.map((row) => row.semanticKey).sort()).toContain("revenue");
    expect(rows.map((row) => row.semanticKey).sort()).toContain("customers");

    await runEnqueuedSuggestJobs(importId);

    rows = await pendingSuggestions(importId);
    expect(rows).toHaveLength(3);
    const aiRow = rows.find((row) => row.source === "AI");
    expect(aiRow).toBeDefined();
    expect(aiRow?.status).toBe("PENDING");
    expect(aiRow?.semanticKey).toBe("revenue");
    expect(aiRow?.agentRunId).not.toBeNull();

    const agentRun = await prisma.agentRun.findUnique({ where: { id: aiRow!.agentRunId! } });
    expect(agentRun?.kind).toBe("MAPPING");
    expect(agentRun?.status).toBe("COMPLETED");
    expect(agentRun?.toolsUsed).toContain("suggest_mapping");
    expect(agentRun?.model).toBe("mock-mapping-v1");

    const list = await request(app)
      .get(`/api/v1/ai/mapping-suggestions?importJobId=${importId}`)
      .set("Cookie", authCookie);
    expect(list.status).toBe(200);
    expect(list.body.data.items).toHaveLength(3);
    const listedAi = list.body.data.items.find((item: { source: string }) => item.source === "AI");
    expect(listedAi.semanticKey).toBe("revenue");
    expect(listedAi.column.name).toBe("customer_revenue");
    expect(typeof listedAi.confidence).toBe("number");

    const confirm = await request(app)
      .post(`/api/v1/ai/mapping-suggestions/${aiRow!.id}/confirm`)
      .set("Cookie", authCookie);
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.status).toBe("CONFIRMED");
    expect(confirm.body.data.semanticKey).toBe("revenue");
    expect(confirm.body.data.analyticsReady).toBe(true);

    const column = await prisma.datasetColumn.findUnique({ where: { id: listedAi.column.id } });
    expect(column?.semanticKey).toBe("revenue");
    expect(column?.businessMeaning).toBe("Total revenue");

    const unaffected = await prisma.dataset.findUnique({ where: { id: datasetId } });
    expect(unaffected?.status).toBe("DRAFT");
  });

  it("reject leaves the column and dataset untouched (T056)", async () => {
    const { authCookie } = await setupUser();
    setMappingProvider(new RevenueMappingProvider());

    const { importId, datasetId } = await uploadAmbiguous(authCookie);
    await runEnqueuedSuggestJobs(importId);

    const aiRow = (await pendingSuggestions(importId)).find((row) => row.source === "AI");

    const reject = await request(app)
      .post(`/api/v1/ai/mapping-suggestions/${aiRow!.id}/reject`)
      .set("Cookie", authCookie);
    expect(reject.status).toBe(200);
    expect(reject.body.data.status).toBe("REJECTED");
    expect(reject.body.data.analyticsReady).toBe(false);

    const column = await prisma.datasetColumn.findUnique({
      where: { id: (await pendingSuggestions(importId))[0]!.columnId },
    });
    expect(column?.semanticKey).toBe("revenue");
    const dataset = await prisma.dataset.findUnique({ where: { id: datasetId } });
    expect(dataset?.status).toBe("DRAFT");
  });

  it("resolving every suggestion completes the import and readies the dataset + dashboard (T056)", async () => {
    const { authCookie } = await setupUser();
    setMappingProvider(new RevenueMappingProvider());

    const { importId, datasetId } = await uploadAmbiguous(authCookie);
    await runEnqueuedSuggestJobs(importId);

    const rows = await pendingSuggestions(importId);
    expect(rows).toHaveLength(3);

    const confirmAi = await request(app)
      .post(`/api/v1/ai/mapping-suggestions/${rows.find((row) => row.source === "AI")!.id}/confirm`)
      .set("Cookie", authCookie);
    expect(confirmAi.status).toBe(200);

    for (const rulesRow of rows.filter((row) => row.source === "RULES")) {
      const reject = await request(app)
        .post(`/api/v1/ai/mapping-suggestions/${rulesRow.id}/reject`)
        .set("Cookie", authCookie);
      expect(reject.status).toBe(200);
    }

    const dataset = await prisma.dataset.findUnique({
      where: { id: datasetId },
      include: { versions: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    expect(dataset?.status).toBe("READY");
    const importJob = await prisma.importJob.findUnique({ where: { id: importId } });
    expect(importJob?.status).toBe("COMPLETED");
    expect(importJob?.completedAt).not.toBeNull();

    const widgetForDataset = await prisma.dashboardWidget.findFirst({ where: { datasetId } });
expect(widgetForDataset).not.toBeNull();

    const complete = await request(app)
      .get(`/api/v1/ai/mapping-suggestions?importJobId=${importId}`)
      .set("Cookie", authCookie);
    expect(complete.body.data.items).toHaveLength(0);

    const audit = await prisma.auditLog.findMany({
      where: {
        resourceType: "MappingSuggestion",
        resourceId: { in: rows.map((row) => row.id) },
      },
    });
    expect(audit.length).toBe(3);
  });

  it("batch resolves per-item with isolation; foreign suggestions fail without blocking others (T056)", async () => {
    const { authCookie } = await setupUser();
    setMappingProvider(new RevenueMappingProvider());

    const { importId, datasetId } = await uploadAmbiguous(authCookie);
    await runEnqueuedSuggestJobs(importId);

    const rows = await pendingSuggestions(importId);
    const foreign = await import("node:crypto").then((crypto) => crypto.randomUUID());

    const decisions = [
      { suggestionId: rows.find((row) => row.source === "AI")!.id, action: "CONFIRM" },
      { suggestionId: rows[0]!.id, action: "REJECT" },
      { suggestionId: rows[1]!.id, action: "REJECT" },
      { suggestionId: foreign, action: "CONFIRM" },
    ];

    const batch = await request(app)
      .post("/api/v1/ai/mapping-suggestions/batch")
      .set("Cookie", authCookie)
      .send({ importJobId: importId, decisions });
    expect(batch.status).toBe(200);

    const results = batch.body.data.results as Array<{
      suggestionId: string;
      success: boolean;
      status: string;
    }>;
    expect(results.filter((result) => result.success)).toHaveLength(3);
    const failed = results.find((result) => !result.success);
    expect(failed?.suggestionId).toBe(foreign);
    expect(failed?.status).toBe("FAILED");
    expect(failed).toHaveProperty("error.code", "NOT_FOUND");

    const dataset = await prisma.dataset.findUnique({ where: { id: datasetId } });
    expect(dataset?.status).toBe("READY");
  });

  it("provider failure surfaces a SKIPPED suggestion and never auto-applies (T057)", async () => {
    const { authCookie } = await setupUser();
    setMappingProvider(new FailingMappingProvider());

    const { importId, datasetId } = await uploadAmbiguous(authCookie);

    const importJob = await prisma.importJob.findUnique({ where: { id: importId } });
    expect(importJob?.status).toBe("REQUESTING_MAPPING");

    await runEnqueuedSuggestJobs(importId);

    const rows = await pendingSuggestions(importId);
    const skipped = rows.find((row) => row.source === "AI");
    expect(skipped).toBeDefined();
    expect(skipped?.status).toBe("SKIPPED");
    expect(skipped?.semanticKey).toBe("revenue");

    const agentRun = await prisma.agentRun.findUnique({ where: { id: skipped!.agentRunId! } });
    expect(agentRun?.status).toBe("FAILED");
    expect(agentRun?.error).toContain("provider unavailable");

    const completedJobs = await prisma.job.findMany({
      where: { type: "SUGGEST_MAPPING", status: "COMPLETED" },
    });
    const ourCompleted = completedJobs.filter(
      (job) =>
        (job.payload as { importJobId?: string }).importJobId === importId,
    );
    expect(ourCompleted).toHaveLength(1);

    const column = await prisma.datasetColumn.findUnique({ where: { id: skipped!.columnId } });
    expect(column?.semanticKey).toBe("revenue");

    const dataset = await prisma.dataset.findUnique({ where: { id: datasetId } });
    expect(dataset?.status).toBe("DRAFT");

    const rulesStillPending = rows.filter(
      (row) => row.source === "RULES" && row.status === "PENDING",
    );
    expect(rulesStillPending).toHaveLength(2);

    const skippedList = await request(app)
      .get(`/api/v1/ai/mapping-suggestions?importJobId=${importId}&status=SKIPPED`)
      .set("Cookie", authCookie);
    expect(skippedList.status).toBe(200);
    expect(skippedList.body.data.items).toHaveLength(1);
    expect(skippedList.body.data.items[0].source).toBe("AI");
  });

  it("with AI disabled no SUGGEST_MAPPING job is enqueued (T056)", async () => {
    process.env.AI_ENABLED = "false";
    const { authCookie } = await setupUser();
    const { importId } = await uploadAmbiguous(authCookie);

    const jobs = await prisma.job.findMany({ where: { type: "SUGGEST_MAPPING" } });
    const ours = jobs.filter(
      (job) => (job.payload as { importJobId?: string }).importJobId === importId,
    );
    expect(ours).toHaveLength(0);
    const importJob = await prisma.importJob.findUnique({ where: { id: importId } });
    expect(importJob?.status).toBe("REQUESTING_MAPPING");
  });
});