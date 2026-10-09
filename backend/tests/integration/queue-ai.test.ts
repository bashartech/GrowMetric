import { beforeEach, describe, expect, it, vi } from "vitest";
import { afterAll } from "vitest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { registerUser } from "../helpers/auth.js";
import { cleanupByEmails } from "../helpers/db.js";
import { SIMULATION_MODEL_VERSION } from "../../src/lib/simulation.js";

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
  const simulation = await prisma.simulation.create({
    data: {
      organizationId: user.organizationId,
      workspaceId: workspace.id,
      datasetId: null,
      name: "Queue signal test",
      createdById: user.id,
    },
  });
  const scenario = await prisma.simulationScenario.create({
    data: {
      simulationId: simulation.id,
      type: "CUSTOM",
      name: "No baseline available",
      parameters: { metricKey: "revenue", values: {} },
      assumptions: {},
      modelVersion: SIMULATION_MODEL_VERSION,
    },
  });
  return { organizationId: user.organizationId, simulation, scenario };
}

describe("AI queue signal path (T020/T021)", () => {
  it("enqueues a RUN_SIMULATION job, consumes a Redis signal, claims and completes it", async () => {
    redisMocks.isRedisEnabled.mockReturnValue(true);
    const { organizationId, scenario } = await setupScenario();

    const job = await enqueueJob({
      type: "RUN_SIMULATION",
      organizationId,
      payload: { simulationScenarioId: scenario.id },
    });
    expect(redisMocks.signalQueuedJob).toHaveBeenCalledWith("RUN_SIMULATION", job.id);

    const consumed = await consumeOneSignal(0.05);
    expect(consumed).toBe(true);

    const updated = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(updated.status).toBe("COMPLETED");
    expect(updated.attempts).toBe(1);

    const errored = await prisma.simulationScenario.findUniqueOrThrow({
      where: { id: scenario.id },
    });
    expect(errored.status).toBe("INSUFFICIENT_DATA");
    expect(errored.error).toMatch(/baseline/);

    const run = await prisma.agentRun.findFirst({
      where: { jobId: job.id },
    });
    expect(run).not.toBeNull();
    expect(run?.kind).toBe("SIMULATION");
  });

  it("falls back to table polling when Redis is not configured", async () => {
    redisMocks.isRedisEnabled.mockReturnValue(false);
    redisMocks.signalQueuedJob.mockResolvedValue(false);
    const { organizationId, scenario } = await setupScenario();

    const job = await enqueueJob({
      type: "RUN_SIMULATION",
      organizationId,
      payload: { simulationScenarioId: scenario.id },
    });
    expect(redisMocks.consumeAiSignal).not.toHaveBeenCalled();

    // claimNextJob picks the oldest PENDING job globally, so foreign leftover
    // jobs in the shared test DB may be claimed first. Loop until OUR job is
    // terminal so the test does not depend on an empty queue.
    const deadline = Date.now() + 60_000;
    let updated = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    while (updated.status === "PENDING" && Date.now() < deadline) {
      await pollOnce();
      updated = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    }
    expect(updated.status).toBe("COMPLETED");
    expect(updated.attempts).toBe(1);

    const errored = await prisma.simulationScenario.findUniqueOrThrow({
      where: { id: scenario.id },
    });
    expect(errored.status).toBe("INSUFFICIENT_DATA");
  });
});