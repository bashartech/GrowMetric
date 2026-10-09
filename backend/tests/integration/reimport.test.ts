import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { processImportDataJob } from "../../src/workers/handlers/import-data.js";
import { createVersionedDataset } from "../../src/modules/datasets/dataset.repo.js";
import type { VersionedCell } from "../../src/modules/datasets/dataset.types.js";
import { registerUser } from "../helpers/auth.js";
import { cleanupByEmails } from "../helpers/db.js";

const app = createApp();
const createdEmails: string[] = [];

afterAll(async () => {
  await cleanupByEmails(createdEmails);
  await prisma.$disconnect();
});

interface SeededContext {
  authCookie: string;
  datasetId: string;
  organizationId: string;
  workspaceId: string;
}

function csvBuffer(lines: Array<[number, number | string]>): Buffer {
  const body = ["id,amount", ...lines.map(([id, amount]) => `${id},${amount}`)].join("\n");
  return Buffer.from(body, "utf-8");
}

function cells(rowIndex: number, id: number, amount: number): VersionedCell[] {
  return [
    { columnName: "id", columnType: "INTEGER", value: id },
    { columnName: "amount", columnType: "DECIMAL", value: amount },
  ];
}

async function seedDataset(
  organizationId: string,
  workspaceId: string,
  dataSourceId: string,
): Promise<string> {
  const { datasetId } = await createVersionedDataset({
    organizationId,
    workspaceId,
    dataSourceId,
    datasetName: "Sales Ledger",
    datasetKind: "SALES",
    source: "UPLOAD",
    commit: "APPEND",
    columns: [
      { name: "id", type: "INTEGER", isNullable: false, ordinalPosition: 0 },
      { name: "amount", type: "DECIMAL", isNullable: false, ordinalPosition: 1 },
    ],
    rows: [cells(0, 10, 100), cells(1, 20, 200)],
    quality: {
      totalRows: 2,
      columnCount: 2,
      missingValuePct: 0,
      duplicateRowPct: 0,
      invalidNumberPct: 0,
      invalidDatePct: 0,
      numericOutlierCount: 0,
      status: "CLEAN",
      detail: [],
    },
  });
  return datasetId;
}

async function reimportAndProcess(
  ctx: SeededContext,
  commit: "APPEND" | "REPLACE" | "UPSERT",
  lines: Array<[number, number | string]>,
  upsertKey?: string,
) {
  const req = request(app)
    .post(`/api/v1/datasets/${ctx.datasetId}/re-import`)
    .set("Cookie", ctx.authCookie)
    .field("commit", commit)
    .attach("file", csvBuffer(lines), "reimport.csv");
  if (upsertKey) req.field("upsertKey", upsertKey);
  const res = await req;

  expect(res.status).toBe(202);
  expect(res.body.success).toBe(true);
  expect(res.body.data.import.status).toBe("QUEUED");
  expect(res.body.data.import.filename).toBe("reimport.csv");

  const importJob = await prisma.importJob.findUnique({
    where: { id: res.body.data.import.id },
    include: { job: true },
  });
  expect(importJob).not.toBeNull();
  expect(importJob!.datasetId).toBe(ctx.datasetId);

  await processImportDataJob(importJob!.job);

  return importJob!.job;
}

async function currentVersionState(datasetId: string) {
  const dataset = await prisma.dataset.findUnique({
    where: { id: datasetId },
    select: { rowCount: true, currentVersionId: true },
  });
  expect(dataset).not.toBeNull();
  const version = await prisma.datasetVersion.findUnique({
    where: { id: dataset!.currentVersionId ?? undefined },
  });
  const rowCount = await prisma.datasetRow.count({
    where: { datasetId, datasetVersionId: dataset!.currentVersionId ?? undefined },
  });
  return { dataset, version, rowCount };
}

async function seededContext(): Promise<SeededContext> {
  const { email, response } = await registerUser(app);
  createdEmails.push(email);
  const organizationId = response.body.data.organization.id;
  const workspaceId = response.body.data.workspace.id;
  const dataSource = await prisma.dataSource.create({
    data: {
      organizationId,
      workspaceId,
      name: "Test Source",
      kind: "FILE",
    },
  });
  const datasetId = await seedDataset(organizationId, workspaceId, dataSource.id);
  return {
    authCookie: response.headers["set-cookie"]?.[0] ?? "",
    datasetId,
    organizationId,
    workspaceId,
  };
}

describe("POST /api/v1/datasets/:id/re-import", () => {
  let ctx: SeededContext;

  beforeEach(async () => {
    ctx = await seededContext();
  });

  it("queues an import and returns immediately without running the worker", async () => {
    const res = await request(app)
      .post(`/api/v1/datasets/${ctx.datasetId}/re-import`)
      .set("Cookie", ctx.authCookie)
      .field("commit", "APPEND")
      .attach("file", csvBuffer([[30, 300]]), "append.csv");

    expect(res.status).toBe(202);

    const importJob = await prisma.importJob.findUnique({
      where: { id: res.body.data.import.id },
      include: { job: true },
    });
    expect(importJob?.datasetId).toBe(ctx.datasetId);
    expect(importJob?.job.type).toBe("IMPORT_DATA");
    expect(importJob?.job.payload).toMatchObject({
      commit: "APPEND",
      datasetName: "Sales Ledger",
    });

    // The dataset should be unchanged until the job is processed
    const { rowCount } = await currentVersionState(ctx.datasetId);
    expect(rowCount).toBe(2);
  });

  it("APPEND keeps prior rows and adds incoming rows", async () => {
    await reimportAndProcess(ctx, "APPEND", [[30, 300], [40, 400]]);

    const { dataset, version, rowCount } = await currentVersionState(ctx.datasetId);
    expect(version?.commit).toBe("APPEND");
    expect(version?.version).toBe(2);
    expect(dataset?.rowCount).toBe(4);
    expect(rowCount).toBe(4);
  });

  it("REPLACE drops prior rows and keeps only the incoming rows", async () => {
    await reimportAndProcess(ctx, "REPLACE", [[10, 125.5], [30, 300]]);

    const { dataset, version, rowCount } = await currentVersionState(ctx.datasetId);
    expect(version?.commit).toBe("REPLACE");
    expect(dataset?.rowCount).toBe(2);
    expect(rowCount).toBe(2);
  });

  it("UPSERT replaces rows with a matching key and keeps unique prior rows", async () => {
    await reimportAndProcess(ctx, "UPSERT", [[10, 150], [30, 300]], "id");

    const { dataset, version, rowCount } = await currentVersionState(ctx.datasetId);
    expect(version?.commit).toBe("UPSERT");
    expect(dataset?.rowCount).toBe(3);
    expect(rowCount).toBe(3);
  });

  it("requires an upsertKey for UPSERT", async () => {
    const res = await request(app)
      .post(`/api/v1/datasets/${ctx.datasetId}/re-import`)
      .set("Cookie", ctx.authCookie)
      .field("commit", "UPSERT")
      .attach("file", csvBuffer([[10, 150]]), "upsert.csv");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an upsertKey that is not a column of the dataset", async () => {
    const res = await request(app)
      .post(`/api/v1/datasets/${ctx.datasetId}/re-import`)
      .set("Cookie", ctx.authCookie)
      .field("commit", "UPSERT")
      .field("upsertKey", "missing_column")
      .attach("file", csvBuffer([[10, 150]]), "upsert.csv");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for a non-existent dataset", async () => {
    const res = await request(app)
      .post("/api/v1/datasets/00000000-0000-0000-0000-000000000000/re-import")
      .set("Cookie", ctx.authCookie)
      .field("commit", "APPEND")
      .attach("file", csvBuffer([[30, 300]]), "x.csv");

    expect(res.status).toBe(404);
  });

  it("requires authentication", async () => {
    const res = await request(app)
      .post(`/api/v1/datasets/${ctx.datasetId}/re-import`)
      .field("commit", "APPEND")
      .attach("file", csvBuffer([[30, 300]]), "x.csv");

    expect(res.status).toBe(401);
  });
});