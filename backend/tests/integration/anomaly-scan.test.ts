import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { env } from "../../src/config/env.js";
import { scan } from "../../src/modules/anomalies/anomaly.service.js";
import { ACCESS_COOKIE } from "../../src/lib/cookies.js";
import { signAccessToken } from "../../src/lib/tokens.js";
import {
  createDatasetFixture,
  destroyOrganization,
  daysAgo,
  uniqueSlug,
} from "../helpers/dataset-fixture.js";

const db = prisma as unknown as PrismaClient;
const app = createApp();
const createdOrganizations: string[] = [];

// These tests assert against the code default threshold (30). A developer .env
// may raise it to an effectively-disabling value (e.g. 3000), which would
// silently turn every "expects an anomaly" test into a failure.
const configuredThreshold = env.ANOMALY_DEVIATION_THRESHOLD;

beforeAll(() => {
  (env as { ANOMALY_DEVIATION_THRESHOLD: number }).ANOMALY_DEVIATION_THRESHOLD = 30;
});

afterEach(async () => {
  for (const organizationId of createdOrganizations.splice(0)) {
    await destroyOrganization(db, organizationId);
  }
});

afterAll(async () => {
  (env as { ANOMALY_DEVIATION_THRESHOLD: number }).ANOMALY_DEVIATION_THRESHOLD =
    configuredThreshold;
  await prisma.$disconnect();
});

async function createScope(label: string): Promise<{
  organizationId: string;
  workspaceId: string;
}> {
  const organization = await prisma.organization.create({
    data: { name: label, slug: uniqueSlug("anom") },
  });
  const workspace = await prisma.workspace.create({
    data: {
      organizationId: organization.id,
      name: "Default",
      slug: uniqueSlug("ws"),
      isDefault: true,
    },
  });
  createdOrganizations.push(organization.id);
  return { organizationId: organization.id, workspaceId: workspace.id };
}

/** Builds a dataset whose revenue collapses hard enough to always be flagged. */
async function createCollapsingDataset(
  scope: { organizationId: string; workspaceId: string },
): Promise<void> {
  await createDatasetFixture(db, scope.organizationId, scope.workspaceId, {
    name: "Collapse",
    withDateColumn: true,
    rows: [
      { revenue: 1000, region: "North", at: daysAgo(45) },
      { revenue: 1000, region: "North", at: daysAgo(40) },
      { revenue: 1, region: "North", at: daysAgo(5) },
      { revenue: 1, region: "North", at: daysAgo(2) },
    ],
  });
}

function skipReasons(result: { skips: { reason: string }[] }): Record<string, number> {
  return result.skips.reduce<Record<string, number>>((counts, skip) => {
    counts[skip.reason] = (counts[skip.reason] ?? 0) + 1;
    return counts;
  }, {});
}

/** `observed`/`baseline` are stored as Json, so narrow before asserting on them. */
  function periodValue(payload: unknown): number | null {
    if (typeof payload !== 'object' || payload === null) return null;
    const { value } = payload as { value?: unknown };
    return typeof value === 'number' ? value : null;
  }

  /**
   * B11.3: `baseline` is now `{ mean, spreadPct, periodCount, periods }` rather
   * than a single `{ period, value }`, so the mean the deviation was measured
   * against is read explicitly.
   */
  function baselineSummary(payload: unknown): {
    mean: number | null;
    spreadPct: number | null;
    periodCount: number | null;
    periodValues: Array<number | null>;
  } {
    if (typeof payload !== 'object' || payload === null) {
      return { mean: null, spreadPct: null, periodCount: null, periodValues: [] };
    }
    const record = payload as {
      mean?: unknown;
      spreadPct?: unknown;
      periodCount?: unknown;
      periods?: Array<{ value?: unknown }>;
    };
    return {
      mean: typeof record.mean === 'number' ? record.mean : null,
      spreadPct: typeof record.spreadPct === 'number' ? record.spreadPct : null,
      periodCount: typeof record.periodCount === 'number' ? record.periodCount : null,
      periodValues: (record.periods ?? []).map((entry) =>
        typeof entry.value === 'number' ? entry.value : null,
      ),
    };
  }

describe("anomaly scan", () => {
  it("flags a revenue collapse using windows derived from the data", async () => {
    const scope = await createScope("Collapse");
    await createCollapsingDataset(scope);

    const result = await scan(scope);

    const revenue = result.anomalies.find((anomaly) => anomaly.metricId === "REVENUE");
    expect(revenue).toBeDefined();
    expect(revenue!.kind).toBe("DROP");
    expect(revenue!.deviationPct).toBeGreaterThan(30);
    expect(periodValue(revenue!.observed)).toBe(2);
    // This fixture spans 43 days, so only one 30-day baseline period exists;
    // the mean over that single period is its value.
    expect(baselineSummary(revenue!.baseline)).toMatchObject({
      mean: 2000,
      periodCount: 1,
      periodValues: [2000],
    });
  });

  /**
   * B11.3: the baseline is the mean of `ANOMALY_BASELINE_PERIODS` trailing
   * periods, not just the one immediately before the current window.
   */
  it("measures the deviation against the mean of several trailing periods", async () => {
    const scope = await createScope("Trailing baseline");
    // Four 30-day periods plus the current one. Revenue is flat at 1000 for the
    // first four periods, then collapses in the current period. Comparing only
    // against the immediately preceding period and against the four-period mean
    // both give 1000 here, so the assertion that matters is the period count.
    const rows = [];
    for (const daysAgoValue of [150, 120, 90, 60]) {
      rows.push({ revenue: 1000, region: "North", at: daysAgo(daysAgoValue) });
    }
    rows.push({ revenue: 100, region: "North", at: daysAgo(5) });
    rows.push({ revenue: 100, region: "North", at: daysAgo(2) });
    await createDatasetFixture(db, scope.organizationId, scope.workspaceId, {
      name: "Trailing",
      withDateColumn: true,
      rows,
    });

    const result = await scan(scope);
    const revenue = result.anomalies.find((anomaly) => anomaly.metricId === "REVENUE");

    expect(revenue).toBeDefined();
    const summary = baselineSummary(revenue!.baseline);
    // Four full baseline periods are available, so the configured N is used.
    expect(summary.periodCount).toBe(4);
    expect(summary.periodValues).toHaveLength(4);
    expect(summary.mean).toBe(1000);
    expect(summary.spreadPct).toBe(0);
    // Current is 200 across the two recent rows, i.e. 80% below the mean.
    // `deviationPct` is stored as a magnitude; `kind` carries the direction.
    expect(periodValue(revenue!.observed)).toBe(200);
    expect(revenue!.kind).toBe("DROP");
    expect(revenue!.deviationPct).toBeCloseTo(80, 0);
  });

  it("records the baseline spread so a volatile baseline is visible in the evidence", async () => {
    const scope = await createScope("Spread");
    // Trailing periods alternate between 1000 and 2000, so the mean is 1500 and
    // the spread is non-zero; a single-period baseline would have hidden the
    // volatility behind whichever single value it happened to read.
    const rows = [];
    for (const [daysAgoValue, revenue] of [
      [150, 1000],
      [120, 2000],
      [90, 1000],
      [60, 2000],
    ] as const) {
      rows.push({ revenue, region: "North", at: daysAgo(daysAgoValue) });
    }
    rows.push({ revenue: 10_000, region: "North", at: daysAgo(5) });
    rows.push({ revenue: 10_000, region: "North", at: daysAgo(2) });
    await createDatasetFixture(db, scope.organizationId, scope.workspaceId, {
      name: "Spread",
      withDateColumn: true,
      rows,
    });

    const result = await scan(scope);
    const revenue = result.anomalies.find((anomaly) => anomaly.metricId === "REVENUE");
    expect(revenue).toBeDefined();

    const summary = baselineSummary(revenue!.baseline);
    expect(summary.mean).toBe(1500);
    expect(summary.spreadPct).toBeGreaterThan(0);
    // 20_000 current against a 1_500 mean is ~+1233%, not the ~+900% a
    // single-period baseline against 2_000 would have produced.
    expect(revenue!.deviationPct).toBeGreaterThan(1000);
  });

  it("does not flag a change inside the threshold", async () => {
    const scope = await createScope("Steady");
    await createDatasetFixture(db, scope.organizationId, scope.workspaceId, {
      name: "Steady",
      withDateColumn: true,
      rows: [
        { revenue: 1000, region: "North", at: daysAgo(45) },
        { revenue: 1000, region: "North", at: daysAgo(40) },
        { revenue: 1010, region: "North", at: daysAgo(5) },
        { revenue: 1010, region: "North", at: daysAgo(2) },
      ],
    });

    const result = await scan(scope);

    expect(result.anomalies).toHaveLength(0);
    expect(result.scanned).toBeGreaterThan(0);
  });

  it("skips a dataset that spans less than one period", async () => {
    const scope = await createScope("TooNew");
    await createDatasetFixture(db, scope.organizationId, scope.workspaceId, {
      name: "TooNew",
      withDateColumn: true,
      rows: [
        { revenue: 500, region: "North", at: daysAgo(3) },
        { revenue: 400, region: "North", at: daysAgo(1) },
      ],
    });

    const result = await scan(scope);

    expect(result.anomalies).toHaveLength(0);
    expect(result.scanned).toBe(0);
    expect(skipReasons(result)).toEqual({ NO_BASELINE_DATA: 6 });
  });

  it("skips every metric when the dataset has no date column", async () => {
    const scope = await createScope("NoDate");
    await createDatasetFixture(db, scope.organizationId, scope.workspaceId, {
      name: "NoDate",
      withDateColumn: false,
      rows: [
        { revenue: 1000, region: "North", at: daysAgo(45) },
        { revenue: 1, region: "North", at: daysAgo(2) },
      ],
    });

    const result = await scan(scope);

    expect(result.anomalies).toHaveLength(0);
    expect(skipReasons(result)).toEqual({ NO_DATE_COLUMN: 6 });
  });

  it("reports an unmapped metric rather than inventing a zero", async () => {
    const scope = await createScope("NoMetric");
    await createDatasetFixture(db, scope.organizationId, scope.workspaceId, {
      name: "NoMetric",
      withDateColumn: true,
      rows: [
        { revenue: 1000, region: "North", at: daysAgo(45) },
        { revenue: 1000, region: "North", at: daysAgo(40) },
        { revenue: 1, region: "North", at: daysAgo(5) },
        { revenue: 1, region: "North", at: daysAgo(2) },
      ],
    });

    const result = await scan(scope);

    // Only revenue exists in the fixture, so the other five canonical metrics
    // must be skipped rather than reported as collapsing to zero.
    expect(result.anomalies.map((anomaly) => anomaly.metricId)).toEqual(["REVENUE"]);
    expect(skipReasons(result)).toEqual({ NO_VALUE_COLUMN: 5 });
  });

  it("never writes anomalies for another organization", async () => {
    const owner = await createScope("Owner");
    const intruder = await createScope("Intruder");
    const fixture = await createDatasetFixture(db, owner.organizationId, owner.workspaceId, {
      name: "OwnerData",
      withDateColumn: true,
      rows: [
        { revenue: 1000, region: "North", at: daysAgo(45) },
        { revenue: 1000, region: "North", at: daysAgo(40) },
        { revenue: 1, region: "North", at: daysAgo(5) },
        { revenue: 1, region: "North", at: daysAgo(2) },
      ],
    });

    await scan(owner);
    const leaked = await scan(intruder);

    expect(leaked.anomalies).toHaveLength(0);
    const rows = await prisma.anomalyDetection.findMany({
      where: { datasetId: fixture.datasetId },
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.organizationId === owner.organizationId)).toBe(true);
  });

  it("returns deviationPct as a number, not a serialized Decimal string", async () => {
    const scope = await createScope("Contract");
    await createCollapsingDataset(scope);
    await scan(scope);

    const user = await prisma.user.create({
      data: {
        email: uniqueSlug("contract") + "@example.com",
        name: "Contract User",
        passwordHash: "hashed",
        organizationId: scope.organizationId,
      },
    });
    const token = await signAccessToken({
      sub: user.id,
      email: user.email,
      org: scope.organizationId,
      ws: scope.workspaceId,
    });

    const list = await request(app)
      .get("/api/v1/ai/anomalies")
      .set("Cookie", `${ACCESS_COOKIE}=${token}`);

    expect(list.status).toBe(200);
    const items = list.body.data.anomalies as { id: string; deviationPct: unknown }[];
    expect(items.length).toBeGreaterThan(0);
    // Prisma Decimal stringifies to "99.9"; the frontend type says number.
    expect(typeof items[0]!.deviationPct).toBe("number");

    const detail = await request(app)
      .get(`/api/v1/ai/anomalies/${items[0]!.id}`)
      .set("Cookie", `${ACCESS_COOKIE}=${token}`);
    expect(detail.status).toBe(200);
    expect(typeof (detail.body.data as { deviationPct: unknown }).deviationPct).toBe("number");
  });

  it("respects a low threshold from configuration", async () => {
    const scope = await createScope("Threshold");
    await createDatasetFixture(db, scope.organizationId, scope.workspaceId, {
      name: "Threshold",
      withDateColumn: true,
      rows: [
        { revenue: 1000, region: "North", at: daysAgo(45) },
        { revenue: 1000, region: "North", at: daysAgo(40) },
        { revenue: 950, region: "North", at: daysAgo(5) },
        { revenue: 950, region: "North", at: daysAgo(2) },
      ],
    });

    const high = await scan(scope);
    expect(high.anomalies).toHaveLength(0);

    const { env } = await import("../../src/config/env.js");
    const original = env.ANOMALY_DEVIATION_THRESHOLD;
    (env as { ANOMALY_DEVIATION_THRESHOLD: number }).ANOMALY_DEVIATION_THRESHOLD = 1;
    try {
      const low = await scan(scope);
      expect(low.anomalies.map((anomaly) => anomaly.metricId)).toEqual(["REVENUE"]);
      expect(low.anomalies[0]?.kind).toBe("DROP");
    } finally {
      (env as { ANOMALY_DEVIATION_THRESHOLD: number }).ANOMALY_DEVIATION_THRESHOLD = original;
    }
  });
});
