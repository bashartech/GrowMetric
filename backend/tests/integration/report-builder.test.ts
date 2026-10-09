import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/lib/tokens.js';
import { ACCESS_COOKIE } from '../../src/lib/cookies.js';
import { grantPlan } from '../helpers/db.js';

const app = createApp();
const prisma = new PrismaClient();

describe('Report builder contract (D2/D4/D5)', () => {
  let orgId: string;
  let workspaceId: string;
  let cookie: string;
  let datasetId: string;

  beforeEach(async () => {
    const org = await prisma.organization.create({
      data: { name: 'Builder Org', slug: `bld-${randomUUID()}` },
    });
    orgId = org.id;
    const ws = await prisma.workspace.create({
      data: { name: 'Builder WS', organizationId: orgId, slug: `bws-${randomUUID()}` },
    });
    workspaceId = ws.id;
    const user = await prisma.user.create({
      data: {
        email: `b-${randomUUID()}@example.com`,
        name: 'Builder',
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

    // `free` has `reports: false`, and report creation is now correctly gated,
    // so this suite has to run on a plan that includes reports.
    await grantPlan(orgId, 'pro');

    const source = await prisma.dataSource.create({
      data: {
        organizationId: orgId,
        workspaceId,
        name: 'Source',
        kind: 'FILE',
      },
    });
    const dataset = await prisma.dataset.create({
      data: {
        organizationId: orgId,
        workspaceId,
        dataSourceId: source.id,
        name: 'Sales',
        status: 'READY',
      },
    });
    datasetId = dataset.id;
  });

  afterEach(async () => {
    await prisma.organization.delete({ where: { id: orgId } });
  });

  it('persists the selected metrics, filters and breakdowns', async () => {
    const response = await request(app)
      .post('/api/v1/ai/reports')
      .set('Cookie', cookie)
      .send({
        workspaceId,
        kind: 'MONTHLY',
        title: 'Revenue and orders',
        metricKeys: ['REVENUE', 'ORDERS'],
        datasetId,
        filters: { dateFrom: '2026-07-01T00:00:00.000Z', dateTo: '2026-07-31T00:00:00.000Z' },
        breakdowns: ['region'],
      });

    expect(response.status).toBe(200);
    const report = response.body.data.report;
    // D2: metricKeys is stored as structured JSON, not a string.
    expect(report.metricKeys).toEqual(['REVENUE', 'ORDERS']);
    expect(report.filters.dateFrom).toBe('2026-07-01T00:00:00.000Z');
    expect(report.breakdowns).toEqual(['region']);
    expect(report.datasetId).toBe(datasetId);
    expect(report.reportType).toBe('METRICS');

    // Read back through the DB to prove it is not double-encoded.
    const stored = await prisma.report.findUniqueOrThrow({ where: { id: report.id } });
    expect(stored.metricKeys).toEqual(['REVENUE', 'ORDERS']);
  });

  it('rejects a metrics report with no dataset or no metrics', async () => {
    const noDataset = await request(app)
      .post('/api/v1/ai/reports')
      .set('Cookie', cookie)
      .send({ workspaceId, kind: 'WEEKLY', title: 'No dataset', metricKeys: ['REVENUE'] });
    expect(noDataset.status).toBe(400);
    expect(JSON.stringify(noDataset.body.error.details)).toContain('datasetId');

    const noMetrics = await request(app)
      .post('/api/v1/ai/reports')
      .set('Cookie', cookie)
      .send({ workspaceId, kind: 'WEEKLY', title: 'No metrics', datasetId, metricKeys: [] });
    expect(noMetrics.status).toBe(400);
  });

  it('rejects an unknown metric key', async () => {
    const response = await request(app)
      .post('/api/v1/ai/reports')
      .set('Cookie', cookie)
      .send({ workspaceId, kind: 'WEEKLY', title: 'Bad metric', datasetId, metricKeys: ['NOT_A_METRIC'] });

    expect(response.status).toBe(400);
  });

  it('requires an investigationId for an investigation report', async () => {
    const response = await request(app)
      .post('/api/v1/ai/reports')
      .set('Cookie', cookie)
      .send({ workspaceId, kind: 'CUSTOM', title: 'Investigation', reportType: 'INVESTIGATION' });

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body.error.details)).toContain('investigationId');
  });

  it('serves the canonical metric catalog for the builder', async () => {
    const response = await request(app)
      .get('/api/v1/analytics/metric-catalog')
      .set('Cookie', cookie);

    expect(response.status).toBe(200);
    const kinds = response.body.data.metrics.map((m: { kind: string }) => m.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(['REVENUE', 'ORDERS', 'CUSTOMERS', 'EXPENSES', 'PROFIT', 'INVENTORY']),
    );
  });

  it('D4: accepts cron when creating a schedule', async () => {
    const report = await prisma.report.create({
      data: { organizationId: orgId, workspaceId, kind: 'WEEKLY', title: 'Sched' },
    });

    const response = await request(app)
      .post('/api/v1/ai/report-schedules')
      .set('Cookie', cookie)
      .send({
        reportId: report.id,
        workspaceId,
        frequency: 'CUSTOM',
        cron: '0 8 * * 1',
        recipients: ['ops@example.com'],
      });

    expect(response.status).toBe(200);
    expect(response.body.data.schedule.cron).toBe('0 8 * * 1');
  });

  it('D5: patches a schedule without resending reportId/workspaceId', async () => {
    const report = await prisma.report.create({
      data: { organizationId: orgId, workspaceId, kind: 'WEEKLY', title: 'Sched2' },
    });
    const schedule = await prisma.reportSchedule.create({
      data: {
        organizationId: orgId,
        workspaceId,
        reportId: report.id,
        frequency: 'WEEKLY',
        recipients: ['ops@example.com'],
        nextRunAt: new Date(Date.now() + 86_400_000),
      },
    });

    const response = await request(app)
      .patch(`/api/v1/ai/report-schedules/${schedule.id}`)
      .set('Cookie', cookie)
      .send({ enabled: false });

    expect(response.status).toBe(200);
    expect(response.body.data.schedule.enabled).toBe(false);
    // The cadence is untouched by a partial update.
    expect(response.body.data.schedule.frequency).toBe('WEEKLY');
  });
});
