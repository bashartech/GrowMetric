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

async function uploadAndProcess(
  authCookie: string,
  fileName: string,
): Promise<{ importId: string; datasetId: string }> {
  const csvPath = join(__dirname, `../fixtures/${fileName}`);
  const buffer = await readFile(csvPath);

  const res = await request(app)
    .post("/api/v1/data-sources")
    .set("Cookie", authCookie)
    .field("name", "Mapping Source")
    .attach("file", buffer, fileName);

  expect(res.status).toBe(201);

  const importJob = await prisma.importJob.findUnique({
    where: { id: res.body.data.import.id },
    include: { job: true },
  });
  expect(importJob).not.toBeNull();

  await processImportDataJob(importJob!.job);

  const processed = await prisma.importJob.findUnique({
    where: { id: res.body.data.import.id },
  });
  expect(processed?.datasetId).not.toBeNull();

  return {
    importId: res.body.data.import.id,
    datasetId: processed!.datasetId!,
  };
}

describe("POST /api/v1/datasets/:id/confirm-mapping (US3)", () => {
  let authCookie: string;

  beforeEach(async () => {
    const { email, response } = await registerUser(app);
    createdEmails.push(email);
    authCookie = response.headers["set-cookie"]?.[0] ?? "";
  });

  it("pauses at REQUESTING_MAPPING and persists candidate mappings", async () => {
    const { importId, datasetId } = await uploadAndProcess(authCookie, "ambiguous.csv");

    const importJob = await prisma.importJob.findUnique({ where: { id: importId } });
    expect(importJob?.status).toBe("REQUESTING_MAPPING");
    expect(importJob?.startedAt).not.toBeNull();
    // Not complete while awaiting user confirmation
    expect(importJob?.completedAt).toBeNull();

    const dataset = await prisma.dataset.findUnique({ where: { id: datasetId } });
    expect(dataset?.status).toBe("DRAFT");

    const res = await request(app)
      .get(`/api/v1/datasets/${datasetId}`)
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.pendingMappings).toHaveLength(1);
    const pending = res.body.data.pendingMappings[0];
    expect(pending.columnName).toBe("customer_revenue");
    expect(pending.datasetColumnId).toBeDefined();
    const candidateKeys = pending.candidates.map(
      (candidate: { semanticKey: string }) => candidate.semanticKey,
    );
    expect(candidateKeys).toContain("revenue");
    expect(candidateKeys).toContain("customers");
    expect(
      pending.candidates.every(
        (candidate: { confidence: number }) =>
          typeof candidate.confidence === "number" && candidate.confidence > 0,
      ),
    ).toBe(true);

    // Columns carry the best-guess mapping plus a sample value
    const customerRevenue = res.body.data.columns.find(
      (column: { name: string }) => column.name === "customer_revenue",
    );
    expect(customerRevenue).toBeDefined();
    expect(customerRevenue.semanticKey).toBe("revenue");
    expect(customerRevenue.representativeSample).toBeDefined();
  });

  it("confirms mappings, completes the import, and readies the dataset", async () => {
    const { importId, datasetId } = await uploadAndProcess(authCookie, "ambiguous.csv");

    const detailRes = await request(app)
      .get(`/api/v1/datasets/${datasetId}`)
      .set("Cookie", authCookie);
    const pending = detailRes.body.data.pendingMappings[0];

    const res = await request(app)
      .post(`/api/v1/datasets/${datasetId}/confirm-mapping`)
      .set("Cookie", authCookie)
      .send({
        mappings: [
          {
            datasetColumnId: pending.datasetColumnId,
            semanticKey: "revenue",
            businessMeaning: "Revenue",
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("READY");

    const importJob = await prisma.importJob.findUnique({ where: { id: importId } });
    expect(importJob?.status).toBe("COMPLETED");
    expect(importJob?.completedAt).not.toBeNull();

    const dataset = await prisma.dataset.findUnique({ where: { id: datasetId } });
    expect(dataset?.status).toBe("READY");

    const refreshed = await request(app)
      .get(`/api/v1/datasets/${datasetId}`)
      .set("Cookie", authCookie);
    expect(refreshed.body.data.pendingMappings).toEqual([]);
    const column = refreshed.body.data.columns.find(
      (c: { name: string }) => c.name === "customer_revenue",
    );
    expect(column.semanticKey).toBe("revenue");
    expect(column.businessMeaning).toBe("Revenue");
  });

  it("rejects confirmation when no mapping is pending", async () => {
    const { datasetId } = await uploadAndProcess(authCookie, "clean.csv");

    const importJob = await prisma.importJob.findFirst({
      where: { datasetId },
      orderBy: { createdAt: "desc" },
    });
    expect(importJob?.status).toBe("COMPLETED");

    const res = await request(app)
      .post(`/api/v1/datasets/${datasetId}/confirm-mapping`)
      .set("Cookie", authCookie)
      .send({
        mappings: [
          {
            datasetColumnId: "00000000-0000-0000-0000-000000000000",
            semanticKey: "revenue",
            businessMeaning: "Revenue",
          },
        ],
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });

  it("validates the request body", async () => {
    const { datasetId } = await uploadAndProcess(authCookie, "ambiguous.csv");

    const res = await request(app)
      .post(`/api/v1/datasets/${datasetId}/confirm-mapping`)
      .set("Cookie", authCookie)
      .send({ mappings: [] });

    expect(res.status).toBe(400);
  });

  it("enforces organization isolation", async () => {
    const { datasetId } = await uploadAndProcess(authCookie, "ambiguous.csv");

    const other = await registerUser(app);
    createdEmails.push(other.email);

    const res = await request(app)
      .post(`/api/v1/datasets/${datasetId}/confirm-mapping`)
      .set("Cookie", other.response.headers["set-cookie"]?.[0] ?? "")
      .send({
        mappings: [
          {
            datasetColumnId: "00000000-0000-0000-0000-000000000000",
            semanticKey: "revenue",
            businessMeaning: "Revenue",
          },
        ],
      });

    expect(res.status).toBe(404);
  });

  it("rejects a column id that does not belong to the current version", async () => {
    const { datasetId } = await uploadAndProcess(authCookie, "ambiguous.csv");

    const res = await request(app)
      .post(`/api/v1/datasets/${datasetId}/confirm-mapping`)
      .set("Cookie", authCookie)
      .send({
        mappings: [
          {
            datasetColumnId: "00000000-0000-0000-0000-000000000000",
            semanticKey: "revenue",
            businessMeaning: "Revenue",
          },
        ],
      });

    expect(res.status).toBe(404);
  });
});