import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { AppError } from "../../src/lib/http-errors.js";
import { registerUser } from "../helpers/auth.js";
import { cleanupByEmails } from "../helpers/db.js";
import { processSyncDatabaseJob } from "../../src/workers/handlers/sync-database.js";
import { connectReadOnly } from "../../src/lib/external-db.js";

const SECRET_PASSWORD = "CredentialHunterSecret123";

function createMockDriver() {
  return {
    connect: vi.fn(async () => undefined),
    query: vi.fn(async () => ({ rows: [] })),
    end: vi.fn(async () => undefined),
  };
}

const state = vi.hoisted(() => ({
  driver: null as ReturnType<typeof createMockDriver> | null,
  connectError: null as Error | null,
  discovered: [
    { schemaName: "public", tableName: "orders", columnCount: 4, rowEstimate: 100 },
  ] as Array<{
    schemaName: string;
    tableName: string;
    columnCount: number;
    rowEstimate: number;
  }>,
  columns: [
    { name: "id", dataType: "integer" },
    { name: "total", dataType: "numeric" },
    { name: "region", dataType: "text" },
    { name: "order_date", dataType: "timestamp" },
  ] as Array<{ name: string; dataType: string }>,
  rows: [
    {
      id: 1,
      total: 25.5,
      region: "West",
      order_date: new Date("2026-01-05T00:00:00.000Z"),
    },
    {
      id: 2,
      total: 74.5,
      region: "East",
      order_date: new Date("2026-01-06T00:00:00.000Z"),
    },
  ] as Array<Record<string, unknown>>,
}));

vi.mock("../../src/lib/external-db.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/external-db.js")>();
  return {
    ...actual,
    connectReadOnly: vi.fn(async () => {
      if (state.connectError) throw state.connectError;
      if (!state.driver) state.driver = createMockDriver();
      return state.driver;
    }),
    discoverTables: vi.fn(async () => state.discovered),
    listColumns: vi.fn(async () => state.columns),
    streamSelect: vi.fn(
      async (_driver: unknown, _schema: string, _table: string, _cap: number, onRow: (row: Record<string, unknown>) => void | Promise<void>) => {
        for (const row of state.rows) await onRow(row);
      },
    ),
  };
});

const app = createApp();
const createdEmails: string[] = [];

afterAll(async () => {
  await cleanupByEmails(createdEmails);
  await prisma.$disconnect();
});

function externalDbBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "Production DB",
    host: "db.example.com",
    port: 5432,
    database: "analytics",
    username: "dd_readonly_user",
    password: SECRET_PASSWORD,
    sslMode: "require",
    ...overrides,
  };
}

describe("POST /api/v1/data-sources/external-db", () => {
  let authCookie: string;

  beforeEach(async () => {
    const { email, response } = await registerUser(app);
    createdEmails.push(email);
    authCookie = response.headers["set-cookie"]?.[0] ?? "";
    state.connectError = null;
    state.driver = null;
  });

  it("creates EXTERNAL_DB source after read-only verification and encrypts credentials", async () => {
    const res = await request(app)
      .post("/api/v1/data-sources/external-db")
      .set("Cookie", authCookie)
      .send(externalDbBody());

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.dataSource.kind).toBe("EXTERNAL_DB");
    expect(res.body.data.dataSource.status).toBe("CONNECTED");
    expect(res.body.data.dataSource.name).toBe("Production DB");
    expect(state.driver).not.toBeNull();

    const stored = await prisma.dataSourceCredential.findFirst({
      where: { dataSourceId: res.body.data.dataSource.id },
    });
    expect(stored).not.toBeNull();
    expect(stored!.passwordEnc).not.toContain(SECRET_PASSWORD);
    expect(stored!.passwordEnc).not.toContain("CredentialHunter");

    const tableCount = await prisma.dataSourceTable.count({
      where: { dataSourceId: res.body.data.dataSource.id },
    });
    expect(tableCount).toBe(state.discovered.length);
  });

  it("rejects a non-read-only connection with EXT_DB_NOT_READ_ONLY", async () => {
    state.connectError = new AppError(
      "EXT_DB_NOT_READ_ONLY",
      "The database connection must be read-only.",
    );

    const res = await request(app)
      .post("/api/v1/data-sources/external-db")
      .set("Cookie", authCookie)
      .send(externalDbBody());

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("EXT_DB_NOT_READ_ONLY");
  });

  it("returns EXT_DB_CONNECTION_FAILED when the external database is unreachable", async () => {
    state.connectError = new AppError(
      "EXT_DB_CONNECTION_FAILED",
      "Could not connect to the external database.",
    );

    const res = await request(app)
      .post("/api/v1/data-sources/external-db")
      .set("Cookie", authCookie)
      .send(externalDbBody());

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("EXT_DB_CONNECTION_FAILED");
  });
});

describe("external DB credentials security", () => {
  let authCookie: string;
  let dataSourceId: string;

  beforeEach(async () => {
    const { email, response } = await registerUser(app);
    createdEmails.push(email);
    authCookie = response.headers["set-cookie"]?.[0] ?? "";
    state.connectError = null;

    const res = await request(app)
      .post("/api/v1/data-sources/external-db")
      .set("Cookie", authCookie)
      .send(externalDbBody());
    expect(res.status).toBe(201);
    dataSourceId = res.body.data.dataSource.id;
  });

  it("never returns the password in list responses", async () => {
    const res = await request(app)
      .get("/api/v1/data-sources")
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(SECRET_PASSWORD);
    expect(JSON.stringify(res.body)).not.toContain("passwordEnc");
  });

  it("never returns the password or credential fields in detail responses", async () => {
    const res = await request(app)
      .get(`/api/v1/data-sources/${dataSourceId}`)
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(SECRET_PASSWORD);
    expect(body).not.toContain("passwordEnc");
    expect(body).not.toContain("host");
  });
});

describe("external DB table selection and sync", () => {
  let authCookie: string;
  let dataSourceId: string;

  beforeEach(async () => {
    const { email, response } = await registerUser(app);
    createdEmails.push(email);
    authCookie = response.headers["set-cookie"]?.[0] ?? "";
    state.connectError = null;

    const res = await request(app)
      .post("/api/v1/data-sources/external-db")
      .set("Cookie", authCookie)
      .send(externalDbBody());
    expect(res.status).toBe(201);
    dataSourceId = res.body.data.dataSource.id;
  });

  it("lists discovered tables with column counts and row estimates", async () => {
    const res = await request(app)
      .get(`/api/v1/data-sources/${dataSourceId}/tables`)
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tables).toEqual([
      expect.objectContaining({
        schemaName: "public",
        tableName: "orders",
        columnCount: 4,
        rowEstimate: 100,
        isSelected: false,
      }),
    ]);

    const lastConnectConfig = vi.mocked(connectReadOnly).mock.calls.at(-1)?.[0];
    expect(lastConnectConfig).toBeDefined();
    expect(lastConnectConfig!.password).toBe(SECRET_PASSWORD);
    expect(lastConnectConfig!.password).not.toContain('"host"');
  });

  it("selects tables and syncs them into datasets", async () => {
    const patch = await request(app)
      .patch(`/api/v1/data-sources/${dataSourceId}/tables`)
      .set("Cookie", authCookie)
      .send({
        tables: [{ schemaName: "public", tableName: "orders", isSelected: true }],
      });

    expect(patch.status).toBe(200);
    expect(patch.body.data.selectedCount).toBe(1);

    const sync = await request(app)
      .post(`/api/v1/data-sources/${dataSourceId}/sync`)
      .set("Cookie", authCookie)
      .send({});

    expect(sync.status).toBe(202);
    expect(sync.body.success).toBe(true);
    expect(sync.body.data.importJobs).toHaveLength(1);
    expect(sync.body.data.importJobs[0]).toEqual(
      expect.objectContaining({
        source: "TABLE_SYNC",
        status: "QUEUED",
        filename: "public.orders",
      }),
    );

    const importJob = await prisma.importJob.findUnique({
      where: { id: sync.body.data.importJobs[0].id },
      include: { job: true },
    });
    expect(importJob).not.toBeNull();

    await processSyncDatabaseJob(importJob!.job);

    const processed = await prisma.importJob.findUnique({
      where: { id: importJob!.id },
    });
    expect(processed?.status).toBe("COMPLETED");
    expect(processed?.totalRows).toBe(2);

    const workerConnectConfig = vi.mocked(connectReadOnly).mock.calls.at(-1)?.[0];
    expect(workerConnectConfig).toBeDefined();
    expect(workerConnectConfig!.password).toBe(SECRET_PASSWORD);
    expect(workerConnectConfig!.password).not.toContain('"host"');

    const dataset = await prisma.dataset.findFirst({
      where: { dataSourceId },
    });
    expect(dataset).not.toBeNull();
    expect(dataset!.sourceTable).toBe("public.orders");
    expect(dataset!.rowCount).toBe(2);

    const source = await prisma.dataSource.findUnique({ where: { id: dataSourceId } });
    expect(source?.lastSyncAt).not.toBeNull();
  });

  it("returns 400 when no tables are selected", async () => {
    const res = await request(app)
      .post(`/api/v1/data-sources/${dataSourceId}/sync`)
      .set("Cookie", authCookie)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });

  it("returns 404 for a non-existent data source", async () => {
    const res = await request(app)
      .get("/api/v1/data-sources/00000000-0000-0000-0000-000000000000/tables")
      .set("Cookie", authCookie);

    expect(res.status).toBe(404);
  });
});