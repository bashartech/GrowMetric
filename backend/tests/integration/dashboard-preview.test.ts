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
  csvBuffer?: Buffer,
): Promise<{ datasetId: string; dashboardId: string; dateColumnId: string }> {
  const csv = csvBuffer ?? (await readFile(join(__dirname, "../fixtures/clean.csv")));

  const res = await request(app)
    .post("/api/v1/data-sources")
    .set("Cookie", authCookie)
    .field("name", "Sales Data")
    .attach("file", csv, "data.csv");

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

  const dashboardsRes = await request(app)
    .get("/api/v1/dashboards")
    .set("Cookie", authCookie);

  const dashboardId = dashboardsRes.body.data.dashboards[0]!.id;
  const dateColumn =
    dataset!.columns.find((c) => c.semanticKey === "order_date") ??
    dataset!.columns.find((c) => c.type === "DATE" || c.type === "TIMESTAMP");
  const dateColumnId = dateColumn?.id ?? "";

  return { datasetId: processed!.datasetId!, dashboardId, dateColumnId };
}

describe("POST /api/v1/dashboards/:id/preview", () => {
  let authCookie: string;
  let dashboardId: string;
  let dateColumnId: string;

  beforeEach(async () => {
    const { email, response } = await registerUser(app);
    createdEmails.push(email);
    authCookie = response.headers["set-cookie"]?.[0] ?? "";

    const { dashboardId: dId, dateColumnId: dcId } = await uploadAndProcess(authCookie);
    dashboardId = dId;
    dateColumnId = dcId;
  });

  it("returns widget data with available: true for configured widgets", async () => {
    const res = await request(app)
      .post(`/api/v1/dashboards/${dashboardId}/preview`)
      .set("Cookie", authCookie)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(dashboardId);
    expect(Array.isArray(res.body.data.widgets)).toBe(true);
    expect(res.body.data.widgets.length).toBeGreaterThan(0);

    const kpiWidgets = res.body.data.widgets.filter((w: any) => w.type === "KPI");
    expect(kpiWidgets.length).toBeGreaterThan(0);

    for (const widget of kpiWidgets) {
      expect(widget).toHaveProperty("id");
      expect(widget).toHaveProperty("type");
      expect(widget).toHaveProperty("title");
      expect(widget).toHaveProperty("data");
      expect(widget.data).toHaveProperty("available");
    }
  });

  it("applies date filters and reports zero data for out-of-range", async () => {
    const res = await request(app)
      .post(`/api/v1/dashboards/${dashboardId}/preview`)
      .set("Cookie", authCookie)
      .send({
        filters: {
          dateColumnId,
          dateFrom: "2030-01-01T00:00:00.000Z",
          dateTo: "2030-01-31T23:59:59.000Z",
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    for (const widget of res.body.data.widgets as Array<{
      type: string;
      data: {
        available: boolean;
        value?: number | null;
        rows?: Array<{ group: string; value: number }>;
      };
    }>) {
      expect(widget.data.available).toBe(true);
      if (widget.type === "KPI") {
        expect(widget.data.value).toBe(0);
      } else {
        expect(widget.data.rows ?? []).toHaveLength(0);
      }
    }
  });

  it("applies a date range that omits the date column", async () => {
    // The dashboard UI only ever sends dateFrom/dateTo. Previously the range was
    // dropped because the SQL builder needed a dateColumnId to emit its
    // predicate, so every preset returned the same all-time total.
    const outOfRange = await request(app)
      .post(`/api/v1/dashboards/${dashboardId}/preview`)
      .set("Cookie", authCookie)
      .send({
        filters: {
          dateFrom: "2030-01-01T00:00:00.000Z",
          dateTo: "2030-01-31T23:59:59.999Z",
        },
      });

    expect(outOfRange.status).toBe(200);
    for (const widget of outOfRange.body.data.widgets as Array<{
      type: string;
      data: { available: boolean; value?: number | null };
    }>) {
      expect(widget.data.available).toBe(true);
      if (widget.type === "KPI") {
        expect(widget.data.value).toBe(0);
      }
    }

    const inRange = await request(app)
      .post(`/api/v1/dashboards/${dashboardId}/preview`)
      .set("Cookie", authCookie)
      .send({
        filters: {
          dateFrom: "2026-01-01T00:00:00.000Z",
          dateTo: "2026-01-31T23:59:59.999Z",
        },
      });

    expect(inRange.status).toBe(200);
    const kpis = (inRange.body.data.widgets as Array<{
      type: string;
      data: { available: boolean; value?: number | null };
    }>).filter((widget) => widget.type === "KPI");
    expect(kpis.length).toBeGreaterThan(0);
    for (const widget of kpis) {
      expect(widget.data.available).toBe(true);
      expect(widget.data.value).toBeGreaterThan(0);
    }
  });

  it("returns different totals for different ranges without a date column", async () => {
    const totalsFor = async (dateFrom: string, dateTo: string) => {
      const res = await request(app)
        .post(`/api/v1/dashboards/${dashboardId}/preview`)
        .set("Cookie", authCookie)
        .send({ filters: { dateFrom, dateTo } });
      expect(res.status).toBe(200);
      const kpis = (res.body.data.widgets as Array<{
        type: string;
        data: { value?: number | null };
      }>).filter((widget) => widget.type === "KPI");
      return kpis.map((widget) => widget.data.value);
    };

    const firstWeek = await totalsFor(
      "2026-01-05T00:00:00.000Z",
      "2026-01-07T23:59:59.999Z",
    );
    const lastDay = await totalsFor(
      "2026-01-12T00:00:00.000Z",
      "2026-01-12T23:59:59.999Z",
    );
    const unfiltered = await totalsFor("2000-01-01T00:00:00.000Z", "2100-01-01T00:00:00.000Z");

    expect(firstWeek).not.toEqual(lastDay);
    expect(unfiltered).not.toEqual(firstWeek);
  });

  it("rejects a date column that no longer exists instead of returning all-time data", async () => {
    const res = await request(app)
      .post(`/api/v1/dashboards/${dashboardId}/preview`)
      .set("Cookie", authCookie)
      .send({
        filters: {
          dateColumnId: "00000000-0000-0000-0000-000000000000",
          dateFrom: "2026-01-01T00:00:00.000Z",
          dateTo: "2026-01-31T23:59:59.999Z",
        },
      });

    expect(res.status).toBe(200);
    for (const widget of res.body.data.widgets as Array<{
      data: { available: boolean };
    }>) {
      expect(widget.data.available).toBe(false);
    }
  });

  it("adapts widgets to available columns when exact semantics are missing", async () => {
    const res = await request(app)
      .post(`/api/v1/dashboards/${dashboardId}/preview`)
      .set("Cookie", authCookie)
      .send({});

    expect(res.status).toBe(200);
    const widgets = res.body.data.widgets as Array<{
      type: string;
      title: string;
      data: {
        available: boolean;
        value?: number | null;
        rows?: Array<{ group: string; value: number }>;
      };
    }>;

    const revenueKpi = widgets.find(
      (w) => w.type === "KPI" && w.title === "Revenue",
    );
    expect(revenueKpi?.data.available).toBe(true);
    expect(revenueKpi?.data.value).toBe(18);

    const ordersKpi = widgets.find(
      (w) => w.type === "KPI" && w.title === "Orders",
    );
    expect(ordersKpi?.data.available).toBe(true);

    const line = widgets.find((w) => w.type === "LINE");
    expect(line?.data.available).toBe(true);
    expect(line?.data.rows?.length ?? 0).toBeGreaterThan(0);

    const pie = widgets.find((w) => w.type === "PIE");
    expect(pie?.data.available).toBe(true);

    for (const widget of widgets) {
      expect(widget.data.available).toBe(true);
    }
  });

  it("applies dimension filters", async () => {
    const res = await request(app)
      .post(`/api/v1/dashboards/${dashboardId}/preview`)
      .set("Cookie", authCookie)
      .send({
        filters: {
          dateColumnId,
          dateFrom: "2024-01-01T00:00:00.000Z",
          dateTo: "2024-12-31T23:59:59.000Z",
          dimensions: { region: "West" },
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const lineWidget = res.body.data.widgets.find(
      (w: any) => w.type === "LINE",
    );
    expect(lineWidget).toBeDefined();
    if (lineWidget?.data?.available) {
      expect(lineWidget.data.rows).toBeDefined();
    }
  });

  it("returns 404 for non-existent dashboard", async () => {
    const res = await request(app)
      .post("/api/v1/dashboards/00000000-0000-0000-0000-000000000000/preview")
      .set("Cookie", authCookie)
      .send({});

    expect(res.status).toBe(404);
  });

  it("enforces tenant isolation", async () => {
    const { email: email2, response: res2 } = await registerUser(app);
    createdEmails.push(email2);
    const authCookie2 = res2.headers["set-cookie"]?.[0] ?? "";

    const res = await request(app)
      .post(`/api/v1/dashboards/${dashboardId}/preview`)
      .set("Cookie", authCookie2)
      .send({});

    expect(res.status).toBe(404);
  });

  type PreviewWidget = {
    type: string;
    title: string;
    data: {
      available: boolean;
      value?: number | null;
      unit?: string;
      previousValue?: number | null;
      change?: number | null;
      changePct?: number | null;
      changeAvailable?: boolean;
      rows?: Array<{ group: string; value: number }>;
      spark?: number[];
    };
  };

  async function preview(filters?: Record<string, unknown>): Promise<PreviewWidget[]> {
    const res = await request(app)
      .post(`/api/v1/dashboards/${dashboardId}/preview`)
      .set("Cookie", authCookie)
      .send(filters ? { filters } : {});
    expect(res.status).toBe(200);
    return res.body.data.widgets as PreviewWidget[];
  }

  it("computes period-over-period change for KPI widgets", async () => {
    // clean.csv rows: 2026-01-05 (5), 01-07 (10), 01-12 (3).
    // Window Jan 6-13 sees 01-07 + 01-12; the preceding equal window
    // (Dec 30 - Jan 6) contains only 01-05.
    const widgets = await preview({
      dateFrom: "2026-01-06T00:00:00.000Z",
      dateTo: "2026-01-13T00:00:00.000Z",
    });

    const revenue = widgets.find(
      (w) => w.type === "KPI" && w.title === "Revenue",
    );
    expect(revenue).toBeDefined();
    expect(revenue!.data.available).toBe(true);
    expect(revenue!.data.value).toBe(13);
    expect(revenue!.data.previousValue).toBe(5);
    expect(revenue!.data.changeAvailable).toBe(true);
    expect(revenue!.data.change).toBe(8);
    expect(revenue!.data.changePct).toBeCloseTo(160, 5);

    const orders = widgets.find(
      (w) => w.type === "KPI" && w.title === "Orders",
    );
    expect(orders!.data.available).toBe(true);
    expect(orders!.data.value).toBe(2);
    expect(orders!.data.previousValue).toBe(1);
    expect(orders!.data.changeAvailable).toBe(true);
    expect(orders!.data.change).toBe(1);
    expect(orders!.data.changePct).toBeCloseTo(100, 5);

    for (const widget of widgets.filter((w) => w.type === "KPI")) {
      expect(widget.data.change).toBeCloseTo(
        (widget.data.value ?? 0) - (widget.data.previousValue ?? 0),
        5,
      );
    }
  });

  it("omits period-over-period fields when no date window is selected", async () => {
    const widgets = await preview();
    const kpis = widgets.filter((w) => w.type === "KPI");
    expect(kpis.length).toBeGreaterThan(0);
    for (const kpi of kpis) {
      expect(kpi.data).not.toHaveProperty("changeAvailable");
      expect(kpi.data).not.toHaveProperty("previousValue");
    }
  });

  it("returns chronological sparkline points for KPI widgets", async () => {
    const widgets = await preview();
    const revenue = widgets.find(
      (w) => w.type === "KPI" && w.title === "Revenue",
    );
    expect(revenue?.data.spark).toEqual([5, 10, 3]);

    for (const kpi of widgets.filter((w) => w.type === "KPI")) {
      expect(Array.isArray(kpi.data.spark)).toBe(true);
      expect(kpi.data.spark!.length).toBeGreaterThan(1);
      expect(kpi.data.spark!.every((point) => Number.isFinite(point))).toBe(true);
    }
  });

  it("returns time-series rows in chronological order", async () => {
    const widgets = await preview();
    const line = widgets.find((w) => w.type === "LINE");
    expect(line?.data.available).toBe(true);

    const rows = line!.data.rows!;
    expect(rows.map((row) => row.value)).toEqual([5, 10, 3]);
    for (let i = 1; i < rows.length; i++) {
      expect(String(rows[i]!.group) > String(rows[i - 1]!.group)).toBe(true);
    }
  });

  it("returns more time-series rows than breakdown rows and caps sparklines", async () => {
    const { email, response } = await registerUser(app);
    createdEmails.push(email);
    const authCookie2 = response.headers["set-cookie"]?.[0] ?? "";

    // 20 rows: 20 distinct dates and 20 distinct categories, all in Feb 2026.
    const lines = ["date,category,quantity"];
    for (let day = 1; day <= 20; day++) {
      const dd = String(day).padStart(2, "0");
      lines.push(`2026-02-${dd},Cat-${dd},1`);
    }
    const { dashboardId: dId } = await uploadAndProcess(
      authCookie2,
      Buffer.from(`${lines.join("\n")}\n`, "utf8"),
    );

    const res = await request(app)
      .post(`/api/v1/dashboards/${dId}/preview`)
      .set("Cookie", authCookie2)
      .send({
        filters: {
          dateFrom: "2026-02-01T00:00:00.000Z",
          dateTo: "2026-02-28T23:59:59.999Z",
        },
      });
    expect(res.status).toBe(200);
    const widgets = res.body.data.widgets as PreviewWidget[];

    // LINE keeps all 20 buckets (limit 40) in chronological order.
    const line = widgets.find((w) => w.type === "LINE");
    expect(line?.data.rows).toHaveLength(20);

    // Breakdown widgets stay scannable at 15 groups (limit 15).
    const table = widgets.find((w) => w.type === "TABLE");
    expect(table?.data.rows).toHaveLength(15);

    // Sparklines show the latest 12 buckets, chronological.
    for (const kpi of widgets.filter((w) => w.type === "KPI")) {
      expect(kpi.data.spark).toHaveLength(12);
    }
  });
});