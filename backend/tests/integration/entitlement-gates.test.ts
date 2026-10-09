import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { registerUser } from "../helpers/auth.js";
import { cleanupByEmails } from "../helpers/db.js";
import { checkFeatureAvailability } from "../../src/modules/entitlements/entitlement.service.js";
import { createConversation } from "../../src/modules/ai/ai.service.js";

const app = createApp();
const createdEmails: string[] = [];

afterAll(async () => {
  await cleanupByEmails(createdEmails);
  await prisma.$disconnect();
});

async function signedInAgent() {
  const { email, password } = await registerUser(app);
  createdEmails.push(email);
  const agent = request.agent(app);
  await agent.post("/api/v1/auth/login").send({ email, password });
  return { agent, email };
}

/**
 * Moves only this agent's tenant onto a plan.
 *
 * Scoping by email matters: an earlier version promoted every organization in
 * `createdEmails`, which leaked across tests in the same file and made the
 * free-plan tenants look like pro tenants.
 */
async function upgradeToPlan(planKey: string, email: string): Promise<string> {
  const plan = await prisma.plan.findUniqueOrThrow({ where: { key: planKey } });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  await prisma.subscription.updateMany({
    where: { organizationId: user.organizationId },
    data: { planId: plan.id },
  });
  return user.organizationId;
}

describe("entitlement gates on metered routes", () => {
  it("returns 402 from report create on a plan with reports switched off", async () => {
    const { agent } = await signedInAgent();

    const res = await agent.post("/api/v1/ai/reports").send({
      title: "Monthly revenue",
      datasetId: "3f6d2f0e-6b4c-4a1e-9c3f-2b8e5d7a1c90",
    });

    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe("ENTITLEMENT_REQUIRED");
    expect(res.body.error.details.featureKey).toBe("reports");
  });

  it("still allows read-only report endpoints on a plan without reports", async () => {
    const { agent } = await signedInAgent();

    const list = await agent.get("/api/v1/ai/reports");
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data.items ?? list.body.data.reports)).toBe(true);
  });

  it("returns 402 when creating an alert rule without the alerts feature", async () => {
    const { agent } = await signedInAgent();

    const res = await agent.post("/api/v1/ai/alert-rules").send({
      metricKind: "REVENUE",
      condition: "LESS_THAN",
      threshold: 100,
      workspaceId: "3f6d2f0e-6b4c-4a1e-9c3f-2b8e5d7a1c90",
    });

    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe("ENTITLEMENT_REQUIRED");
    expect(res.body.error.details.featureKey).toBe("alerts");
  });

  it("still allows listing alert rules without the alerts feature", async () => {
    const { agent } = await signedInAgent();

    const res = await agent.get("/api/v1/ai/alert-rules");

    expect(res.status).toBe(200);
  });

  it("returns 402 when creating a report schedule without the reports feature", async () => {
    const { agent } = await signedInAgent();

    const res = await agent.post("/api/v1/ai/report-schedules").send({
      reportId: "3f6d2f0e-6b4c-4a1e-9c3f-2b8e5d7a1c90",
      frequency: "DAILY",
      time: "09:00",
      timezone: "UTC",
    });

    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe("ENTITLEMENT_REQUIRED");
  });

  it("blocks once a numeric quota is exhausted, not merely when the feature exists", async () => {
    const { agent, email } = await signedInAgent();
    const organizationId = await upgradeToPlan("pro", email);

    // `pro` grants `aiConversations: 100`, so the gate must consult recorded
    // usage rather than only checking that the limit is non-zero.
    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { organizationId },
    });
    await prisma.usageRecord.upsert({
      where: {
        organizationId_metric_periodStart: {
          organizationId,
          metric: "ai_conversations",
          periodStart: subscription.currentPeriodStart,
        },
      },
      update: { amount: 100 },
      create: {
        organizationId,
        metric: "ai_conversations",
        periodStart: subscription.currentPeriodStart,
        periodEnd: subscription.currentPeriodEnd,
        amount: 100,
      },
    });

    const res = await agent.post("/api/v1/ai/conversations").send({
      datasetId: "3f6d2f0e-6b4c-4a1e-9c3f-2b8e5d7a1c90",
      message: "hello",
    });

    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe("ENTITLEMENT_REQUIRED");
    expect(res.body.error.details.limit).toBe(100);
    expect(res.body.error.details.remaining).toBe(0);
  });

  it("reports 402 rather than 403 so clients can tell billing from permission", async () => {
    const { agent } = await signedInAgent();

    const res = await agent.post("/api/v1/ai/reports").send({
      title: "Blocked",
      datasetId: "3f6d2f0e-6b4c-4a1e-9c3f-2b8e5d7a1c90",
    });

    expect(res.status).toBe(402);
    expect(res.status).not.toBe(403);
  });

  /**
   * Regression: `requireEntitlement` called `next()` for a `true` feature and
   * then fell through to a second `next()`. Express treated the extra call as a
   * fresh pass over the stack, walked past the real handler, and answered 404
   * for requests that should have succeeded. `pro` reports is exactly that case:
   * `reports: true` is a boolean, not a number, so it took the falling-through
   * branch.
   */
  it("serves an entitled route instead of 404 when the plan feature is boolean true", async () => {
    const { agent, email } = await signedInAgent();
    await upgradeToPlan("pro", email);

    const res = await agent.post("/api/v1/ai/reports").send({
      title: "Entitled",
      datasetId: "3f6d2f0e-6b4c-4a1e-9c3f-2b8e5d7a1c90",
    });

    expect(res.status).not.toBe(404);
  });

  it("serves an entitled report-schedule route rather than 404 on a boolean true feature", async () => {
    const { agent, email } = await signedInAgent();
    const organizationId = await upgradeToPlan("pro", email);

    const workspace = await prisma.workspace.findFirstOrThrow({
      where: { organizationId },
    });
    const report = await prisma.report.create({
      data: { organizationId, workspaceId: workspace.id, kind: "WEEKLY", title: "Sched" },
    });

    const res = await agent.post("/api/v1/ai/report-schedules").send({
      reportId: report.id,
      workspaceId: workspace.id,
      frequency: "CUSTOM",
      cron: "0 8 * * 1",
      recipients: ["ops@example.com"],
    });

    // 200 is the success shape; 404 is the double-`next()` bug.
    expect(res.status).not.toBe(404);
    expect(res.status).toBe(200);
  });

  /**
   * Regression: `ai_conversations` was never written by any call site, so the
   * gate always read zero usage and `aiConversations: 5` on the free plan could
   * never be reached. `createConversation` now bills it.
   */
  it("bills ai_conversations so the conversation allowance can actually be exhausted", async () => {
    const { email } = await signedInAgent();
    const organizationId = await upgradeToPlan("pro", email);

    const before = await prisma.usageRecord.findMany({
      where: { organizationId, metric: "ai_conversations" },
    });
    expect(before).toHaveLength(0);

    const workspace = await prisma.workspace.findFirstOrThrow({
      where: { organizationId },
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });

    await createConversation({
      title: "Metered",
      organizationId,
      workspaceId: workspace.id,
      createdById: user.id,
    });

    const after = await prisma.usageRecord.findMany({
      where: { organizationId, metric: "ai_conversations" },
    });
    expect(after).toHaveLength(1);
    expect(after[0]!.amount).toBe(1);
  });

  it("leaves recommendation generation ungated because it consumes no AI", async () => {
    const { agent, email } = await signedInAgent();
    const organizationId = await upgradeToPlan("free", email);

    const workspace = await prisma.workspace.findFirstOrThrow({
      where: { organizationId },
    });

    const res = await agent
      .post("/api/v1/ai/recommendations/generate")
      .send({ workspaceId: workspace.id });

    // `free` has `aiConversations: 5`; charging a pure derivation against the AI
    // quota would make this 402 even though no model is called.
    expect(res.status).not.toBe(402);
  });

  it("reports quota-exhausted to scheduled work instead of generating for free", async () => {
    const { email } = await signedInAgent();
    const organizationId = await upgradeToPlan("pro", email);

    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { organizationId },
    });
    // `dataSources: 10` is a real numeric cap on `pro` (unlike `reports`, which
    // is boolean `true` and therefore unmetered), so exhausting it is the only
    // way a scheduled path can legitimately see `quota-exhausted`.
    await prisma.usageRecord.upsert({
      where: {
        organizationId_metric_periodStart: {
          organizationId,
          metric: "data_sources",
          periodStart: subscription.currentPeriodStart,
        },
      },
      update: { amount: 10 },
      create: {
        organizationId,
        metric: "data_sources",
        periodStart: subscription.currentPeriodStart,
        periodEnd: subscription.currentPeriodEnd,
        amount: 10,
      },
    });

    const availability = await checkFeatureAvailability(organizationId, "dataSources");
    expect(availability.allowed).toBe(false);
    expect(availability.reason).toBe("quota-exhausted");
    expect(availability.used).toBe(10);

    // A boolean-true feature stays unmetered, which is what keeps `reports`
    // from blocking a scheduled report on an otherwise-pro tenant.
    const reports = await checkFeatureAvailability(organizationId, "reports");
    expect(reports.allowed).toBe(true);
    expect(reports.reason).toBe("ok");
  });

  it("reports not-entitled to scheduled work when the plan switches the feature off", async () => {
    const { email } = await signedInAgent();
    const organizationId = await upgradeToPlan("free", email);

    const availability = await checkFeatureAvailability(organizationId, "reports");
    expect(availability.allowed).toBe(false);
    expect(availability.reason).toBe("not-entitled");
  });
});
