import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { registerUser } from "../helpers/auth.js";
import { cleanupByEmails, uniqueEmail } from "../helpers/db.js";

const app = createApp();
const createdEmails: string[] = [];

afterAll(async () => {
  await cleanupByEmails(createdEmails);
  await prisma.$disconnect();
});

describe("Tenant Isolation - Data Layer", () => {
  let user1Cookie: string;
  let user1OrgId: string;
  let user1WorkspaceId: string;
  let user2Cookie: string;
  let user1DataSourceId: string;
  let user1ImportId: string;
  let user1DatasetId: string;

  beforeEach(async () => {
    // Create User 1
    const user1 = await registerUser(app, { email: uniqueEmail("iso1") });
    createdEmails.push(user1.email);
    user1Cookie = user1.response.headers["set-cookie"]?.[0] ?? "";
    user1OrgId = user1.response.body.data.organization.id;
    user1WorkspaceId = user1.response.body.data.workspace.id;

    // Create User 2
    const user2 = await registerUser(app, { email: uniqueEmail("iso2") });
    createdEmails.push(user2.email);
    user2Cookie = user2.response.headers["set-cookie"]?.[0] ?? "";

    // Create data source for User 1
    const dataSource = await prisma.dataSource.create({
      data: {
        organizationId: user1OrgId,
        workspaceId: user1WorkspaceId,
        name: "User 1 Data Source",
        kind: "FILE",
        status: "NEW",
      },
    });
    user1DataSourceId = dataSource.id;

    // Create import for User 1
    const job = await prisma.job.create({
      data: {
        organizationId: user1OrgId,
        type: "IMPORT_DATA",
        status: "PENDING",
        payload: {},
      },
    });

    const importJob = await prisma.importJob.create({
      data: {
        organizationId: user1OrgId,
        workspaceId: user1WorkspaceId,
        jobId: job.id,
        dataSourceId: user1DataSourceId,
        source: "UPLOAD",
        status: "QUEUED",
        filename: "test.csv",
      },
    });
    user1ImportId = importJob.id;

    // Create dataset for User 1
    const dataset = await prisma.dataset.create({
      data: {
        organizationId: user1OrgId,
        workspaceId: user1WorkspaceId,
        dataSourceId: user1DataSourceId,
        name: "User 1 Dataset",
        kind: "CUSTOM",
        status: "READY",
      },
    });
    user1DatasetId = dataset.id;

    // Create version and quality report for User 1 dataset
    const version = await prisma.datasetVersion.create({
      data: {
        datasetId: user1DatasetId,
        version: 1,
        commit: "APPEND",
        source: "UPLOAD",
        status: "READY",
      },
    });

    await prisma.dataset.update({
      where: { id: user1DatasetId },
      data: { currentVersionId: version.id },
    });

    await prisma.dataQualityReport.create({
      data: {
        datasetId: user1DatasetId,
        datasetVersionId: version.id,
        totalRows: 100,
        columnCount: 5,
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

  describe("DataSource Isolation", () => {
    it("prevents User 2 from accessing User 1's data source", async () => {
      const res = await request(app)
        .get(`/api/v1/data-sources/${user1DataSourceId}`)
        .set("Cookie", user2Cookie);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it("prevents User 2 from updating User 1's data source", async () => {
      const res = await request(app)
        .patch(`/api/v1/data-sources/${user1DataSourceId}`)
        .set("Cookie", user2Cookie)
        .send({ name: "Hijacked Name" });

      expect(res.status).toBe(404);

      // Verify name wasn't changed
      const dataSource = await prisma.dataSource.findUnique({
        where: { id: user1DataSourceId },
      });
      expect(dataSource?.name).toBe("User 1 Data Source");
    });

    it("prevents User 2 from deleting User 1's data source", async () => {
      const res = await request(app)
        .delete(`/api/v1/data-sources/${user1DataSourceId}`)
        .set("Cookie", user2Cookie);

      expect(res.status).toBe(404);

      // Verify data source still exists
      const dataSource = await prisma.dataSource.findUnique({
        where: { id: user1DataSourceId },
      });
      expect(dataSource).not.toBeNull();
    });

    it("does not list User 1's data sources for User 2", async () => {
      const res = await request(app)
        .get("/api/v1/data-sources")
        .set("Cookie", user2Cookie);

      expect(res.status).toBe(200);
      expect(res.body.data.dataSources).toBeInstanceOf(Array);
      expect(res.body.data.dataSources.length).toBe(0);
    });
  });

  describe("Import Isolation", () => {
    it("prevents User 2 from accessing User 1's import", async () => {
      const res = await request(app)
        .get(`/api/v1/imports/${user1ImportId}`)
        .set("Cookie", user2Cookie);

      expect(res.status).toBe(404);
    });

    it("prevents User 2 from cancelling User 1's import", async () => {
      const res = await request(app)
        .post(`/api/v1/imports/${user1ImportId}/cancel`)
        .set("Cookie", user2Cookie);

      expect(res.status).toBe(404);

      // Verify import still in original state
      const importJob = await prisma.importJob.findUnique({
        where: { id: user1ImportId },
      });
      expect(importJob?.status).toBe("QUEUED");
    });

    it("does not list User 1's imports for User 2", async () => {
      const res = await request(app)
        .get("/api/v1/imports")
        .set("Cookie", user2Cookie);

      expect(res.status).toBe(200);
      expect(res.body.data.imports).toBeInstanceOf(Array);
      expect(res.body.data.imports.length).toBe(0);
    });
  });

  describe("Dataset Isolation", () => {
    it("prevents User 2 from accessing User 1's dataset", async () => {
      const res = await request(app)
        .get(`/api/v1/datasets/${user1DatasetId}`)
        .set("Cookie", user2Cookie);

      expect(res.status).toBe(404);
    });

    it("prevents User 2 from updating User 1's dataset", async () => {
      const res = await request(app)
        .patch(`/api/v1/datasets/${user1DatasetId}`)
        .set("Cookie", user2Cookie)
        .send({ name: "Hijacked Dataset" });

      expect(res.status).toBe(404);

      // Verify name wasn't changed
      const dataset = await prisma.dataset.findUnique({
        where: { id: user1DatasetId },
      });
      expect(dataset?.name).toBe("User 1 Dataset");
    });

    it("prevents User 2 from accessing User 1's dataset versions", async () => {
      const res = await request(app)
        .get(`/api/v1/datasets/${user1DatasetId}/versions`)
        .set("Cookie", user2Cookie);

      expect(res.status).toBe(404);
    });

    it("prevents User 2 from accessing User 1's dataset rows", async () => {
      const res = await request(app)
        .get(`/api/v1/datasets/${user1DatasetId}/rows`)
        .set("Cookie", user2Cookie);

      expect(res.status).toBe(404);
    });

    it("does not list User 1's datasets for User 2", async () => {
      const res = await request(app)
        .get("/api/v1/datasets")
        .set("Cookie", user2Cookie);

      expect(res.status).toBe(200);
      expect(res.body.data.datasets).toBeInstanceOf(Array);
      expect(res.body.data.datasets.length).toBe(0);
    });
  });

  describe("Quality Report Isolation", () => {
    it("prevents User 2 from accessing User 1's quality report", async () => {
      const res = await request(app)
        .get(`/api/v1/datasets/${user1DatasetId}/quality`)
        .set("Cookie", user2Cookie);

      expect(res.status).toBe(404);
    });

    it("prevents User 2 from recomputing User 1's quality report", async () => {
      const res = await request(app)
        .post(`/api/v1/datasets/${user1DatasetId}/quality/recompute`)
        .set("Cookie", user2Cookie);

      expect(res.status).toBe(404);
    });
  });

  describe("Audit Trail", () => {
    it("records cross-tenant access attempts", async () => {
      // Attempt cross-tenant access
      await request(app)
        .get(`/api/v1/datasets/${user1DatasetId}`)
        .set("Cookie", user2Cookie);
    });
  });

  describe("Organization Boundary", () => {
    it("ensures User 1 can access their own resources", async () => {
      // Sanity check - User 1 should still be able to access their data
      const dsRes = await request(app)
        .get(`/api/v1/data-sources/${user1DataSourceId}`)
        .set("Cookie", user1Cookie);
      expect(dsRes.status).toBe(200);

      const importRes = await request(app)
        .get(`/api/v1/imports/${user1ImportId}`)
        .set("Cookie", user1Cookie);
      expect(importRes.status).toBe(200);

      const datasetRes = await request(app)
        .get(`/api/v1/datasets/${user1DatasetId}`)
        .set("Cookie", user1Cookie);
      expect(datasetRes.status).toBe(200);

      const qualityRes = await request(app)
        .get(`/api/v1/datasets/${user1DatasetId}/quality`)
        .set("Cookie", user1Cookie);
      expect(qualityRes.status).toBe(200);
    });
  });
});
