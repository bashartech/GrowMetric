import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { DatasetStatus } from "@prisma/client";
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

const TARGET = { from: "2026-01-15T00:00:00.000Z", to: "2026-02-09T23:59:59.999Z" };
const BASELINE = { from: "2026-01-05T00:00:00.000Z", to: "2026-01-15T23:59:59.999Z" };

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

describe("POST /api/v1/ai/investigations (T037/T038)", () => {
  it("runs an investigation end-to-end: create → job → findings → detail (T037)", async () => {
    const { authCookie } = await setupUser();
    const datasetId = await seedDataset(authCookie);

    const res = await request(app)
      .post("/api/v1/ai/investigations")
      .set("Cookie", authCookie)
      .send({
        title: "Why did revenue change last month?",
        question: "Compare revenue between the latest period and the preceding one.",
        topic: "revenue",
        periodTarget: TARGET,
        periodBaseline: BASELINE,
      });

    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    const created = res.body.data;
    expect(created.id).toBeDefined();
    expect(created.jobId).toBeDefined();
    expect(created.status).toBe("RUNNING");

    const job = await claimById(created.jobId as string);
    expect(job).not.toBeNull();
    await runHandler(job!);

    const investigation = await prisma.investigation.findUnique({
      where: { id: created.id as string },
      include: { findings: true, runs: true },
    });
    expect(investigation).not.toBeNull();
    expect(investigation?.datasetId).toBe(datasetId);
    expect(investigation?.status).toBe("COMPLETED");
    expect(investigation?.findings.length).toBeGreaterThanOrEqual(1);

    const mainFinding = investigation!.findings.find((finding) => finding.level === "MAIN");
    expect(mainFinding).toBeDefined();
    expect(mainFinding?.isCausalClaim).toBe(false);
    expect(((mainFinding?.evidence as Record<string, unknown>).datasetId as string)).toBe(datasetId);

    const run = investigation!.runs[0];
    expect(run?.kind).toBe("INVESTIGATION");
    expect(run?.status).toBe("COMPLETED");

    const finished = await prisma.job.findUnique({ where: { id: created.jobId as string } });
    expect(finished?.status).toBe("COMPLETED");

    const detail = await request(app)
      .get(`/api/v1/ai/investigations/${created.id as string}`)
      .set("Cookie", authCookie);
    expect(detail.status).toBe(200);
    expect(detail.body.data.status).toBe("COMPLETED");
    expect(detail.body.data.findings.length).toBeGreaterThanOrEqual(1);
    expect(detail.body.data.findings[0].level).toBe("MAIN");
    expect(detail.body.data.findings[0].isCausalClaim).toBe(false);
    expect(detail.body.data.agentRun.kind).toBe("INVESTIGATION");
  });

  it("returns an honest CONFLICT when the workspace has no analytics-ready dataset (T038)", async () => {
    const { authCookie } = await setupUser();

    const res = await request(app)
      .post("/api/v1/ai/investigations")
      .set("Cookie", authCookie)
      .send({
        title: "Investigate empty workspace",
        question: "What can we learn from our data?",
        topic: "sales",
      });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toMatch(/analytics-ready/i);
  });

  it("returns 404 for a dataset in another workspace (T038)", async () => {
    const owner = await setupUser();
    const ownerDatasetId = await seedDataset(owner.authCookie);

    const intruder = await setupUser();
    const res = await request(app)
      .post("/api/v1/ai/investigations")
      .set("Cookie", intruder.authCookie)
      .send({
        title: "Poke at foreign dataset",
        question: "Anything interesting?",
        topic: "revenue",
        datasetId: ownerDatasetId,
      });

    expect(res.status).toBe(404);
  });

it("returns a CONFLICT for an owned dataset that is not analytics-ready (T038)", async () => {
    const { authCookie } = await setupUser();
    const datasetId = await seedDataset(authCookie);

    await prisma.dataset.update({
      where: { id: datasetId },
      data: { status: DatasetStatus.DRAFT },
    });

    const res = await request(app)
      .post("/api/v1/ai/investigations")
      .set("Cookie", authCookie)
      .send({
        title: "Investigate unready dataset",
        question: "What happened?",
        topic: "revenue",
        datasetId,
      });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toMatch(/not analytics-ready/i);
  });
});