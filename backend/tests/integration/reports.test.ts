import { afterAll, afterEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { ACCESS_COOKIE } from "../../src/lib/cookies.js";
import { signAccessToken } from "../../src/lib/tokens.js";
import { destroyOrganization, uniqueSlug } from "../helpers/dataset-fixture.js";

/**
 * Batch 12 / H2: this file used to `vi.mock('@prisma/client')` and then assert
 * that its own hand-built mock returned whatever the test had just told it to
 * return. No application code ran, so the file stayed green while the app was
 * mis-wired - it passed while B1 left `req.tenant` undefined on every alert
 * route. These cases boot the real app against the real database and go
 * through HTTP, so a missing `tenantGuard`, a broken envelope, or a workspace
 * that fails to resolve now fails the test.
 */
const db = prisma as unknown as PrismaClient;
const app = createApp();
const createdOrganizations: string[] = [];

interface Scope {
  organizationId: string;
  workspaceId: string;
  secondaryWorkspaceId: string;
  userId: string;
  cookie: string;
}

async function createScope(label: string): Promise<Scope> {
  const organization = await prisma.organization.create({
    data: { name: label, slug: uniqueSlug("reports") },
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
  const secondary = await prisma.workspace.create({
    data: {
      organizationId: organization.id,
      name: "Secondary",
      slug: uniqueSlug("ws"),
    },
  });

  const user = await prisma.user.create({
    data: {
      organizationId: organization.id,
      email: `${uniqueSlug("reports")}@example.com`,
      name: "Reporter",
      passwordHash: "hashed",
    },
  });

  const token = await signAccessToken({
    sub: user.id,
    email: user.email,
    org: organization.id,
    ws: workspace.id,
  });

  return {
    organizationId: organization.id,
    workspaceId: workspace.id,
    secondaryWorkspaceId: secondary.id,
    userId: user.id,
    cookie: `${ACCESS_COOKIE}=${token}`,
  };
}

async function seedReport(
  scope: Pick<Scope, "organizationId" | "workspaceId">,
  title: string,
): Promise<string> {
  const report = await prisma.report.create({
    data: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      kind: "WEEKLY",
      title,
    },
  });
  return report.id;
}

afterEach(async () => {
  for (const organizationId of createdOrganizations.splice(0)) {
    await destroyOrganization(db, organizationId);
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /api/v1/ai/reports", () => {
  it("returns the standard envelope with pagination meta", async () => {
    const scope = await createScope("Reports envelope");
    await seedReport(scope, "Weekly revenue");

    const response = await request(app)
      .get("/api/v1/ai/reports")
      .set("Cookie", scope.cookie);

    expect(response.status).toBe(200);
    // The frontend's `parseEnvelope` unwraps `data`; a bare payload here is
    // what silently blanked the reports page before.
    expect(response.body).toMatchObject({ success: true });
    expect(Array.isArray(response.body.data.reports)).toBe(true);
    expect(response.body.data.reports).toHaveLength(1);
    expect(response.body.data.reports[0]).toMatchObject({
      title: "Weekly revenue",
      workspaceId: scope.workspaceId,
    });
    expect(response.body.data.meta).toMatchObject({
      page: 1,
      perPage: 50,
      total: 1,
    });
  });

  /**
   * B3 regression: the controller used to throw a hard `400` when `workspaceId`
   * was absent instead of resolving the tenant's default workspace.
   */
  it("resolves the default workspace when no workspaceId is supplied", async () => {
    const scope = await createScope("Reports default workspace");
    await seedReport(scope, "Default workspace report");

    const response = await request(app)
      .get("/api/v1/ai/reports")
      .set("Cookie", scope.cookie);

    expect(response.status).toBe(200);
    expect(response.body.data.reports).toHaveLength(1);
    expect(response.body.data.reports[0].workspaceId).toBe(scope.workspaceId);
  });

  it("honours an explicit workspaceId inside the caller's organization", async () => {
    const scope = await createScope("Reports explicit workspace");
    await seedReport(scope, "In default");
    await prisma.report.create({
      data: {
        organizationId: scope.organizationId,
        workspaceId: scope.secondaryWorkspaceId,
        kind: "WEEKLY",
        title: "In secondary",
      },
    });

    const response = await request(app)
      .get("/api/v1/ai/reports")
      .query({ workspaceId: scope.secondaryWorkspaceId })
      .set("Cookie", scope.cookie);

    expect(response.status).toBe(200);
    expect(response.body.data.reports).toHaveLength(1);
    expect(response.body.data.reports[0].title).toBe("In secondary");
  });

  it("never returns another organization's reports", async () => {
    const mine = await createScope("Reports mine");
    const theirs = await createScope("Reports theirs");
    await seedReport(mine, "Mine");
    await seedReport(theirs, "Theirs");

    const response = await request(app)
      .get("/api/v1/ai/reports")
      .query({ workspaceId: theirs.workspaceId })
      .set("Cookie", mine.cookie);

    expect(response.status).toBe(200);
    // A foreign workspaceId falls back to the caller's default workspace
    // rather than 400ing or widening the filter.
    expect(response.body.data.reports).toHaveLength(1);
    expect(response.body.data.reports[0].title).toBe("Mine");
  });

  it("paginates rather than returning every row", async () => {
    const scope = await createScope("Reports pagination");
    for (let index = 0; index < 5; index += 1) {
      await seedReport(scope, `Report ${index}`);
    }

    const response = await request(app)
      .get("/api/v1/ai/reports")
      .query({ page: 2, limit: 2 })
      .set("Cookie", scope.cookie);

    expect(response.status).toBe(200);
    expect(response.body.data.reports).toHaveLength(2);
    expect(response.body.data.meta).toMatchObject({
      page: 2,
      perPage: 2,
      total: 5,
    });
  });
});

describe("GET /api/v1/ai/reports/:id", () => {
  it("404s on another organization's report", async () => {
    const mine = await createScope("Reports detail mine");
    const theirs = await createScope("Reports detail theirs");
    const theirReportId = await seedReport(theirs, "Theirs");

    const response = await request(app)
      .get(`/api/v1/ai/reports/${theirReportId}`)
      .set("Cookie", mine.cookie);

    expect(response.status).toBe(404);
  });

  it("returns the caller's own report", async () => {
    const scope = await createScope("Reports detail own");
    const reportId = await seedReport(scope, "Mine");

    const response = await request(app)
      .get(`/api/v1/ai/reports/${reportId}`)
      .set("Cookie", scope.cookie);

    expect(response.status).toBe(200);
    expect(response.body.data.report.id).toBe(reportId);
  });
});

describe("report route authentication", () => {
  it("401s without a session", async () => {
    const response = await request(app).get("/api/v1/ai/reports");
    expect(response.status).toBe(401);
  });
});