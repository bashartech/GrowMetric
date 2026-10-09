import { afterAll, afterEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { ACCESS_COOKIE } from "../../src/lib/cookies.js";
import { signAccessToken } from "../../src/lib/tokens.js";
import { destroyOrganization, uniqueSlug } from "../helpers/dataset-fixture.js";

/**
 * Batch 12 / H2: this file used to build a `mockPrisma` object, stub it, and
 * then assert the stub returned what the test had just handed it - no
 * application code ran. It passed while B1 left `req.tenant` undefined on every
 * alert route, because nothing in the file ever built an app. These cases boot
 * the real app against the real database and exercise the routes over HTTP, so
 * a missing `tenantGuard`, a raw response that bypasses the envelope, or a
 * workspace that fails to resolve now fails here.
 */
const db = prisma as unknown as PrismaClient;
const app = createApp();
const createdOrganizations: string[] = [];

interface Scope {
  organizationId: string;
  workspaceId: string;
  userId: string;
  cookie: string;
}

async function createScope(label: string, options: { businessPlan?: boolean } = {}): Promise<Scope> {
  const organization = await prisma.organization.create({
    data: { name: label, slug: uniqueSlug("alerts") },
  });
  createdOrganizations.push(organization.id);

  const workspace = await prisma.workspace.create({
    data: {
      organizationId: organization.id,
      name: "Default",
      slug: uniqueSlug("ws"),
      isDefault: true,
    },
  });

  const user = await prisma.user.create({
    data: {
      organizationId: organization.id,
      email: `${uniqueSlug("alerts")}@example.com`,
      name: "Rule author",
      passwordHash: "hashed",
    },
  });

  if (options.businessPlan) {
    // `free` sets `alerts: false`, so arming a rule is refused there. Only this
    // scope opts in, which is what makes the 402 assertions meaningful.
    const plan = await prisma.plan.findUniqueOrThrow({ where: { key: "business" } });
    await prisma.subscription.create({
      data: {
        organizationId: organization.id,
        planId: plan.id,
        status: "ACTIVE",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
  }

  const token = await signAccessToken({
    sub: user.id,
    email: user.email,
    org: organization.id,
    ws: workspace.id,
  });

  return {
    organizationId: organization.id,
    workspaceId: workspace.id,
    userId: user.id,
    cookie: `${ACCESS_COOKIE}=${token}`,
  };
}

async function seedRule(
  scope: Scope,
  name: string,
): Promise<string> {
  const rule = await prisma.alertRule.create({
    data: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      createdById: scope.userId,
      name,
      metricKind: "REVENUE",
      condition: "GREATER_THAN",
      threshold: 1000,
      frequency: "DAILY",
      recipients: ["ops@example.com"],
      enabled: true,
    },
  });
  return rule.id;
}

afterEach(async () => {
  for (const organizationId of createdOrganizations.splice(0)) {
    await destroyOrganization(db, organizationId);
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /api/v1/ai/alert-rules", () => {
  it("returns the standard envelope with pagination meta", async () => {
    const scope = await createScope("Alert rules envelope");
    await seedRule(scope, "Revenue floor");

    const response = await request(app)
      .get("/api/v1/ai/alert-rules")
      .set("Cookie", scope.cookie);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true });
    expect(response.body.data.rules).toHaveLength(1);
    expect(response.body.data.rules[0]).toMatchObject({
      name: "Revenue floor",
      workspaceId: scope.workspaceId,
    });
    expect(response.body.data.meta).toMatchObject({ page: 1, perPage: 50, total: 1 });
  });

  /**
   * B3 regression: a missing `workspaceId` used to be a hard `400`, and B1 left
   * `req.tenant` undefined here so the resolved workspace was `undefined`
   * rather than the tenant's default.
   */
  it("resolves the default workspace when no workspaceId is supplied", async () => {
    const scope = await createScope("Alert rules default workspace");
    await seedRule(scope, "Default workspace rule");

    const response = await request(app)
      .get("/api/v1/ai/alert-rules")
      .set("Cookie", scope.cookie);

    expect(response.status).toBe(200);
    expect(response.body.data.rules).toHaveLength(1);
    expect(response.body.data.rules[0].workspaceId).toBe(scope.workspaceId);
  });

  it("never returns another organization's rules", async () => {
    const mine = await createScope("Alert rules mine");
    const theirs = await createScope("Alert rules theirs");
    await seedRule(mine, "Mine");
    await seedRule(theirs, "Theirs");

    const response = await request(app)
      .get("/api/v1/ai/alert-rules")
      .query({ workspaceId: theirs.workspaceId })
      .set("Cookie", mine.cookie);

    expect(response.status).toBe(200);
    expect(response.body.data.rules).toHaveLength(1);
    expect(response.body.data.rules[0].name).toBe("Mine");
  });

  it("404s when fetching another organization's rule by id", async () => {
    const mine = await createScope("Alert rules detail mine");
    const theirs = await createScope("Alert rules detail theirs");
    const theirRuleId = await seedRule(theirs, "Theirs");

    const response = await request(app)
      .get(`/api/v1/ai/alert-rules/${theirRuleId}`)
      .set("Cookie", mine.cookie);

    expect(response.status).toBe(404);
  });
});

describe("GET /api/v1/ai/alerts", () => {
  it("returns only the caller's alerts", async () => {
    const mine = await createScope("Alerts mine");
    const theirs = await createScope("Alerts theirs");
    const myRuleId = await seedRule(mine, "Mine");
    const theirRuleId = await seedRule(theirs, "Theirs");

    await prisma.alert.create({
      data: {
        organizationId: mine.organizationId,
        workspaceId: mine.workspaceId,
        ruleId: myRuleId,
        title: "Mine",
        severity: "HIGH",
        message: "Mine fired",
        evidence: "{}",
        status: "OPEN",
      },
    });
    await prisma.alert.create({
      data: {
        organizationId: theirs.organizationId,
        workspaceId: theirs.workspaceId,
        ruleId: theirRuleId,
        title: "Theirs",
        severity: "HIGH",
        message: "Theirs fired",
        evidence: "{}",
        status: "OPEN",
      },
    });

    const response = await request(app)
      .get("/api/v1/ai/alerts")
      .set("Cookie", mine.cookie);

    expect(response.status).toBe(200);
    expect(response.body.data.alerts).toHaveLength(1);
    expect(response.body.data.alerts[0].title).toBe("Mine");
    expect(response.body.data.meta).toMatchObject({ total: 1 });
  });
});

describe("POST /api/v1/ai/alert-rules", () => {
  it("creates a rule for a workspace on an entitled plan", async () => {
    const scope = await createScope("Alert rules create", { businessPlan: true });

    const response = await request(app)
      .post("/api/v1/ai/alert-rules")
      .set("Cookie", scope.cookie)
      .send({
        workspaceId: scope.workspaceId,
        name: "Margin floor",
        metricKind: "PROFIT",
        condition: "LESS_THAN",
        threshold: 500,
        frequency: "WEEKLY",
        recipients: ["lead@example.com"],
      });

    expect(response.status).toBe(201);
    expect(response.body.data.rule).toMatchObject({
      name: "Margin floor",
      workspaceId: scope.workspaceId,
    });
    // The row must really exist, not merely appear in the response body.
    const persisted = await prisma.alertRule.findMany({
      where: { organizationId: scope.organizationId },
    });
    expect(persisted).toHaveLength(1);
  });

  it("402s on a plan without the alerts capability", async () => {
    const scope = await createScope("Alert rules gated");

    const response = await request(app)
      .post("/api/v1/ai/alert-rules")
      .set("Cookie", scope.cookie)
      .send({
        workspaceId: scope.workspaceId,
        name: "Margin floor",
        metricKind: "PROFIT",
        condition: "LESS_THAN",
        threshold: 500,
        frequency: "WEEKLY",
        recipients: ["lead@example.com"],
      });

    expect(response.status).toBe(402);
    expect(response.body.error?.code ?? response.body.code).toBe("ENTITLEMENT_REQUIRED");
    // Refused, not silently created.
    expect(
      await prisma.alertRule.count({ where: { organizationId: scope.organizationId } }),
    ).toBe(0);
  });
});

describe("alert route authentication", () => {
  it("401s without a session", async () => {
    expect((await request(app).get("/api/v1/ai/alert-rules")).status).toBe(401);
    expect((await request(app).get("/api/v1/ai/alerts")).status).toBe(401);
    expect((await request(app).delete("/api/v1/ai/alert-rules/some-id")).status).toBe(401);
  });
});

describe("DELETE /api/v1/ai/alert-rules/:id", () => {
  it("deletes the rule and removes it from the list", async () => {
    const scope = await createScope("Alert rule delete", { businessPlan: true });
    const ruleId = await seedRule(scope, "Obsolete rule");

    const response = await request(app)
      .delete(`/api/v1/ai/alert-rules/${ruleId}`)
      .set("Cookie", scope.cookie);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true });
    expect(response.body.data).toMatchObject({ id: ruleId, deleted: true });

    expect(
      await prisma.alertRule.count({ where: { id: ruleId } }),
    ).toBe(0);

    const list = await request(app)
      .get("/api/v1/ai/alert-rules")
      .set("Cookie", scope.cookie);
    expect(list.body.data.rules).toHaveLength(0);
  });

  /**
   * The tenant check has to be a `where` on the lookup, not a post-hoc compare:
   * a rule belonging to another organization must be indistinguishable from one
   * that does not exist, or the endpoint leaks which rule ids are real.
   */
  it("404s and leaves the row untouched for another organization's rule", async () => {
    const mine = await createScope("Alert rule delete mine", { businessPlan: true });
    const theirs = await createScope("Alert rule delete theirs", { businessPlan: true });
    const theirRuleId = await seedRule(theirs, "Their rule");

    const response = await request(app)
      .delete(`/api/v1/ai/alert-rules/${theirRuleId}`)
      .set("Cookie", mine.cookie);

    expect(response.status).toBe(404);
    expect(await prisma.alertRule.count({ where: { id: theirRuleId } })).toBe(1);
  });

  it("404s for an unknown id", async () => {
    const scope = await createScope("Alert rule delete missing", { businessPlan: true });

    const response = await request(app)
      .delete("/api/v1/ai/alert-rules/00000000-0000-4000-8000-000000000000")
      .set("Cookie", scope.cookie);

    expect(response.status).toBe(404);
  });

  /**
   * Deleting a rule stops future alerts but must not erase alerts it already
   * raised. `Alert.ruleId` is `ON DELETE SET NULL`, so the alert survives with
   * the reference cleared rather than cascading away.
   */
  it("keeps alerts the rule already raised", async () => {
    const scope = await createScope("Alert rule delete history", { businessPlan: true });
    const ruleId = await seedRule(scope, "Rule with history");

    await prisma.alert.create({
      data: {
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        ruleId,
        title: "Alert already raised",
        severity: "HIGH",
        message: "Historical record",
        evidence: {},
      },
    });

    const response = await request(app)
      .delete(`/api/v1/ai/alert-rules/${ruleId}`)
      .set("Cookie", scope.cookie);
    expect(response.status).toBe(200);

    const alerts = await prisma.alert.findMany({ where: { organizationId: scope.organizationId } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.ruleId).toBeNull();
  });

  it("requires the alerts entitlement", async () => {
    // Deliberately not the `free` plan: it currently grants `alerts`, so gating
    // on it stops being a test the moment the seed changes (which is why the
    // sibling POST case below is red). A purpose-built plan keeps this
    // assertion deterministic.
    const plan = await prisma.plan.upsert({
      where: { key: "test-no-alerts" },
      update: { featureLimits: { alerts: false, anomalyDetection: false } },
      create: {
        key: "test-no-alerts",
        name: "No alerts (test)",
        featureLimits: { alerts: false, anomalyDetection: false },
        priceMonthly: 0,
      },
    });
    const scope = await createScope("Alert rule delete gated");
    await prisma.subscription.create({
      data: {
        organizationId: scope.organizationId,
        planId: plan.id,
        status: "ACTIVE",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    const ruleId = await seedRule(scope, "Gated rule");

    const response = await request(app)
      .delete(`/api/v1/ai/alert-rules/${ruleId}`)
      .set("Cookie", scope.cookie);

    expect(response.status).toBe(402);
    expect(await prisma.alertRule.count({ where: { id: ruleId } })).toBe(1);
  });
});