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

describe("GET /api/v1/datasets/:id/versions (US4)", () => {
  let authCookie: string;
  let workspaceId: string;
  let organizationId: string;

  beforeEach(async () => {
    const { email, response } = await registerUser(app);
    createdEmails.push(email);
    authCookie = response.headers["set-cookie"]?.[0] ?? "";
    workspaceId = response.body.data.workspace.id;
    organizationId = response.body.data.organization.id;
  });

  it("creates one version per import and lists them in order", async () => {
    const csvPath = join(__dirname, "../fixtures/clean.csv");
    const buffer = await readFile(csvPath);

    const firstRes = await request(app)
      .post("/api/v1/data-sources")
      .set("Cookie", authCookie)
      .field("name", "Sales Source")
      .attach("file", buffer, "clean.csv");
    expect(firstRes.status).toBe(201);

    const firstImport = await prisma.importJob.findUnique({
      where: { id: firstRes.body.data.import.id },
      include: { job: true },
    });
    await processImportDataJob(firstImport!.job);

    const firstProcessed = await prisma.importJob.findUnique({
      where: { id: firstRes.body.data.import.id },
    });
    const datasetId = firstProcessed!.datasetId!;

    // Second import into the SAME data source → becomes Version 2
    const job = await prisma.job.create({
      data: {
        organizationId,
        type: "IMPORT_DATA",
        status: "PENDING",
        runAt: new Date(),
        payload: {
          importJobId: "pending",
          commit: "APPEND",
          datasetName: "Sales Source",
        },
      },
    });
    const secondImport = await prisma.importJob.create({
      data: {
        organizationId,
        workspaceId,
        dataSourceId: firstProcessed!.dataSourceId,
        datasetId,
        fileId: firstProcessed!.fileId,
        jobId: job.id,
        source: "UPLOAD",
        status: "QUEUED",
        filename: "clean.csv",
      },
    });
    await prisma.job.update({
      where: { id: job.id },
      data: {
        payload: {
          importJobId: secondImport.id,
          commit: "APPEND",
          datasetName: "Sales Source",
        },
      },
    });

    const secondImportJob = await prisma.importJob.findUnique({
      where: { id: secondImport.id },
      include: { job: true },
    });
    await processImportDataJob(secondImportJob!.job);

    const res = await request(app)
      .get(`/api/v1/datasets/${datasetId}/versions`)
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.versions).toHaveLength(2);
    expect(res.body.data.versions[0]).toMatchObject({
      version: 2,
      commit: "APPEND",
      source: "UPLOAD",
      status: "READY",
    });
    expect(res.body.data.versions[1]).toMatchObject({
      version: 1,
      commit: "APPEND",
      source: "UPLOAD",
    });
    expect(res.body.data.versions[0]).toHaveProperty("createdAt");

    const dataset = await prisma.dataset.findUnique({ where: { id: datasetId } });
    expect(dataset?.currentVersionId).toBe(res.body.data.versions[0].id);
  }, 180_000);

  it("keeps version history isolated per dataset", async () => {
    const csvPath = join(__dirname, "../fixtures/clean.csv");
    const buffer = await readFile(csvPath);

    const res = await request(app)
      .post("/api/v1/data-sources")
      .set("Cookie", authCookie)
      .field("name", "DataSource A")
      .attach("file", buffer, "a.csv");
    const importA = await prisma.importJob.findUnique({
      where: { id: res.body.data.import.id },
      include: { job: true },
    });
    await processImportDataJob(importA!.job);
    const processedA = await prisma.importJob.findUnique({
      where: { id: res.body.data.import.id },
    });
    const datasetIdA = processedA!.datasetId!;

    const res2 = await request(app)
      .post("/api/v1/data-sources")
      .set("Cookie", authCookie)
      .field("name", "DataSource B")
      .attach("file", buffer, "b.csv");
    const importB = await prisma.importJob.findUnique({
      where: { id: res2.body.data.import.id },
      include: { job: true },
    });
    await processImportDataJob(importB!.job);
    const processedB = await prisma.importJob.findUnique({
      where: { id: res2.body.data.import.id },
    });
    const datasetIdB = processedB!.datasetId!;

    const versionsA = await request(app)
      .get(`/api/v1/datasets/${datasetIdA}/versions`)
      .set("Cookie", authCookie);
    const versionsB = await request(app)
      .get(`/api/v1/datasets/${datasetIdB}/versions`)
      .set("Cookie", authCookie);

    expect(versionsA.body.data.versions).toHaveLength(1);
    expect(versionsB.body.data.versions).toHaveLength(1);
    expect(versionsA.body.data.versions[0].id).not.toBe(versionsB.body.data.versions[0].id);
  }, 180_000);
});