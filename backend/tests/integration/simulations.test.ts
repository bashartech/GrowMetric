import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { registerUser } from "../helpers/auth.js";
import { cleanupByEmails } from "../helpers/db.js";
import { processImportDataJob } from "../../src/workers/handlers/import-data.js";
import { claimById } from "../../src/jobs/queue.js";
import { runHandler } from "../../src/workers/registry.js";

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
  await cleanupByEmails(createdEmails);
  await prisma.$disconnect();
});

async function setupUser() {
  const { email, response } = await registerUser(app);
  createdEmails.push(email);
  return { email, authCookie: response.headers["set-cookie"]?.[0] ?? "" };
}

async function seedDataset(authCookie: string): Promise<string> {
  const csvPath = join(__dirname, "../fixtures/sales.csv");
  const csvBuffer = await readFile(csvPath);

  const res = await request(app)
    .post("/api/v1/data-sources")
    .set("Cookie", authCookie)
    .field("name", "Sales Data")
    .attach("file", csvBuffer, "sales.csv");
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
  return processed!.datasetId!;
}

async function createStudy(authCookie: string, datasetId?: string) {
  const res = await request(app)
    .post("/api/v1/ai/simulations")
    .set("Cookie", authCookie)
    .send({ name: "Pricing study", ...(datasetId ? { datasetId } : {}) });
  expect(res.status).toBe(201);
  expect(res.body.success).toBe(true);
  return res.body.data as { id: string };
}

async function createPriceScenario(authCookie: string, simulationId: string, params?: Record<string, number>) {
  const res = await request(app)
    .post(`/api/v1/ai/simulations/${simulationId}/scenarios`)
    .set("Cookie", authCookie)
    .send({
      name: "Price +10%",
      type: "PRICE_CHANGE",
      parameters: params ?? { priceChangePct: 10 },
    });
  expect(res.status).toBe(202);
  expect(res.body.data.status).toBe("RUNNING");
  expect(res.body.data.jobId).toBeDefined();
  return res.body.data as { id: string; jobId: string };
}

describe("POST/GET /api/v1/ai/simulations (T048)", () => {
  it("runs a scenario end-to-end: study → scenario → job → results + isEstimate + disclaimer + explain", async () => {
    const { authCookie } = await setupUser();
    const datasetId = await seedDataset(authCookie);

    const study = await createStudy(authCookie, datasetId);
    expect(study.id).toBeDefined();

    const scenario = await createPriceScenario(authCookie, study.id);

    const job = await claimById(scenario.jobId);
    expect(job).not.toBeNull();
    await runHandler(job!);

    const row = await prisma.simulationScenario.findUnique({
      where: { id: scenario.id },
      include: { results: true },
    });
    expect(row).not.toBeNull();
    expect(row?.status).toBe("COMPLETED");
    expect(row?.results.length).toBe(1);
    const result = row!.results[0]!;
    expect(result.isEstimate).toBe(true);

    const detail = await request(app)
      .get(`/api/v1/ai/simulations/${study.id}/scenarios/${scenario.id}`)
      .set("Cookie", authCookie);
    expect(detail.status).toBe(200);
    const data = detail.body.data;
    expect(data.status).toBe("COMPLETED");
    expect(data.results.length).toBe(1);
    expect(data.disclaimer).toContain("estimate");
    expect(data.isEstimate).toBe(true);
    expect(data.modelVersion).toBe("simulation-v1");
    expect(data.sensitivityAlternative).toBeNull();
    expect(Number(data.results[0].currentValue)).toBeGreaterThan(0);
    expect(data.results[0].projectedValue).toBeDefined();

    const explain = await request(app)
      .post(`/api/v1/ai/simulations/${study.id}/scenarios/${scenario.id}/explain`)
      .set("Cookie", authCookie);
    expect(explain.status).toBe(200);
    expect(explain.body.data.agentRunId).toBeDefined();

    const withExplanation = await request(app)
      .get(`/api/v1/ai/simulations/${study.id}/scenarios/${scenario.id}`)
      .set("Cookie", authCookie);
    expect(withExplanation.body.data.explanation).not.toBeNull();
    expect(withExplanation.body.data.explanation.content).toContain(String(data.results[0].projectedValue));

    const list = await request(app)
      .get("/api/v1/ai/simulations")
      .set("Cookie", authCookie);
    expect(list.status).toBe(200);
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.items[0].scenarioCount).toBe(1);
    expect(list.body.data.items[0].latestScenarioStatus).toBe("COMPLETED");
  });

  it("returns INSUFFICIENT_DATA with a sensitivity alternative, never invented numbers (FR-010/SC-005)", async () => {
    const { authCookie } = await setupUser();
    const study = await createStudy(authCookie);
    const scenario = await createPriceScenario(authCookie, study.id);

    const job = await claimById(scenario.jobId);
    expect(job).not.toBeNull();
    await runHandler(job!);

    const detail = await request(app)
      .get(`/api/v1/ai/simulations/${study.id}/scenarios/${scenario.id}`)
      .set("Cookie", authCookie);
    expect(detail.status).toBe(200);
    const data = detail.body.data;
    expect(data.status).toBe("INSUFFICIENT_DATA");
    expect(data.results).toEqual([]);
    expect(data.isEstimate).toBe(false);
    expect(data.sensitivityAlternative).not.toBeNull();
    expect(data.sensitivityAlternative.title).toContain("Insufficient");
    expect(data.sensitivityAlternative.suggestion.length).toBeGreaterThan(0);
  });

  it("rejects a scenario missing a required model parameter with VALIDATION_ERROR", async () => {
    const { authCookie } = await setupUser();
    const study = await createStudy(authCookie);

    const res = await request(app)
      .post(`/api/v1/ai/simulations/${study.id}/scenarios`)
      .set("Cookie", authCookie)
      .send({ name: "Broken", type: "INVENTORY_CHANGE", parameters: { days: 30 } });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("denies access to another workspace's study", async () => {
    const owner = await setupUser();
    const study = await createStudy(owner.authCookie);

    const intruder = await setupUser();
    const res = await request(app)
      .post(`/api/v1/ai/simulations/${study.id}/scenarios`)
      .set("Cookie", intruder.authCookie)
      .send({ name: "Sneak", type: "PRICE_CHANGE", parameters: { priceChangePct: 5 } });
    expect(res.status).toBe(404);
  });
});