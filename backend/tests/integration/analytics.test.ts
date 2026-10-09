import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { registerUser } from "../helpers/auth.js";
import { cleanupByEmails } from "../helpers/db.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { processImportDataJob } from "../../src/workers/handlers/import-data.js";

const app = createApp();
const createdEmails: string[] = [];

afterAll(async () => {
  await cleanupByEmails(createdEmails);
  await prisma.$disconnect();
});

async function uploadAndProcess(
  authCookie: string,
): Promise<{ datasetId: string; dateColumnId: string; groupByColumnId: string }> {
  const csvPath = join(__dirname, "../fixtures/sales.csv");
  const csvBuffer = await readFile(csvPath);

  const res = await request(app)
    .post("/api/v1/data-sources")
    .set("Cookie", authCookie)
    .field("name", "Sales Data")
    .attach("file", csvBuffer, "sales.csv");

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

  const dataset = await prisma.dataset.findUnique({
    where: { id: processed!.datasetId! },
    include: { columns: true },
  });
  expect(dataset).not.toBeNull();

  const dateColumnId = dataset!.columns.find((c) => c.semanticKey === "order_date")!.id;
  const groupByColumnId = dataset!.columns.find((c) => c.semanticKey === "region")!.id;

  return {
    datasetId: processed!.datasetId!,
    dateColumnId,
    groupByColumnId,
  };
}

describe("POST /api/v1/analytics/metrics", () => {
  let authCookie: string;
  let datasetId: string;

  beforeEach(async () => {
    const { email, response } = await registerUser(app);
    createdEmails.push(email);
    authCookie = response.headers["set-cookie"]?.[0] ?? "";

    const { datasetId: id } = await uploadAndProcess(authCookie);
    datasetId = id;
  });

  it("returns correct aggregate for REVENUE metric", async () => {
    const res = await request(app)
      .post("/api/v1/analytics/metrics")
      .set("Cookie", authCookie)
      .send({
        datasetId,
        metricKind: "REVENUE",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.metricKind).toBe("REVENUE");
    expect(typeof res.body.data.value).toBe("number");
    expect(res.body.data.unit).toBe("USD");
    expect(res.body.data.available).toBe(true);
  });

  it("returns available: false for metric not in dataset", async () => {
    const res = await request(app)
      .post("/api/v1/analytics/metrics")
      .set("Cookie", authCookie)
      .send({
        datasetId,
        metricKind: "ORDERS",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.metricKind).toBe("ORDERS");
    expect(res.body.data.value).toBeNull();
    expect(res.body.data.available).toBe(false);
  });

  it("returns NOT_FOUND for non-existent dataset", async () => {
    const res = await request(app)
      .post("/api/v1/analytics/metrics")
      .set("Cookie", authCookie)
      .send({
        datasetId: "00000000-0000-0000-0000-000000000000",
        metricKind: "REVENUE",
      });

    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/analytics/compare-periods", () => {
  let authCookie: string;
  let datasetId: string;
  let dateColumnId: string;

  beforeEach(async () => {
    const { email, response } = await registerUser(app);
    createdEmails.push(email);
    authCookie = response.headers["set-cookie"]?.[0] ?? "";

    const { datasetId: id, dateColumnId: dId } = await uploadAndProcess(authCookie);
    datasetId = id;
    dateColumnId = dId;
  });

  it("returns period comparison with changeAvailable semantics", async () => {
    const res = await request(app)
      .post("/api/v1/analytics/compare-periods")
      .set("Cookie", authCookie)
      .send({
        datasetId,
        metricKind: "REVENUE",
        dateColumnId,
        periodFrom: "2026-02-01T00:00:00.000Z",
        periodTo: "2026-02-28T23:59:59.000Z",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.metricKind).toBe("REVENUE");
    expect(typeof res.body.data.value).toBe("number");
    expect(typeof res.body.data.previousValue).toBe("number");
    expect(typeof res.body.data.change).toBe("number");
    expect(typeof res.body.data.changePct).toBe("number");
    expect(typeof res.body.data.changeAvailable).toBe("boolean");
    expect(res.body.data.unit).toBe("USD");
  });

  it("sets changeAvailable to false when previousValue is 0", async () => {
    const res = await request(app)
      .post("/api/v1/analytics/compare-periods")
      .set("Cookie", authCookie)
      .send({
        datasetId,
        metricKind: "REVENUE",
        dateColumnId,
        periodFrom: "2030-01-01T00:00:00.000Z",
        periodTo: "2030-01-31T23:59:59.000Z",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.changeAvailable).toBe(false);
    expect(res.body.data.change).toBeNull();
    expect(res.body.data.changePct).toBeNull();
  });
});

describe("POST /api/v1/analytics/group-by", () => {
  let authCookie: string;
  let datasetId: string;
  let groupByColumnId: string;

  beforeEach(async () => {
    const { email, response } = await registerUser(app);
    createdEmails.push(email);
    authCookie = response.headers["set-cookie"]?.[0] ?? "";

    const { datasetId: id, groupByColumnId: gId } = await uploadAndProcess(authCookie);
    datasetId = id;
    groupByColumnId = gId;
  });

  it("returns grouped rows with correct totals", async () => {
    const res = await request(app)
      .post("/api/v1/analytics/group-by")
      .set("Cookie", authCookie)
      .send({
        datasetId,
        metricKind: "REVENUE",
        groupByColumnId,
        limit: 10,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.metricKind).toBe("REVENUE");
    expect(res.body.data.available).toBe(true);
    expect(Array.isArray(res.body.data.rows)).toBe(true);
    expect(typeof res.body.data.total).toBe("number");

    for (const row of res.body.data.rows) {
      expect(row).toHaveProperty("group");
      expect(row).toHaveProperty("value");
      expect(typeof row.group).toBe("string");
      expect(typeof row.value).toBe("number");
    }
  });

  it("returns available: false for invalid group by column", async () => {
    const res = await request(app)
      .post("/api/v1/analytics/group-by")
      .set("Cookie", authCookie)
      .send({
        datasetId,
        metricKind: "REVENUE",
        groupByColumnId: "00000000-0000-0000-0000-000000000000",
        limit: 10,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.available).toBe(false);
    expect(res.body.data.rows).toEqual([]);
  });
});