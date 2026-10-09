import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/lib/tokens.js';
import { ACCESS_COOKIE } from '../../src/lib/cookies.js';
import { grantPlan } from '../helpers/db.js';
import { claimById } from '../../src/jobs/queue.js';
import { runHandler } from '../../src/workers/registry.js';

const app = createApp();
const prisma = new PrismaClient();

/**
 * POST /generate now returns `202 Accepted` and a job id (contract
 * reports.md:58), so the render itself happens in the worker. These tests
 * drive the job the same way the worker does — claim it, run the handler —
 * and then read the report back, which keeps them asserting on the real
 * rendering path rather than on the transport.
 */
/** The shape of a generated report's `content` Json column. */
type ReportContent = {
  metrics?: Array<{ metricKind: string; value: number | null; available: boolean }>;
  breakdowns?: Array<{ columnId: string; available: boolean; rows: Array<{ group: string; value: number }> }>;
  investigation?: {
    question: string;
    findings: Array<{ title: string; confidence: number | null }>;
  };
};

async function generateReport(reportId: string, cookie: string) {
  const response = await request(app)
    .post(`/api/v1/ai/reports/${reportId}/generate`)
    .set('Cookie', cookie)
    .send({});

  expect(response.status).toBe(202);
  const jobId = response.body.data.jobId as string;
  expect(jobId).toBeTruthy();

  const claimed = await claimById(jobId);
  expect(claimed).not.toBeNull();
  await runHandler(claimed!);

  const report = await prisma.report.findUniqueOrThrow({ where: { id: reportId } });
  return { ...report, content: report.content as unknown as ReportContent };
}

/**
 * D1: report content must come from the dataset, not from hardcoded numbers.
 * These fixtures build a real version + columns + rows so `computeMetric` runs
 * actual SQL.
 */
describe('Report rendering uses real data (D1)', () => {
  let orgId: string;
  let workspaceId: string;
  let cookie: string;
  let datasetId: string;
  let revenueColumnId: string;
  let regionColumnId: string;
  let dateColumnId: string;

  beforeEach(async () => {
    const org = await prisma.organization.create({
      data: { name: 'Render Org', slug: `rnd-${randomUUID()}` },
    });
    orgId = org.id;
    const ws = await prisma.workspace.create({
      data: { name: 'Render WS', organizationId: orgId, slug: `rws-${randomUUID()}` },
    });
    workspaceId = ws.id;
    const user = await prisma.user.create({
      data: {
        email: `r-${randomUUID()}@example.com`,
        name: 'Renderer',
        passwordHash: 'hashed',
        organizationId: orgId,
      },
    });
    const token = await signAccessToken({
      sub: user.id,
      email: user.email,
      org: orgId,
      ws: workspaceId,
    });
    cookie = `${ACCESS_COOKIE}=${token}`;

    // `free` has `reports: false` and report creation is now correctly gated,
    // so this suite must run on a plan that includes reports.
    await grantPlan(orgId, 'pro');

    const source = await prisma.dataSource.create({
      data: { organizationId: orgId, workspaceId, name: 'Source', kind: 'FILE' },
    });
    const dataset = await prisma.dataset.create({
      data: {
        organizationId: orgId,
        workspaceId,
        dataSourceId: source.id,
        name: 'Sales',
        status: 'DRAFT',
      },
    });
    datasetId = dataset.id;

    const version = await prisma.datasetVersion.create({
      data: {
        datasetId,
        version: 1,
        commit: 'REPLACE',
        source: 'test',
        status: 'READY',
      },
    });

    const revenueColumn = await prisma.datasetColumn.create({
      data: {
        datasetId,
        datasetVersionId: version.id,
        name: 'revenue',
        type: 'DECIMAL',
        ordinalPosition: 1,
        semanticKey: 'revenue',
      },
    });
    revenueColumnId = revenueColumn.id;

    const regionColumn = await prisma.datasetColumn.create({
      data: {
        datasetId,
        datasetVersionId: version.id,
        name: 'region',
        type: 'TEXT',
        ordinalPosition: 2,
        semanticKey: 'region',
      },
    });
    regionColumnId = regionColumn.id;

    const dateColumn = await prisma.datasetColumn.create({
      data: {
        datasetId,
        datasetVersionId: version.id,
        name: 'order_date',
        type: 'DATE',
        ordinalPosition: 3,
        semanticKey: 'order_date',
      },
    });
    dateColumnId = dateColumn.id;

    // 3 rows: North 100, South 250, North 50  =>  REVENUE 400, ORDERS 3, North 150
    // The dates straddle July and August so a date range can be asserted.
    const rows = [
      { revenue: 100, region: 'North', date: '2026-07-01T00:00:00.000Z' },
      { revenue: 250, region: 'South', date: '2026-07-15T00:00:00.000Z' },
      { revenue: 50, region: 'North', date: '2026-08-01T00:00:00.000Z' },
    ];
    for (const [index, row] of rows.entries()) {
      const created = await prisma.datasetRow.create({
        data: { datasetId, datasetVersionId: version.id, rowIndex: index },
      });
      await prisma.datasetNumericValue.create({
        data: { rowId: created.id, columnId: revenueColumnId, value: row.revenue },
      });
      await prisma.datasetTextValue.create({
        data: { rowId: created.id, columnId: regionColumnId, value: row.region },
      });
      await prisma.datasetDatetimeValue.create({
        data: { rowId: created.id, columnId: dateColumnId, value: new Date(row.date) },
      });
    }

    await prisma.dataset.update({
      where: { id: datasetId },
      data: { currentVersionId: version.id, status: 'READY', rowCount: rows.length },
    });
  });

  afterEach(async () => {
    await prisma.organization.delete({ where: { id: orgId } });
  });

  async function createReport(body: Record<string, unknown>) {
    const response = await request(app)
      .post('/api/v1/ai/reports')
      .set('Cookie', cookie)
      .send({ workspaceId, kind: 'WEEKLY', ...body });
    expect(response.status).toBe(200);
    return response.body.data.report as { id: string };
  }

  it('computes the selected metrics from the dataset', async () => {
    const report = await createReport({
      title: 'Real revenue',
      metricKeys: ['REVENUE', 'ORDERS'],
      datasetId,
    });

    const generated = await generateReport(report.id, cookie);
    expect(generated.status).toBe('GENERATED');

    const content = generated.content;
    const metrics = content.metrics as Array<{
      metricKind: string;
      value: number | null;
      available: boolean;
    }>;

    const revenue = metrics.find((m) => m.metricKind === 'REVENUE');
    const orders = metrics.find((m) => m.metricKind === 'ORDERS');

    expect(revenue?.available).toBe(true);
    expect(revenue?.value).toBe(400);
    // The fixture has no `orders` column, so ORDERS is reported as unavailable
    // rather than silently counted.
    expect(orders?.available).toBe(false);
    expect(orders?.value).toBeNull();

    // The old placeholder block must be gone for good.
    expect(JSON.stringify(content)).not.toContain('125000');
  });

  it('marks a metric the dataset cannot supply as unavailable instead of inventing it', async () => {
    const report = await createReport({
      title: 'Profit without a profit column',
      metricKeys: ['REVENUE', 'PROFIT'],
      datasetId,
    });

    const generated = await generateReport(report.id, cookie);
    const metrics = generated.content.metrics as Array<{
      metricKind: string;
      available: boolean;
      value: number | null;
    }>;
    const profit = metrics.find((m) => m.metricKind === 'PROFIT');
    expect(profit?.available).toBe(false);
    expect(profit?.value).toBeNull();
  });

  it('applies the date and dimension filters the user chose', async () => {
    const report = await createReport({
      title: 'Filtered revenue',
      metricKeys: ['REVENUE'],
      datasetId,
      filters: { dimensions: { region: 'North' } },
    });

    const generated = await generateReport(report.id, cookie);
    const metrics = generated.content.metrics as Array<{
      metricKind: string;
      value: number | null;
    }>;
    // North only: 100 + 50.
    expect(metrics.find((m) => m.metricKind === 'REVENUE')?.value).toBe(150);
  });

  it('applies the chosen date range without an explicit date column', async () => {
    // The report form only ever sends dateFrom/dateTo. The range used to be
    // dropped, so every report stated the all-time total regardless of the
    // dates the user picked.
    const revenueFor = async (filters: Record<string, unknown>) => {
      const report = await createReport({
        title: 'Revenue in range',
        metricKeys: ['REVENUE'],
        datasetId,
        filters,
      });
      const generated = await generateReport(report.id, cookie);
      expect(generated.status).toBe('GENERATED');
      const metrics = generated.content.metrics as Array<{
        metricKind: string;
        value: number | null;
      }>;
      return metrics.find((m) => m.metricKind === 'REVENUE')?.value;
    };

    // July rows: 100 + 250.
    expect(
      await revenueFor({
        dateFrom: '2026-07-01T00:00:00.000Z',
        dateTo: '2026-07-31T23:59:59.999Z',
      }),
    ).toBe(350);

    // August row only: 50.
    expect(
      await revenueFor({
        dateFrom: '2026-08-01T00:00:00.000Z',
        dateTo: '2026-08-31T23:59:59.999Z',
      }),
    ).toBe(50);

    // A window that contains no rows.
    expect(
      await revenueFor({
        dateFrom: '2030-01-01T00:00:00.000Z',
        dateTo: '2030-01-31T23:59:59.999Z',
      }),
    ).toBe(0);
  });

  it('includes the whole final day of a range', async () => {
    const report = await createReport({
      title: 'Single day',
      metricKeys: ['REVENUE'],
      datasetId,
      // Exactly the stored instant of the 1 July row.
      filters: {
        dateFrom: '2026-07-01T00:00:00.000Z',
        dateTo: '2026-07-01T00:00:00.000Z',
      },
    });

    const generated = await generateReport(report.id, cookie);
    const metrics = generated.content.metrics as Array<{
      metricKind: string;
      value: number | null;
    }>;
    expect(metrics.find((m) => m.metricKind === 'REVENUE')?.value).toBe(100);
  });

  it('fails a report whose saved date column no longer exists', async () => {
    const report = await createReport({
      title: 'Stale date column',
      metricKeys: ['REVENUE'],
      datasetId,
      filters: {
        dateColumnId: '00000000-0000-0000-0000-000000000000',
        dateFrom: '2026-07-01T00:00:00.000Z',
        dateTo: '2026-07-31T23:59:59.999Z',
      },
    });

    const generated = await generateReport(report.id, cookie);
    expect(generated.status).toBe('FAILED');
    expect(generated.error).toBeTruthy();
  });

  it('renders a breakdown table for the chosen dimension', async () => {
    const report = await createReport({
      title: 'Revenue by region',
      metricKeys: ['REVENUE'],
      datasetId,
      breakdowns: [regionColumnId],
    });

    const generated = await generateReport(report.id, cookie);
    const breakdowns = generated.content.breakdowns as Array<{
      columnId: string;
      available: boolean;
      rows: Array<{ group: string; value: number }>;
    }>;
    expect(breakdowns).toHaveLength(1);
    expect(breakdowns[0]!.columnId).toBe(regionColumnId);
    expect(breakdowns[0]!.available).toBe(true);
    const north = breakdowns[0]!.rows.find((r) => r.group === 'North');
    expect(north?.value).toBe(150);
  });

  it('stores a real PDF and serves it back', async () => {
    const report = await createReport({
      title: 'PDF with real numbers',
      metricKeys: ['REVENUE'],
      datasetId,
    });

    // Generation is asynchronous (202 + a queued job), so the job has to be
    // claimed and run before the PDF exists. Requesting it without doing that
    // races the worker and 404s on `This report has no generated PDF yet`.
    await generateReport(report.id, cookie);

    const download = await request(app)
      .get(`/api/v1/ai/reports/${report.id}/pdf`)
      .set('Cookie', cookie)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(download.status).toBe(200);
    const bytes = download.body as Buffer;
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.subarray(-6).toString()).toContain('%%EOF');
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it('rejects a report whose saved filter no longer matches a column', async () => {
    const report = await createReport({
      title: 'Stale filter',
      metricKeys: ['REVENUE'],
      datasetId,
      filters: { dimensions: { dropped_column: 'North' } },
    });

    // It must fail loudly rather than report the unfiltered total as if the
    // filter had been applied. The endpoint accepts the request; the failure
    // surfaces on the report once the job has run.
    const generated = await generateReport(report.id, cookie);
    expect(generated.status).toBe('FAILED');
    expect(generated.error).toBeTruthy();
  });

  it('fails the report instead of generating when the dataset is not analysable', async () => {
    await prisma.dataset.update({ where: { id: datasetId }, data: { status: 'DRAFT' } });

    const report = await createReport({
      title: 'Not ready',
      metricKeys: ['REVENUE'],
      datasetId,
    });

    const generated = await generateReport(report.id, cookie);
    expect(generated.status).toBe('FAILED');
    expect(generated.error).toBeTruthy();
  });

  it('summarises an investigation from its real findings', async () => {
    const user = await prisma.user.findFirstOrThrow({ where: { organizationId: orgId } });
    const investigation = await prisma.investigation.create({
      data: {
        organizationId: orgId,
        workspaceId,
        datasetId,
        title: 'Revenue drop',
        question: 'Why did revenue fall?',
        topic: 'revenue',
        status: 'COMPLETED',
        createdById: user.id,
      },
    });
    await prisma.investigationFinding.create({
      data: {
        investigationId: investigation.id,
        level: 'MAIN',
        kind: 'ANOMALY',
        title: 'South region declined',
        summary: 'South revenue fell 40% against the baseline.',
        evidence: { metric: 'REVENUE' },
        confidence: 0.82,
      },
    });

    const report = await createReport({
      title: 'Investigation summary',
      reportType: 'INVESTIGATION',
      investigationId: investigation.id,
    });

    const generated = await generateReport(report.id, cookie);
    const content = generated.content;
    const summary = content.investigation!;
    expect(summary.question).toBe('Why did revenue fall?');
    expect(summary.findings).toHaveLength(1);
    expect(summary.findings[0]!.title).toBe('South region declined');
    expect(summary.findings[0]!.confidence).toBeCloseTo(0.82);
    // An investigation report has no computed metrics.
    expect(content.metrics).toBeUndefined();
  });

  it('will not summarise another organization investigation', async () => {
    const otherOrg = await prisma.organization.create({
      data: { name: 'Other Org', slug: `oth-${randomUUID()}` },
    });
    const otherWs = await prisma.workspace.create({
      data: { name: 'Other WS', organizationId: otherOrg.id, slug: `ows-${randomUUID()}` },
    });
    const otherUser = await prisma.user.create({
      data: {
        email: `o-${randomUUID()}@example.com`,
        name: 'Other',
        passwordHash: 'hashed',
        organizationId: otherOrg.id,
      },
    });
    const otherInvestigation = await prisma.investigation.create({
      data: {
        organizationId: otherOrg.id,
        workspaceId: otherWs.id,
        title: 'Secret',
        question: 'Confidential?',
        topic: 'revenue',
        createdById: otherUser.id,
      },
    });

    const report = await createReport({
      title: 'Stolen investigation',
      reportType: 'INVESTIGATION',
      investigationId: otherInvestigation.id,
    });

    const generated = await generateReport(report.id, cookie);
    expect(generated.status).toBe('FAILED');
    expect(generated.error).toBeTruthy();
  });
});
