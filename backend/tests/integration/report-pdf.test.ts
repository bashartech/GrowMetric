import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { signAccessToken } from '../../src/lib/tokens.js';
import { ACCESS_COOKIE } from '../../src/lib/cookies.js';
import { grantPlan } from '../helpers/db.js';
import { storage } from '../../src/lib/storage.js';

const app = createApp();
const prisma = new PrismaClient();

const PDF_BYTES = Buffer.from('%PDF-1.4\n%fake pdf body for route testing\n%%EOF');

describe('Report PDF delivery (H2/Batch 3)', () => {
  let orgId: string;
  let workspaceId: string;
  let userId: string;
  let cookie: string;
  let reportId: string;

  async function signFor(organizationId: string, workspace: string, subject: string) {
    const token = await signAccessToken({
      sub: subject,
      email: 'owner@example.com',
      org: organizationId,
      ws: workspace,
    });
    return `${ACCESS_COOKIE}=${token}`;
  }

  beforeEach(async () => {
    const org = await prisma.organization.create({
      data: { name: 'Report Org', slug: `rep-${randomUUID()}` },
    });
    orgId = org.id;

    const workspace = await prisma.workspace.create({
      data: {
        name: 'Report WS',
        organizationId: orgId,
        slug: `rep-ws-${randomUUID()}`,
      },
    });
    workspaceId = workspace.id;

    const user = await prisma.user.create({
      data: {
        email: `owner-${randomUUID()}@example.com`,
        name: 'Owner',
        passwordHash: 'hashed',
        organizationId: orgId,
      },
    });
    userId = user.id;
    cookie = await signFor(orgId, workspaceId, userId);

    // `free` has `reports: false` and report creation is now correctly gated.
    await grantPlan(orgId, 'pro');

    // A metrics report requires a dataset and at least one metric.
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

    const created = await request(app)
      .post('/api/v1/ai/reports')
      .set('Cookie', cookie)
      .send({
        workspaceId,
        kind: 'WEEKLY',
        title: 'Revenue Weekly',
        metricKeys: ['REVENUE'],
        datasetId: dataset.id,
      });
    expect(created.status).toBe(200);
    reportId = created.body.data.report.id;
  });

  afterEach(async () => {
    await prisma.report.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  });

  it('streams the stored PDF as an attachment', async () => {
    const key = `${orgId}/reports/report-${reportId}.pdf`;
    await storage.put(key, PDF_BYTES);
    await prisma.report.update({
      where: { id: reportId },
      data: { pdfUrl: key, status: 'GENERATED' },
    });

    const response = await request(app)
      .get(`/api/v1/ai/reports/${reportId}/pdf`)
      .set('Cookie', cookie)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.headers['content-disposition']).toContain('Revenue-Weekly.pdf');
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect((response.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('serves PDFs written before the storage migration', async () => {
    // Legacy rows stored a public URL rather than a storage key.
    await prisma.report.update({
      where: { id: reportId },
      data: { pdfUrl: '/uploads/reports/legacy.pdf', status: 'GENERATED' },
    });
    await storage.put('reports/legacy.pdf', PDF_BYTES);

    const response = await request(app)
      .get(`/api/v1/ai/reports/${reportId}/pdf`)
      .set('Cookie', cookie);

    expect(response.status).toBe(200);
  });

  it('does not leak a report to another organization', async () => {
    const key = `${orgId}/reports/report-${reportId}.pdf`;
    await storage.put(key, PDF_BYTES);
    await prisma.report.update({
      where: { id: reportId },
      data: { pdfUrl: key, status: 'GENERATED' },
    });

    const otherOrg = await prisma.organization.create({
      data: { name: 'Other', slug: `other-${randomUUID()}` },
    });
    const otherWs = await prisma.workspace.create({
      data: { name: 'Other WS', organizationId: otherOrg.id, slug: `ow-${randomUUID()}` },
    });
    const otherUser = await prisma.user.create({
      data: {
        email: `other-${randomUUID()}@example.com`,
        name: 'Other',
        passwordHash: 'hashed',
        organizationId: otherOrg.id,
      },
    });
    const otherCookie = await signFor(otherOrg.id, otherWs.id, otherUser.id);

    const response = await request(app)
      .get(`/api/v1/ai/reports/${reportId}/pdf`)
      .set('Cookie', otherCookie);

    // 404 rather than 403 so the response does not confirm the report exists.
    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toContain('application/json');

    await prisma.organization.delete({ where: { id: otherOrg.id } });
  });

  it('rejects an unauthenticated download', async () => {
    const response = await request(app).get(`/api/v1/ai/reports/${reportId}/pdf`);

    expect(response.status).toBe(401);
  });

  it('reports a not-yet-generated report honestly', async () => {
    const response = await request(app)
      .get(`/api/v1/ai/reports/${reportId}/pdf`)
      .set('Cookie', cookie);

    expect(response.status).toBe(404);
    expect(response.body.error.message).toMatch(/no generated PDF/i);
  });
});
