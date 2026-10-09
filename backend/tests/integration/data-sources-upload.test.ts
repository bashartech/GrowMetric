import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { registerUser } from "../helpers/auth.js";
import { cleanupByEmails } from "../helpers/db.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const app = createApp();
const createdEmails: string[] = [];

afterAll(async () => {
  await cleanupByEmails(createdEmails);
  await prisma.$disconnect();
});

describe("POST /api/v1/data-sources (file upload)", () => {
  let authCookie: string;
  let workspaceId: string;

  beforeEach(async () => {
    const { email, response } = await registerUser(app);
    createdEmails.push(email);
    authCookie = response.headers["set-cookie"]?.[0] ?? "";
    workspaceId = response.body.data.workspace.id;
  });

  it("creates DataSource + ImportJob + Job atomically and returns immediately", async () => {
    const csvPath = join(__dirname, "../fixtures/sales.csv");
    const csvBuffer = await readFile(csvPath);

    const res = await request(app)
      .post("/api/v1/data-sources")
      .set("Cookie", authCookie)
      .field("name", "Sales Data")
      .attach("file", csvBuffer, "sales.csv");

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.dataSource).toBeDefined();
    expect(res.body.data.dataSource.kind).toBe("FILE");
    expect(res.body.data.dataSource.status).toBe("NEW");
    expect(res.body.data.import).toBeDefined();
    expect(res.body.data.import.status).toBe("QUEUED");
    expect(res.body.data.import.filename).toBe("sales.csv");

    // Verify database records
    const dataSource = await prisma.dataSource.findUnique({
      where: { id: res.body.data.dataSource.id },
      include: { importFiles: true, imports: true },
    });

    expect(dataSource).not.toBeNull();
    expect(dataSource!.workspaceId).toBe(workspaceId);
    expect(dataSource!.importFiles).toHaveLength(1);
    expect(dataSource!.imports).toHaveLength(1);

    const importJob = await prisma.importJob.findUnique({
      where: { id: res.body.data.import.id },
      include: { job: true },
    });

    expect(importJob).not.toBeNull();
    expect(importJob!.status).toBe("QUEUED");
    expect(importJob!.job.type).toBe("IMPORT_DATA");
    expect(importJob!.job.status).toBe("PENDING");

    // Verify audit log
    const audit = await prisma.auditLog.findFirst({
      where: {
        action: "data-source.create",
        resourceId: dataSource!.id,
      },
    });
    expect(audit).not.toBeNull();
  });

  it("accepts valid Excel file", async () => {
    const xlsxPath = join(__dirname, "../fixtures/valid.xlsx");
    const xlsxBuffer = await readFile(xlsxPath);

    const res = await request(app)
      .post("/api/v1/data-sources")
      .set("Cookie", authCookie)
      .field("name", "Excel Import")
      .attach("file", xlsxBuffer, "data.xlsx");

    expect(res.status).toBe(201);
    expect(res.body.data.import.filename).toBe("data.xlsx");
  });

  it("enforces authentication", async () => {
    const res = await request(app)
      .post("/api/v1/data-sources")
      .field("name", "Test")
      .attach("file", Buffer.from("test"), "test.csv");

    expect(res.status).toBe(401);
  });

  it("requires name field", async () => {
    const res = await request(app)
      .post("/api/v1/data-sources")
      .set("Cookie", authCookie)
      .attach("file", Buffer.from("a,b\n1,2"), "test.csv");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("requires file attachment", async () => {
    const res = await request(app)
      .post("/api/v1/data-sources")
      .set("Cookie", authCookie)
      .field("name", "Test");

    expect(res.status).toBe(400);
  });

  it("records usage for data_sources metric", async () => {
    const csvBuffer = Buffer.from("a,b\n1,2");

    await request(app)
      .post("/api/v1/data-sources")
      .set("Cookie", authCookie)
      .field("name", "Source 1")
      .attach("file", csvBuffer, "s1.csv");

    const user = await prisma.user.findFirst({ where: { email: createdEmails[0] } });
    const usage = await prisma.usageRecord.findFirst({
      where: {
        organizationId: user!.organizationId,
        metric: "data_sources",
      },
    });

    expect(usage).not.toBeNull();
    expect(usage!.amount).toBeGreaterThan(0);
  });
});

describe("File validation rejections", () => {
  let authCookie: string;

  beforeEach(async () => {
    const { email, response } = await registerUser(app);
    createdEmails.push(email);
    authCookie = response.headers["set-cookie"]?.[0] ?? "";
  });

  it("rejects oversized file (>25MB)", async () => {
    const maxBytes = 26_214_400;
    const oversized = Buffer.alloc(maxBytes + 1);

    const res = await request(app)
      .post("/api/v1/data-sources")
      .set("Cookie", authCookie)
      .field("name", "Too Large")
      .attach("file", oversized, "large.csv");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("FILE_TOO_LARGE");
  });

  it("rejects unsupported file type", async () => {
    const res = await request(app)
      .post("/api/v1/data-sources")
      .set("Cookie", authCookie)
      .field("name", "PDF File")
      .attach("file", Buffer.from("fake pdf"), "doc.pdf");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("FILE_TYPE_UNSUPPORTED");
  });

  it("rejects empty file", async () => {
    const res = await request(app)
      .post("/api/v1/data-sources")
      .set("Cookie", authCookie)
      .field("name", "Empty File")
      .attach("file", Buffer.alloc(0), "empty.csv");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toMatch(/EMPTY|INVALID/);
  });

  it("rejects file with bad magic bytes", async () => {
    const fakeExcel = Buffer.from("This is not an Excel file");

    const res = await request(app)
      .post("/api/v1/data-sources")
      .set("Cookie", authCookie)
      .field("name", "Fake Excel")
      .attach("file", fakeExcel, "fake.xlsx");

    expect(res.status).toBe(400);
  });
});
