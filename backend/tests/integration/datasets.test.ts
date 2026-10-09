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

describe("GET /api/v1/datasets", () => {
  let authCookie: string;

  beforeEach(async () => {
    const { email, response } = await registerUser(app);
    createdEmails.push(email);
    authCookie = response.headers["set-cookie"]?.[0] ?? "";
  });

  it("lists datasets for authenticated user", async () => {
    const res = await request(app)
      .get("/api/v1/datasets")
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.datasets).toBeInstanceOf(Array);
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/api/v1/datasets");

    expect(res.status).toBe(401);
  });

  it("returns empty array when no datasets exist", async () => {
    const res = await request(app)
      .get("/api/v1/datasets")
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.datasets).toEqual([]);
  });
});

describe("GET /api/v1/datasets/:id", () => {
  let authCookie: string;
  let datasetId: string;

  beforeEach(async () => {
    const { email, response } = await registerUser(app);
    createdEmails.push(email);
    authCookie = response.headers["set-cookie"]?.[0] ?? "";

    // Create a test dataset
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
  });

  it("returns dataset with columns", async () => {
    const res = await request(app)
      .get(`/api/v1/datasets/${datasetId}`)
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(datasetId);
    expect(res.body.data.name).toBe("Test Dataset");
    expect(res.body.data.columns).toBeInstanceOf(Array);
  });

  it("returns 404 for non-existent dataset", async () => {
    const res = await request(app)
      .get("/api/v1/datasets/00000000-0000-0000-0000-000000000000")
      .set("Cookie", authCookie);

    expect(res.status).toBe(404);
  });

  it("requires authentication", async () => {
    const res = await request(app).get(`/api/v1/datasets/${datasetId}`);

    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/v1/datasets/:id", () => {
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
        name: "Original Name",
        kind: "CUSTOM",
        status: "READY",
      },
    });
    datasetId = dataset.id;
  });

  it("updates dataset name", async () => {
    const res = await request(app)
      .patch(`/api/v1/datasets/${datasetId}`)
      .set("Cookie", authCookie)
      .send({ name: "Updated Name" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe("Updated Name");

    const updated = await prisma.dataset.findUnique({
      where: { id: datasetId },
    });
    expect(updated?.name).toBe("Updated Name");
  });

  it("rejects invalid input", async () => {
    const res = await request(app)
      .patch(`/api/v1/datasets/${datasetId}`)
      .set("Cookie", authCookie)
      .send({ name: "" });

    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/datasets/:id/versions", () => {
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

    // Create a version
    await prisma.datasetVersion.create({
      data: {
        datasetId,
        version: 1,
        commit: "APPEND",
        source: "UPLOAD",
        status: "READY",
      },
    });
  });

  it("returns dataset versions", async () => {
    const res = await request(app)
      .get(`/api/v1/datasets/${datasetId}/versions`)
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.versions).toBeInstanceOf(Array);
    expect(res.body.data.versions.length).toBeGreaterThan(0);
    expect(res.body.data.versions[0]).toHaveProperty("version");
    expect(res.body.data.versions[0]).toHaveProperty("commit");
  });
});

describe("GET /api/v1/datasets/:id/rows", () => {
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

    // Create a version and mark it current
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
  });

  it("returns paginated rows", async () => {
    const res = await request(app)
      .get(`/api/v1/datasets/${datasetId}/rows`)
      .set("Cookie", authCookie)
      .query({ limit: 10, offset: 0 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.rows).toBeInstanceOf(Array);
    expect(res.body.data).toHaveProperty("limit");
    expect(res.body.data).toHaveProperty("offset");
    expect(res.body.data).toHaveProperty("hasMore");
  });

  it("enforces limit constraints", async () => {
    const res = await request(app)
      .get(`/api/v1/datasets/${datasetId}/rows`)
      .set("Cookie", authCookie)
      .query({ limit: 200 });

    expect(res.status).toBe(200);
    expect(res.body.data.limit).toBeLessThanOrEqual(100);
  });
});
