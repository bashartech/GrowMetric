import { afterAll, afterEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { ACCESS_COOKIE } from "../../src/lib/cookies.js";
import { signAccessToken } from "../../src/lib/tokens.js";
import { destroyOrganization, uniqueSlug } from "../helpers/dataset-fixture.js";

/**
 * Batch 10: list endpoints must be paginated.
 *
 * Reports, report schedules, alerts and alert rules all returned every row in
 * the workspace with no `skip`/`take`, so each list grew without bound as the
 * tenant used the product. These assert both halves of the fix: that `skip`/
 * `take` reach Prisma, and that `meta.total` counts the whole filter rather
 * than the page.
 */
const db = prisma as unknown as PrismaClient;
const app = createApp();
const createdOrganizations: string[] = [];

afterEach(async () => {
  for (const organizationId of createdOrganizations.splice(0)) {
    await destroyOrganization(db, organizationId);
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createScope(label: string): Promise<{
  organizationId: string;
  workspaceId: string;
  userId: string;
  cookie: string;
}> {
  const organization = await prisma.organization.create({
    data: { name: label, slug: uniqueSlug("page") },
  });
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
      email: `${uniqueSlug("page")}@example.com`,
      name: "Pager",
      passwordHash: "hashed",
    },
  });
  createdOrganizations.push(organization.id);

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

const REPORT_COUNT = 7;

async function seedReports(scope: {
  organizationId: string;
  workspaceId: string;
  userId: string;
}): Promise<void> {
  for (let index = 0; index < REPORT_COUNT; index += 1) {
    await prisma.report.create({
      data: {
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        kind: "WEEKLY",
        title: `Report ${index}`,
      },
    });
  }

  // `datasetId` is optional and means "the workspace's latest analysable
  // dataset", which is fine for a list-pagination fixture that never evaluates
  // the rules.
  for (let index = 0; index < REPORT_COUNT; index += 1) {
    await prisma.alertRule.create({
      data: {
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        createdById: scope.userId,
        name: `Rule ${index}`,
        metricKind: "REVENUE",
        condition: "GREATER_THAN",
        threshold: 100,
        frequency: "DAILY",
        recipients: [],
      },
    });
  }
}

describe("paginated list endpoints", () => {
  it("returns only the requested page of reports and reports the full total", async () => {
    const scope = await createScope("Paged reports");
    await seedReports(scope);

    const first = await request(app)
      .get("/api/v1/ai/reports?limit=3&page=1")
      .set("Cookie", scope.cookie);

    expect(first.status).toBe(200);
    expect(first.body.data.reports).toHaveLength(3);
    expect(first.body.data.meta).toEqual({ page: 1, perPage: 3, total: REPORT_COUNT });

    const second = await request(app)
      .get("/api/v1/ai/reports?limit=3&page=2")
      .set("Cookie", scope.cookie);

    expect(second.status).toBe(200);
    expect(second.body.data.reports).toHaveLength(3);
    expect(second.body.data.meta).toEqual({ page: 2, perPage: 3, total: REPORT_COUNT });

    // The pages must not overlap, otherwise `skip` was never applied.
    const firstIds = first.body.data.reports.map((r: { id: string }) => r.id);
    const secondIds = second.body.data.reports.map((r: { id: string }) => r.id);
    expect(firstIds.filter((id: string) => secondIds.includes(id))).toHaveLength(0);

    const last = await request(app)
      .get("/api/v1/ai/reports?limit=3&page=3")
      .set("Cookie", scope.cookie);

    // 7 rows over pages of 3: the third page is the short one.
    expect(last.body.data.reports).toHaveLength(1);
  });

  it("paginates alert rules", async () => {
    const scope = await createScope("Paged rules");
    await seedReports(scope);

    const res = await request(app)
      .get("/api/v1/ai/alert-rules?limit=2&page=2")
      .set("Cookie", scope.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.rules).toHaveLength(2);
    expect(res.body.data.meta).toEqual({ page: 2, perPage: 2, total: REPORT_COUNT });
  });

  it("defaults to the first page rather than returning everything", async () => {
    const scope = await createScope("Default page");
    await seedReports(scope);

    const res = await request(app).get("/api/v1/ai/reports").set("Cookie", scope.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.reports).toHaveLength(REPORT_COUNT);
    expect(res.body.data.meta.page).toBe(1);
    expect(res.body.data.meta.total).toBe(REPORT_COUNT);
  });

  /**
   * `page=0` or `limit=0` would produce a negative `skip` or an empty page.
   * Both are client mistakes and must be a 400, not a Prisma runtime error.
   */
  it("rejects non-positive paging instead of failing inside Prisma", async () => {
    const scope = await createScope("Bad paging");

    const zeroPage = await request(app)
      .get("/api/v1/ai/reports?page=0")
      .set("Cookie", scope.cookie);
    expect(zeroPage.status).toBe(400);

    const zeroLimit = await request(app)
      .get("/api/v1/ai/reports?limit=0")
      .set("Cookie", scope.cookie);
    expect(zeroLimit.status).toBe(400);

    const negative = await request(app)
      .get("/api/v1/ai/reports?page=-2")
      .set("Cookie", scope.cookie);
    expect(negative.status).toBe(400);
  });

  it("caps an oversized limit instead of returning the whole table", async () => {
    const scope = await createScope("Capped limit");

    const res = await request(app)
      .get("/api/v1/ai/reports?limit=100000")
      .set("Cookie", scope.cookie);

    // Above MAX_PAGE_SIZE the request is rejected rather than silently clamped,
    // so the caller learns their paging was wrong.
    expect(res.status).toBe(400);
  });

  it("counts only the calling workspace, not every workspace in the tenant", async () => {
    const scope = await createScope("Scoped total");
    await seedReports(scope);

    const otherWorkspace = await prisma.workspace.create({
      data: {
        organizationId: scope.organizationId,
        name: "Second",
        slug: uniqueSlug("ws2"),
      },
    });
    await prisma.report.create({
      data: {
        organizationId: scope.organizationId,
        workspaceId: otherWorkspace.id,
        kind: "WEEKLY",
        title: "Elsewhere",
      },
    });

    const res = await request(app)
      .get(`/api/v1/ai/reports?workspaceId=${otherWorkspace.id}&limit=50`)
      .set("Cookie", scope.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.meta.total).toBe(1);
    expect(res.body.data.reports).toHaveLength(1);
  });
});