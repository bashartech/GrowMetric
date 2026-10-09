import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatasetColumn } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  queryRawUnsafe: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("../../src/lib/prisma.js", () => ({
  prisma: {
    dataset: { findFirst: mocks.findFirst },
    datasetColumn: { findMany: mocks.findMany },
    $queryRawUnsafe: mocks.queryRawUnsafe,
  },
}));

import {
  buildWideProjection,
  capStatement,
  runReadonlySql,
  sanitizeStatement,
  validateSelect,
} from "../../src/lib/agent/sql-tool.js";

const FACTORY_COLUMNS = [
  {
    id: "col-revenue",
    datasetId: "ds-1",
    datasetVersionId: "v1",
    name: "total",
    type: "DECIMAL",
    ordinalPosition: 0,
    isNullable: false,
    semanticKey: "revenue",
    businessMeaning: null,
    representativeSample: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "col-date",
    datasetId: "ds-1",
    datasetVersionId: "v1",
    name: "order_date",
    type: "DATE",
    ordinalPosition: 1,
    isNullable: true,
    semanticKey: "order_date",
    businessMeaning: null,
    representativeSample: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
] as unknown as DatasetColumn[];

const FAKE_DATASET = {
  id: "ds-1",
  organizationId: "org-1",
  workspaceId: "ws-1",
  currentVersionId: "v1",
  versions: [{ id: "v1", version: 1 }],
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.queryRawUnsafe.mockResolvedValue([]);
  mocks.findFirst.mockResolvedValue(FAKE_DATASET);
  mocks.findMany.mockResolvedValue(FACTORY_COLUMNS);
});

describe("sql-tool sanitizer", () => {
  it("only accepts SELECT-first statements", () => {
    expect(sanitizeStatement("select revenue from dataset")).toMatch(/^select/i);
    expect(sanitizeStatement("WITH x AS (...) SELECT 1")).toBeNull();
    expect(sanitizeStatement("UPDATE dataset SET x = 1")).toBeNull();
  });

  it("rejects script splitting and comments", () => {
    expect(sanitizeStatement("select 1; drop table dataset")).toBeNull();
    expect(sanitizeStatement("select 1 -- comment")).toBeNull();
    expect(sanitizeStatement("select 1 /* comment */")).toBeNull();
  });

  it("rejects SELECT * and mutation keywords", () => {
    expect(sanitizeStatement("select * from dataset")).toBeNull();
    expect(sanitizeStatement("select 1 from dataset where exists (delete)")).toBeNull();
  });

  it("rejects dangerous functions and catalog access", () => {
    expect(validateSelect("select pg_sleep(5)")).toBeTruthy();
    expect(validateSelect("select version() from pg_catalog.foo")).toBeTruthy();
    expect(validateSelect("select 1::regclass")).toBeTruthy();
  });
});

describe("sql-tool capStatement", () => {
  it("rejects identifiers outside the projected columns and safe grammar", () => {
    const result = capStatement(
      "SELECT total FROM (...) AS dataset",
      FACTORY_COLUMNS,
      "SELECT total FROM dataset",
    );
    expect(result.ok).toBe(true);

    const bad = capStatement(
      "SELECT total FROM dataset",
      FACTORY_COLUMNS,
      "SELECT total FROM dataset WHERE secret_column > 1",
    );
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/unknown identifier/);
  });

  it("rejects semantic-key identifiers so the model learns to use original names", () => {
    const bad = capStatement(
      "SELECT revenue FROM dataset",
      FACTORY_COLUMNS,
      "SELECT revenue FROM dataset",
    );
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/unknown identifier "revenue"/);
  });

  it("always wraps the statement and injects a single final LIMIT", () => {
    const result = capStatement(
      "SELECT total FROM dataset LIMIT 20",
      FACTORY_COLUMNS,
      "SELECT total FROM dataset LIMIT 20",
    );
    expect(result.ok).toBe(true);
    expect(result.sql).toMatch(/^SELECT \* FROM \(\n/);
    expect(result.sql).toMatch(/\) AS _q LIMIT 50$/);
  });

  it("keeps an inner LIMIT/OFFSET valid by wrapping instead of stripping", () => {
    const result = capStatement(
      "SELECT total FROM dataset LIMIT 20 OFFSET 5",
      FACTORY_COLUMNS,
      "SELECT total FROM dataset LIMIT 20 OFFSET 5",
    );
    expect(result.ok).toBe(true);
    expect(result.sql).toMatch(/\) AS _q LIMIT 50$/);
  });

  it("accepts aliases introduced in the SELECT clause", () => {
    const result = capStatement(
      'SELECT "total", COUNT(*) AS n FROM dataset GROUP BY "total"',
      FACTORY_COLUMNS,
      "SELECT total, COUNT(*) AS n FROM dataset GROUP BY total",
    );
    expect(result.ok).toBe(true);
  });
});

describe("sql-tool runReadonlySql", () => {
  it("rejects destructive statements without touching the database", async () => {
    const result = await runReadonlySql(
      { datasetId: "ds-1", statement: "delete from dataset where 1=1" },
      "org-1",
      "ws-1",
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(mocks.queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("rejects SELECT * statements", async () => {
    const result = await runReadonlySql(
      { datasetId: "ds-1", statement: "SELECT * FROM dataset" },
      "org-1",
      "ws-1",
    );
    expect(result.ok).toBe(false);
  });

  it("runs a validated read-only query and returns sanitized rows", async () => {
    mocks.queryRawUnsafe.mockResolvedValueOnce([
      { total: "482100.5", order_date: "2026-01-01" },
    ]);
    const result = await runReadonlySql(
      { datasetId: "ds-1", statement: "SELECT total FROM dataset WHERE total > 100000" },
      "org-1",
      "ws-1",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rowCount).toBe(1);
      expect(result.content).toHaveProperty("rows");
    }
    expect(mocks.queryRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it("normalizes BigInt aggregate values so JSON serialization cannot fail", async () => {
    mocks.queryRawUnsafe.mockResolvedValueOnce([
      { total: 482100.5, n: 42n },
    ]);
    const result = await runReadonlySql(
      { datasetId: "ds-1", statement: "SELECT total, COUNT(*) AS n FROM dataset" },
      "org-1",
      "ws-1",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(JSON.stringify(result.content)).toContain('"n":42');
    }
  });

  it("scopes the projection to the dataset owner", async () => {
    mocks.findFirst.mockResolvedValueOnce(null);
    const result = await runReadonlySql(
      { datasetId: "ds-1", statement: "SELECT total FROM dataset" },
      "org-other",
      "ws-other",
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not in this workspace/i);
  });
});

describe("sql-tool projection builder", () => {
  it("builds a wide read-only projection with $1/$2 scope and per-column value tables", () => {
    const sql = buildWideProjection("v1", FACTORY_COLUMNS);
    expect(sql).toContain('"datasetId" = $1::uuid');
    expect(sql).toContain('"datasetVersionId" = $2::uuid');
    expect(sql).toContain('"DatasetNumericValue"');
    expect(sql).toContain('"DatasetDatetimeValue"');
    expect(sql).toContain("$3::uuid");
    expect(sql).toContain('SELECT scoped."__idx",');
    expect(sql).not.toMatch(/SELECT r\."__idx"/);
  });

  it("aliases every join instance so repeated same-type columns do not collide (42712)", () => {
    const twoTextColumns = [
      { ...FACTORY_COLUMNS[0], id: "col-a", name: "product" as const, type: "TEXT" as const },
      { ...FACTORY_COLUMNS[0], id: "col-b", name: "category" as const, type: "TEXT" as const },
      { ...FACTORY_COLUMNS[0], id: "col-c", name: "total" as const, type: "DECIMAL" as const },
    ] as unknown as DatasetColumn[];

    const sql = buildWideProjection("v1", twoTextColumns);

    const textJoins = sql.match(/LEFT JOIN "DatasetTextValue"/g) ?? [];
    expect(textJoins).toHaveLength(2);
    expect(sql.match(/AS t3 ON/g)).toHaveLength(1);
    expect(sql.match(/AS t4 ON/g)).toHaveLength(1);
    expect(sql.match(/AS t5 ON/g)).toHaveLength(1);
    expect(sql.match(/AS t\d+ ON/g)).toHaveLength(3);
    expect(sql).not.toMatch(/LEFT JOIN "DatasetTextValue" ON/g);
  });

  it("aliases columns by their original database names, not semantic keys", () => {
    const sql = buildWideProjection("v1", FACTORY_COLUMNS);
    expect(sql).toContain('AS "total"');
    expect(sql).toContain('AS "order_date"');
    expect(sql).not.toContain('AS "revenue"');
  });

  it("keeps columns with the same semantic key as distinct aliases", () => {
    const twoOrderDateColumns = [
      { ...FACTORY_COLUMNS[1], id: "col-created", name: "created_at" as const },
      { ...FACTORY_COLUMNS[1], id: "col-updated", name: "updated_at" as const },
    ] as unknown as DatasetColumn[];

    const sql = buildWideProjection("v1", twoOrderDateColumns);
    expect(sql).toContain('AS "created_at"');
    expect(sql).toContain('AS "updated_at"');
  });
});