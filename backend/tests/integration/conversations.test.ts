import { readFile } from "node:fs/promises";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { registerUser } from "../helpers/auth.js";
import { cleanupByEmails } from "../helpers/db.js";
import { processImportDataJob } from "../../src/workers/handlers/import-data.js";
import type { MockProviderScenario } from "../helpers/provider-mock.js";
import { claimById } from "../../src/jobs/queue.js";
import { runHandler } from "../../src/workers/registry.js";

const redisMocks = vi.hoisted(() => ({
  signalQueuedJob: vi.fn(async () => false),
  consumeAiSignal: vi.fn(async () => null),
  isRedisEnabled: vi.fn(() => false),
  closeRedis: vi.fn(async () => undefined),
}));

vi.mock("../../src/lib/redis.js", () => ({
  signalQueuedJob: redisMocks.signalQueuedJob,
  consumeAiSignal: redisMocks.consumeAiSignal,
  isRedisEnabled: redisMocks.isRedisEnabled,
  closeRedis: redisMocks.closeRedis,
}));

const providerMocks = vi.hoisted(() => ({
  scenario: null as MockProviderScenario | null,
}));

vi.mock("../../src/lib/agent/provider.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/agent/provider.js")>();
  const { MockProvider } = await import("../helpers/provider-mock.js");
  type AgentContext = Parameters<typeof actual.GroqEngine.prototype.runOnce>[0];
  class MockGroqEngine {
    readonly model: string;
    readonly name = "mock";
    private readonly inner: InstanceType<typeof MockProvider>;
    constructor() {
      this.inner = new MockProvider(providerMocks.scenario ?? { turns: [] });
      this.model = this.inner.model;
    }
    async runOnce(context: AgentContext) {
      return this.inner.runOnce(context);
    }
  }
  return {
    ...actual,
    GroqEngine: MockGroqEngine as unknown as typeof actual.GroqEngine,
  };
});

const app = createApp();
const createdEmails: string[] = [];

afterAll(async () => {
  await cleanupByEmails(createdEmails);
  await redisMocks.closeRedis();
  await prisma.$disconnect();
});

beforeEach(() => {
  providerMocks.scenario = null;
  redisMocks.signalQueuedJob.mockClear();
});

async function uploadAndProcess(authCookie: string): Promise<{ datasetId: string }> {
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
  return { datasetId: processed!.datasetId! };
}

async function signedInAgent() {
  const { email, response } = await registerUser(app);
  createdEmails.push(email);
  const authCookie = response.headers["set-cookie"]?.[0] ?? "";
  return authCookie;
}

async function createConversation(authCookie: string): Promise<{ id: string }> {
  const res = await request(app)
    .post("/api/v1/ai/conversations")
    .set("Cookie", authCookie)
    .send({ title: "Q3 revenue question" });
  expect(res.status).toBe(201);
  return { id: res.body.data.id };
}

async function postMessage(authCookie: string, conversationId: string, content: string) {
  const res = await request(app)
    .post(`/api/v1/ai/conversations/${conversationId}/messages`)
    .set("Cookie", authCookie)
    .send({ content });
  return res;
}

async function processAnalystJob(jobId: string) {
  const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
  const claimed = await claimById(job.id);
  expect(claimed).not.toBeNull();
  await runHandler(claimed!);
}

describe("AI conversations (US1)", () => {
  it("T025: POST message → RUN_ANALYST completes → traceable assistant answer with evidenceClass and 2 ToolCallRecords", async () => {
    const authCookie = await signedInAgent();
    const { datasetId } = await uploadAndProcess(authCookie);
    const { id: conversationId } = await createConversation(authCookie);

    providerMocks.scenario = {
      turns: [
        { toolCalls: [{ name: "get_workspace_datasets", arguments: {} }] },
        { toolCalls: [{ name: "calculate_metric", arguments: { datasetId, metricKey: "revenue" } }] },
        { final: { content: "Revenue was 482100.50 USD, computed from your data.", includesForeignFigures: false } },
      ],
    };

    const res = await postMessage(authCookie, conversationId, "what is my revenue?");
    expect(res.status).toBe(202);
    expect(res.body.data.status).toBe("QUEUED");
    expect(res.body.data.conversationId).toBe(conversationId);

    await processAnalystJob(res.body.data.jobId);

    const run = await prisma.agentRun.findFirstOrThrow({
      where: { conversationId },
      include: { toolCalls: { orderBy: { sequence: "asc" } } },
    });
    expect(run.kind).toBe("ANALYST");
    expect(run.status).toBe("COMPLETED");
    expect(run.toolCalls).toHaveLength(2);
    expect((run.toolsUsed as string[]).sort()).toEqual([
      "calculate_metric",
      "get_workspace_datasets",
    ]);

    const detail = await request(app)
      .get(`/api/v1/ai/conversations/${conversationId}`)
      .set("Cookie", authCookie);
    expect(detail.status).toBe(200);
    const assistant = detail.body.data.messages.find(
      (message: { role: string }) => message.role === "ASSISTANT",
    );
    expect(assistant).toBeDefined();
    expect(assistant.content).toContain("Revenue was 482100.50 USD");
    expect(assistant.evidenceClass).toBe("CALCULATED");
    expect(assistant.agentRun.id).toBe(run.id);
    expect(assistant.agentRun.toolsUsed.sort()).toEqual([
      "calculate_metric",
      "get_workspace_datasets",
    ]);
    expect(Array.isArray(assistant.payload.evidenceRefs)).toBe(true);
    expect(detail.body.data.nextRun).toBeNull();
  });

  it("T026: unanswerable question → honest limitation response with no fabricated figure", async () => {
    const authCookie = await signedInAgent();
    await uploadAndProcess(authCookie);
    const { id: conversationId } = await createConversation(authCookie);

    providerMocks.scenario = {
      turns: [
        {
          final: {
            content: "I can\u2019t compute that from the data available to me.",
            includesForeignFigures: false,
          },
        },
      ],
    };

    const res = await postMessage(authCookie, conversationId, "what was my profit margin last quarter?");
    expect(res.status).toBe(202);

    await processAnalystJob(res.body.data.jobId);

    const detail = await request(app)
      .get(`/api/v1/ai/conversations/${conversationId}`)
      .set("Cookie", authCookie);
    expect(detail.status).toBe(200);
    const assistant = detail.body.data.messages.find(
      (message: { role: string }) => message.role === "ASSISTANT",
    );
    expect(assistant).toBeDefined();
    expect(assistant.content).toContain("can\u2019t compute");
    expect(assistant.evidenceClass).toBeNull();
    expect(assistant.content).not.toMatch(/\d+(\.\d+)?/);
  });

  it("T026: provider unavailable → assistant ERROR with AI_PROVIDER_UNAVAILABLE and preserved conversation", async () => {
    const authCookie = await signedInAgent();
    await uploadAndProcess(authCookie);
    const { id: conversationId } = await createConversation(authCookie);

    providerMocks.scenario = {
      turns: [{ final: { content: "" }, failWith: "AI_PROVIDER_UNAVAILABLE" }],
    };

    const res = await postMessage(authCookie, conversationId, "what is my revenue?");
    expect(res.status).toBe(202);

    await processAnalystJob(res.body.data.jobId);

    const run = await prisma.agentRun.findFirstOrThrow({ where: { conversationId } });
    expect(run.status).toBe("FAILED");
    expect(run.error).toContain("AI_PROVIDER_UNAVAILABLE");

    const detail = await request(app)
      .get(`/api/v1/ai/conversations/${conversationId}`)
      .set("Cookie", authCookie);
    expect(detail.status).toBe(200);
    const messages = detail.body.data.messages;
    expect(messages).toHaveLength(2);
    const assistant = messages[1]!;
    expect(assistant.role).toBe("ASSISTANT");
    expect(assistant.kind).toBe("ERROR");
    expect(assistant.content).toContain("AI_PROVIDER_UNAVAILABLE");
    expect(assistant.payload.status).toBe("FAILED");
    expect(detail.body.data.nextRun).toBeNull();
  });

  it("CONFLICT: posting to a conversation with no analytics-ready dataset returns an honest 409", async () => {
    const authCookie = await signedInAgent();
    const { id: conversationId } = await createConversation(authCookie);

    const res = await postMessage(authCookie, conversationId, "what is my revenue?");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONFLICT");
    expect(res.body.error.details.ready).toBe(false);

    const detail = await request(app)
      .get(`/api/v1/ai/conversations/${conversationId}`)
      .set("Cookie", authCookie);
    expect(detail.status).toBe(200);
    expect(detail.body.data.messages).toHaveLength(0);
  });
});