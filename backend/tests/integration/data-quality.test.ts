import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { registerUser } from "../helpers/auth.js";
import { cleanupByEmails } from "../helpers/db.js";

const app = createApp();
const createdEmails: string[] = [];

afterAll(async () => {
  await cleanupByEmails(createdEmails);
  await prisma.$disconnect();
});

describe("GET /api/v1/datasets/:datasetId/quality", () => {
  let authCookie: string;
  let datasetId: string;
  let versionId: string;

  beforeEach(async () => {
    const { email, response } = await registerUser(app);
    createdEmails.push(email);
    authCookie = response.headers["set-cookie"]?.[0] ?? "";

    const dataset = await prisma.dataset.create({
      data: {
        organizationId: response.body.data.organization.id,
        workspaceId: response.body.data.workspace.id,
        dataSourceId: (await prisma.dataSource.create({
          data: {
            organizationId: response.body.data.organization.id,
            workspaceId: response.body.data.workspace.id,
            name: "Test Source",
            kind: "FILE",
          },
        })).id,
        name: "Test Dataset",
        kind: "CUSTOM",
        status: "READY",
      },
    });
    datasetId = dataset.id;

    const version = await prisma.datasetVersion.create({
      data: {
        datasetId,
        version: 1,
        commit: "APPEND",
        source: "UPLOAD",
        status: "READY",
      },
    });
    versionId = version.id;

    await prisma.dataset.update({
      where: { id: datasetId },
      data: { currentVersionId: versionId },
    });

    // Create quality report
    await prisma.dataQualityReport.create({
      data: {
        datasetId,
        datasetVersionId: versionId,
        totalRows: 100,
        columnCount: 5,
        missingValuePct: 5.5,
        duplicateRowPct: 0.5,
        invalidNumberPct: 0.0,
        invalidDatePct: 0.0,
        numericOutlierCount: 2,
        status: "WARNINGS",
        detail: [
          {
            column: "age",
            issue: "5.5% missing values",
            severity: "medium",
          },
        ],
      },
    });
  });

  it("returns quality report for current version", async () => {
    const res = await request(app)
      .get(`/api/v1/datasets/${datasetId}/quality`)
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.datasetId).toBe(datasetId);
    expect(res.body.data.totalRows).toBe(100);
    expect(res.body.data.columnCount).toBe(5);
    expect(res.body.data.status).toBe("WARNINGS");
    expect(res.body.data.warnings).toBeInstanceOf(Array);
    expect(res.body.data.warnings.length).toBeGreaterThan(0);
  });

  it("returns quality report for specific version", async () => {
    const res = await request(app)
      .get(`/api/v1/datasets/${datasetId}/quality`)
      .set("Cookie", authCookie)
      .query({ version: versionId });

    expect(res.status).toBe(200);
    expect(res.body.data.datasetVersionId).toBe(versionId);
  });

  it("returns 404 for non-existent dataset", async () => {
    const res = await request(app)
      .get("/api/v1/datasets/00000000-0000-0000-0000-000000000000/quality")
      .set("Cookie", authCookie);

    expect(res.status).toBe(404);
  });

  it("requires authentication", async () => {
    const res = await request(app).get(`/api/v1/datasets/${datasetId}/quality`);

    expect(res.status).toBe(401);
  });

  it("includes quality metrics", async () => {
    const res = await request(app)
      .get(`/api/v1/datasets/${datasetId}/quality`)
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("missingValuePct");
    expect(res.body.data).toHaveProperty("duplicateRowPct");
    expect(res.body.data).toHaveProperty("invalidNumberPct");
    expect(res.body.data).toHaveProperty("invalidDatePct");
    expect(res.body.data).toHaveProperty("numericOutlierCount");
  });

  it("includes per-column warnings", async () => {
    const res = await request(app)
      .get(`/api/v1/datasets/${datasetId}/quality`)
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.warnings).toBeInstanceOf(Array);
    expect(res.body.data.warnings[0]).toHaveProperty("column");
    expect(res.body.data.warnings[0]).toHaveProperty("issue");
  });
});

describe("POST /api/v1/datasets/:datasetId/quality/recompute", () => {
  let authCookie: string;
  let datasetId: string;

  beforeEach(async () => {
    const { email, response } = await registerUser(app);
    createdEmails.push(email);
    authCookie = response.headers["set-cookie"]?.[0] ?? "";

    const dataset = await prisma.dataset.create({
      data: {
        organizationId: response.body.data.organization.id,
        workspaceId: response.body.data.workspace.id,
        dataSourceId: (await prisma.dataSource.create({
          data: {
            organizationId: response.body.data.organization.id,
            workspaceId: response.body.data.workspace.id,
            name: "Test Source",
            kind: "FILE",
          },
        })).id,
        name: "Test Dataset",
        kind: "CUSTOM",
        status: "READY",
      },
    });
    datasetId = dataset.id;

    const version = await prisma.datasetVersion.create({
      data: {
        datasetId,
        version: 1,
        commit: "APPEND",
        source: "UPLOAD",
        status: "READY",
      },
    });

    await prisma.dataset.update({
      where: { id: datasetId },
      data: { currentVersionId: version.id },
    });

    await prisma.dataQualityReport.create({
      data: {
        datasetId,
        datasetVersionId: version.id,
        totalRows: 50,
        columnCount: 3,
        missingValuePct: 0,
        duplicateRowPct: 0,
        invalidNumberPct: 0,
        invalidDatePct: 0,
        numericOutlierCount: 0,
        status: "CLEAN",
        detail: [],
      },
    });
  });

  it("recomputes quality report", async () => {
    const res = await request(app)
      .post(`/api/v1/datasets/${datasetId}/quality/recompute`)
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.datasetId).toBe(datasetId);
  });

  it("requires authentication", async () => {
    const res = await request(app).post(
      `/api/v1/datasets/${datasetId}/quality/recompute`,
    );

    expect(res.status).toBe(401);
  });
});
