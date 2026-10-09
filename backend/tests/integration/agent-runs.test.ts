import { readFile } from "node:fs/promises";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { registerUser } from "../helpers/auth.js";
import { cleanupByEmails } from "../helpers/db.js";
import { processImportDataJob } from "../../src/workers/handlers/import-data.js";
import { env } from "../../src/config/env.js";
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

/**
 * Enough tool-call turns to genuinely exceed whichever limit fires first.
 * Deriving this from the configured budgets keeps the assertions honest: a
 * hardcoded turn count silently stops exercising the budget once the limits
 * are raised above it, and the run quietly reports COMPLETED.
 */
function budgetExceedingScenario(): MockProviderScenario {
  return {
    turns: Array.from({ length: Math.max(env.AI_MAX_STEPS, env.AI_MAX_TOOL_CALLS) + 2 }, () => ({
      toolCalls: [{ name: "get_workspace_datasets", arguments: {} }],
    })),
  };
}

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
});

async function signedInAgent() {
  const { email, response } = await registerUser(app);
  createdEmails.push(email);
  return response.headers["set-cookie"]?.[0] ?? "";
}

async function uploadAndProcess(authCookie: string): Promise<void> {
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
  await processImportDataJob(importJob!.job);
}

describe("Agent runs budget enforcement (T027)", () => {
  it("STOPPED run: budget-exceeded analyst persists gathered tool calls and polls return a safe state", async () => {
    const authCookie = await signedInAgent();
    await uploadAndProcess(authCookie);

    const created = await request(app)
      .post("/api/v1/ai/conversations")
      .set("Cookie", authCookie)
      .send({ title: "Budget test" });
    expect(created.status).toBe(201);
    const conversationId = created.body.data.id;

    // Script enough tool-call turns to genuinely exceed the budget. All gathered
    // tool calls before the stop are persisted for traceability.
    providerMocks.scenario = budgetExceedingScenario();

    const message = await request(app)
      .post(`/api/v1/ai/conversations/${conversationId}/messages`)
      .set("Cookie", authCookie)
      .send({ content: "keep going until you hit the budget" });
    expect(message.status).toBe(202);
    expect(message.body.data.status).toBe("QUEUED");

    const job = await prisma.job.findUniqueOrThrow({
      where: { id: message.body.data.jobId },
    });
    const claimed = await claimById(job.id);
    expect(claimed).not.toBeNull();
    await runHandler(claimed!);

    const run = await prisma.agentRun.findFirstOrThrow({
      where: { conversationId },
      include: { toolCalls: { orderBy: { sequence: "asc" } } },
    });
    expect(run.status).toBe("STOPPED");
    expect(run.toolCalls.length).toBeGreaterThanOrEqual(1);
    expect(run.error).toMatch(/budget exceeded/);

    const detail = await request(app)
      .get(`/api/v1/ai/conversations/${conversationId}`)
      .set("Cookie", authCookie);
    expect(detail.status).toBe(200);
    expect(detail.body.data.nextRun).toBeNull();
    const assistant = detail.body.data.messages.find(
      (entry: { role: string }) => entry.role === "ASSISTANT",
    );
    expect(assistant).toBeDefined();
    expect(assistant.kind).toBe("ERROR");
    expect(assistant.content).toContain("stopped before answering");
    expect(assistant.payload.status).toBe("STOPPED");
  });
});

describe("Agent runs transparency (US5)", () => {
  it("T064: GET /ai/runs/:id returns run + sanitized tool calls (status/latency/tokens/model)", async () => {
    const authCookie = await signedInAgent();
    await uploadAndProcess(authCookie);

    const created = await request(app)
      .post("/api/v1/ai/conversations")
      .set("Cookie", authCookie)
      .send({ title: "Evidence test" });
    expect(created.status).toBe(201);
    const conversationId = created.body.data.id;

    providerMocks.scenario = {
      turns: [
        {
          toolCalls: [
            { name: "get_workspace_datasets", arguments: {} },
            {
              name: "calculate_metric",
              arguments: {
                metricKey: "revenue",
                datasetId: "placeholder",
                period: { from: "2026-01-01", to: "2026-03-31" },
                aggregation: "SUM",
              },
            },
          ],
        },
        { final: { content: "Total revenue was $482,100.50 in Q1 2026." } },
      ],
    };

    const message = await request(app)
      .post(`/api/v1/ai/conversations/${conversationId}/messages`)
      .set("Cookie", authCookie)
      .send({ content: "What was Q1 revenue?" });
    expect(message.status).toBe(202);

    const job = await prisma.job.findUniqueOrThrow({
      where: { id: message.body.data.jobId },
    });
    const claimed = await claimById(job.id);
    expect(claimed).not.toBeNull();
    await runHandler(claimed!);

    const run = await prisma.agentRun.findFirstOrThrow({
      where: { conversationId },
    });

    const runDetail = await request(app)
      .get(`/api/v1/ai/runs/${run.id}`)
      .set("Cookie", authCookie);
    expect(runDetail.status).toBe(200);
    expect(runDetail.body.data).toMatchObject({
      id: run.id,
      kind: "ANALYST",
      model: expect.stringMatching(/mock/),
      status: "COMPLETED",
      steps: expect.any(Number),
      inputTokens: expect.any(Number),
      outputTokens: expect.any(Number),
      toolsUsed: expect.arrayContaining(["get_workspace_datasets", "calculate_metric"]),
      conversationId,
    });
    expect(runDetail.body.data.toolCalls).toBeInstanceOf(Array);
    expect(runDetail.body.data.toolCalls.length).toBeGreaterThan(0);
    const firstToolCall = runDetail.body.data.toolCalls[0];
    expect(firstToolCall).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      sequence: expect.any(Number),
      status: "SUCCESS",
      arguments: expect.any(Object),
    });
  });

  it("T064: GET /ai/evidence/:messageId resolves evidence chain", async () => {
    const authCookie = await signedInAgent();
    await uploadAndProcess(authCookie);

    const created = await request(app)
      .post("/api/v1/ai/conversations")
      .set("Cookie", authCookie)
      .send({ title: "Evidence chain test" });
    const conversationId = created.body.data.id;

    providerMocks.scenario = {
      turns: [
        {
          toolCalls: [
            { name: "get_workspace_datasets", arguments: {} },
            {
              name: "calculate_metric",
              arguments: {
                metricKey: "revenue",
                datasetId: "placeholder",
                period: { from: "2026-01-01", to: "2026-03-31" },
                aggregation: "SUM",
              },
            },
          ],
        },
        { final: { content: "Total revenue was $482,100.50." } },
      ],
    };

    const message = await request(app)
      .post(`/api/v1/ai/conversations/${conversationId}/messages`)
      .set("Cookie", authCookie)
      .send({ content: "What was revenue?" });
    const job = await prisma.job.findUniqueOrThrow({
      where: { id: message.body.data.jobId },
    });
    const claimed = await claimById(job.id);
    expect(claimed).not.toBeNull();
    await runHandler(claimed!);

    const conversation = await request(app)
      .get(`/api/v1/ai/conversations/${conversationId}`)
      .set("Cookie", authCookie);
    const assistantMessage = conversation.body.data.messages.find(
      (m: { role: string }) => m.role === "ASSISTANT",
    );

    const evidence = await request(app)
      .get(`/api/v1/ai/evidence/${assistantMessage.id}`)
      .set("Cookie", authCookie);
    expect(evidence.status).toBe(200);
    expect(evidence.body.data).toMatchObject({
      messageId: assistantMessage.id,
      evidenceClass: expect.any(String),
      run: {
        id: expect.any(String),
        status: "COMPLETED",
        model: expect.any(String),
      },
      toolCalls: expect.any(Array),
    });
    expect(evidence.body.data.toolCalls.length).toBeGreaterThan(0);
  });

  it("T065: run search filters (kind/status/model/date) + pagination", async () => {
    const authCookie = await signedInAgent();
    await uploadAndProcess(authCookie);

    // Create multiple conversations and runs
    for (let i = 0; i < 3; i++) {
      const created = await request(app)
        .post("/api/v1/ai/conversations")
        .set("Cookie", authCookie)
        .send({ title: `Conversation ${i}` });
      providerMocks.scenario = {
        turns: [{ final: { content: `Answer ${i}` } }],
      };
      const message = await request(app)
        .post(`/api/v1/ai/conversations/${created.body.data.id}/messages`)
        .set("Cookie", authCookie)
        .send({ content: `Question ${i}` });
      const job = await prisma.job.findUniqueOrThrow({
        where: { id: message.body.data.jobId },
      });
      const claimed = await claimById(job.id);
      expect(claimed).not.toBeNull();
      await runHandler(claimed!);
    }

    const allRuns = await request(app)
      .get("/api/v1/ai/runs")
      .set("Cookie", authCookie);
    expect(allRuns.status).toBe(200);
    expect(allRuns.body.data.items.length).toBeGreaterThanOrEqual(3);
    expect(allRuns.body.data.meta).toMatchObject({
      page: 1,
      perPage: expect.any(Number),
      total: expect.any(Number),
    });

    const analystOnly = await request(app)
      .get("/api/v1/ai/runs?kind=ANALYST")
      .set("Cookie", authCookie);
    expect(analystOnly.status).toBe(200);
    expect(analystOnly.body.data.items.every((r: { kind: string }) => r.kind === "ANALYST")).toBe(true);

    const completedOnly = await request(app)
      .get("/api/v1/ai/runs?status=COMPLETED")
      .set("Cookie", authCookie);
    expect(completedOnly.status).toBe(200);
    expect(
      completedOnly.body.data.items.every((r: { status: string }) => r.status === "COMPLETED"),
    ).toBe(true);
  });

  it("T066: STOPPED/FAILED runs return safe states; run/tool-call I/O never contains credentials", async () => {
    const authCookie = await signedInAgent();
    await uploadAndProcess(authCookie);

    // Test STOPPED state
    const created = await request(app)
      .post("/api/v1/ai/conversations")
      .set("Cookie", authCookie)
      .send({ title: "Stop test" });
    providerMocks.scenario = budgetExceedingScenario();
    const message = await request(app)
      .post(`/api/v1/ai/conversations/${created.body.data.id}/messages`)
      .set("Cookie", authCookie)
      .send({ content: "test" });
    const job = await prisma.job.findUniqueOrThrow({
      where: { id: message.body.data.jobId },
    });
    const claimed = await claimById(job.id);
    expect(claimed).not.toBeNull();
    await runHandler(claimed!);

    const stoppedRun = await prisma.agentRun.findFirstOrThrow({
      where: { conversationId: created.body.data.id },
    });

    const stoppedDetail = await request(app)
      .get(`/api/v1/ai/runs/${stoppedRun.id}`)
      .set("Cookie", authCookie);
    expect(stoppedDetail.status).toBe(200);
    expect(stoppedDetail.body.data.status).toBe("STOPPED");
    expect(stoppedDetail.body.data.error).toMatch(/budget exceeded/);
    expect(stoppedDetail.body.data.toolCalls).toBeInstanceOf(Array);

    // Verify no credentials in tool I/O (check all tool calls)
    const toolCallsJson = JSON.stringify(stoppedDetail.body.data.toolCalls);
    expect(toolCallsJson).not.toMatch(/password|secret|api_key|gsk_/i);
  });

  it("T066: denies access to another workspace's run", async () => {
    const authCookie1 = await signedInAgent();
    await uploadAndProcess(authCookie1);

    const created = await request(app)
      .post("/api/v1/ai/conversations")
      .set("Cookie", authCookie1)
      .send({ title: "User 1 conversation" });
    providerMocks.scenario = {
      turns: [{ final: { content: "Answer" } }],
    };
    const message = await request(app)
      .post(`/api/v1/ai/conversations/${created.body.data.id}/messages`)
      .set("Cookie", authCookie1)
      .send({ content: "Question" });
    const job = await prisma.job.findUniqueOrThrow({
      where: { id: message.body.data.jobId },
    });
    const claimed = await claimById(job.id);
    expect(claimed).not.toBeNull();
    await runHandler(claimed!);

    const run = await prisma.agentRun.findFirstOrThrow({
      where: { conversationId: created.body.data.id },
    });

    const authCookie2 = await signedInAgent();
    const denied = await request(app)
      .get(`/api/v1/ai/runs/${run.id}`)
      .set("Cookie", authCookie2);
    expect(denied.status).toBe(404);
  });
});