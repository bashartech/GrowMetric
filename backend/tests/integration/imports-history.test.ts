import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { registerUser } from "../helpers/auth.js";
import { cleanupByEmails } from "../helpers/db.js";
import { processImportDataJob } from "../../src/workers/handlers/import-data.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const app = createApp();
const createdEmails: string[] = [];

afterAll(async () => {
  await cleanupByEmails(createdEmails);
  await prisma.$disconnect();
});

async function upload(authCookie: string, filename: string, name: string) {
  const buffer = await readFile(join(__dirname, `../fixtures/${filename}`));
  const res = await request(app)
    .post("/api/v1/data-sources")
    .set("Cookie", authCookie)
    .field("name", name)
    .attach("file", buffer, filename);
  expect(res.status).toBe(201);
  return res.body.data;
}

async function processUpload(authCookie: string, filename: string, name: string) {
  const created = await upload(authCookie, filename, name);
  const importJob = await prisma.importJob.findUnique({
    where: { id: created.import.id },
    include: { job: true },
  });
  await processImportDataJob(importJob!.job);
  return created;
}

describe("GET /api/v1/imports (US4)", () => {
  let authCookie: string;

  beforeEach(async () => {
    const { email, response } = await registerUser(app);
    createdEmails.push(email);
    authCookie = response.headers["set-cookie"]?.[0] ?? "";
  });

  it("lists imports in reverse-chronological order with full metadata", async () => {
    const first = await processUpload(authCookie, "clean.csv", "First Import");
    const second = await upload(authCookie, "clean.csv", "Second Import");

    const res = await request(app)
      .get("/api/v1/imports")
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.imports).toHaveLength(2);
    expect(res.body.data.imports[0].id).toBe(second.import.id);
    expect(res.body.data.imports[1].id).toBe(first.import.id);

    const [latest, oldest] = res.body.data.imports;
    for (const item of [latest, oldest]) {
      expect(item).toHaveProperty("filename", "clean.csv");
      expect(item).toHaveProperty("source", "UPLOAD");
      expect(item).toHaveProperty("status");
      expect(item.dataSource).toMatchObject({ kind: "FILE" });
      expect(item.datasetId).toBeDefined();
      expect(item).toHaveProperty("createdAt");
    }

    expect(oldest.totalRows).toBeGreaterThan(0);
    expect(oldest.processedRows).toBe(oldest.totalRows);
    expect(oldest.startedAt).not.toBeNull();
    expect(oldest.completedAt).not.toBeNull();
    expect(oldest.dataset).toMatchObject({ status: "READY" });

    expect(latest.totalRows).toBeNull();
    expect(latest.startedAt).toBeNull();
  });

  it("records a safe error summary when a queued import is cancelled", async () => {
    const created = await upload(authCookie, "clean.csv", "Cancellable");

    const cancel = await request(app)
      .post(`/api/v1/imports/${created.import.id}/cancel`)
      .set("Cookie", authCookie);

    expect(cancel.status).toBe(200);
    expect(cancel.body.data).toEqual({ cancelled: true });

    const detail = await request(app)
      .get(`/api/v1/imports/${created.import.id}`)
      .set("Cookie", authCookie);

    expect(detail.status).toBe(200);
    expect(detail.body.data.status).toBe("FAILED");
    expect(detail.body.data.error).toBe("Cancelled by user");
    expect(detail.body.data.completedAt).not.toBeNull();
    expect(detail.body.data.job.status).toBe("FAILED");
    expect(detail.body.data.job.lastError).toBe("Cancelled by user");
  });

  it("filters by status and data source", async () => {
    const completed = await processUpload(authCookie, "clean.csv", "Completed");
    await upload(authCookie, "clean.csv", "Queued");

    const byStatus = await request(app)
      .get("/api/v1/imports")
      .query({ status: "COMPLETED" })
      .set("Cookie", authCookie);
    expect(byStatus.body.data.imports).toHaveLength(1);
    expect(byStatus.body.data.imports[0].id).toBe(completed.import.id);

    const bySource = await request(app)
      .get("/api/v1/imports")
      .query({ dataSourceId: completed.dataSource.id })
      .set("Cookie", authCookie);
    expect(bySource.body.data.imports).toHaveLength(1);
    expect(bySource.body.data.imports[0].id).toBe(completed.import.id);
  });

  it("paginates with meta information", async () => {
    const first = await processUpload(authCookie, "clean.csv", "One");
    await upload(authCookie, "clean.csv", "Two");

    const firstImport = await prisma.importJob.findUniqueOrThrow({
      where: { id: first.import.id },
      select: { datasetId: true },
    });
    const buffer = await readFile(join(__dirname, "../fixtures/clean.csv"));
    const reimport = await request(app)
      .post(`/api/v1/datasets/${firstImport.datasetId}/re-import`)
      .set("Cookie", authCookie)
      .field("commit", "APPEND")
      .attach("file", buffer, "clean.csv");
    expect(reimport.status).toBe(202);

    const page1 = await request(app)
      .get("/api/v1/imports")
      .query({ page: 1, pageSize: 2 })
      .set("Cookie", authCookie);
    expect(page1.status).toBe(200);
    expect(page1.body.data.imports).toHaveLength(2);
    expect(page1.body.data.meta).toEqual({
      page: 1,
      pageSize: 2,
      total: 3,
      hasMore: true,
    });

    const page2 = await request(app)
      .get("/api/v1/imports")
      .query({ page: 2, pageSize: 2 })
      .set("Cookie", authCookie);
    expect(page2.body.data.imports).toHaveLength(1);
    expect(page2.body.data.meta.hasMore).toBe(false);
  });

  it("rejects an oversized page size", async () => {
    const res = await request(app)
      .get("/api/v1/imports")
      .query({ pageSize: 101 })
      .set("Cookie", authCookie);

    expect(res.status).toBe(400);
  });
});