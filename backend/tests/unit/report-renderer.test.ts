import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReportService } from '../../src/modules/reports/report.service.js';

vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn() }));

// Keep the analytics and storage layers out of this unit test: real metric
// computation is proved in tests/integration/report-rendering.test.ts, and
// nothing should touch the filesystem or the database here.
vi.mock('../../src/modules/analytics/metrics.service.js', () => ({
  computeMetric: vi.fn(async (input: { metricKind: string }) => ({
    metricKind: input.metricKind,
    value: 1,
    unit: 'USD',
    available: true,
  })),
  groupByMetric: vi.fn(async () => ({
    metricKind: 'REVENUE',
    available: true,
    rows: [],
    total: 0,
  })),
}));
vi.mock('../../src/lib/storage.js', () => ({
  storage: { put: vi.fn(async () => undefined), getObject: vi.fn(async () => null) },
}));

/**
 * These cover the guard clauses that need no database. The real computation is
 * proved end-to-end in tests/integration/report-rendering.test.ts, which builds
 * an actual dataset version, columns and rows and asserts the generated values.
 */
describe('Report Renderer guards', () => {
  let mockPrisma: any;
  let service: any;

  function reportRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'report-1',
      organizationId: 'org-1',
      workspaceId: 'ws-1',
      title: 'Weekly Revenue Report',
      kind: 'WEEKLY',
      reportType: 'METRICS',
      status: 'DRAFT',
      datasetId: null,
      investigationId: null,
      metricKeys: null,
      filters: null,
      breakdowns: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    mockPrisma = {
      report: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn(), findMany: vi.fn() },
      reportSchedule: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn(), findMany: vi.fn() },
      investigation: { findFirst: vi.fn() },
    };
    mockPrisma.report.update.mockImplementation(async ({ where, data }: any) => ({
      id: where.id,
      ...data,
    }));
    service = new ReportService(mockPrisma);
  });

  it('fails a metrics report that has no dataset rather than inventing values', async () => {
    mockPrisma.report.findFirst.mockResolvedValue(reportRow({ metricKeys: ['REVENUE'] }));

    await expect(service.generate({ reportId: 'report-1' }, 'org-1')).rejects.toThrow(
      /no dataset/i,
    );

    const calls = mockPrisma.report.update.mock.calls;
    expect(calls.at(-1)?.[0].data.status).toBe('FAILED');
  });

  it('fails a metrics report that has no metrics selected', async () => {
    mockPrisma.report.findFirst.mockResolvedValue(
      reportRow({ datasetId: 'ds-1', metricKeys: [] }),
    );

    await expect(service.generate({ reportId: 'report-1' }, 'org-1')).rejects.toThrow(
      /no metrics selected/i,
    );
  });

  it('refuses to render an investigation report without an investigation', async () => {
    mockPrisma.report.findFirst.mockResolvedValue(
      reportRow({ reportType: 'INVESTIGATION', investigationId: null }),
    );

    await expect(service.generate({ reportId: 'report-1' }, 'org-1')).rejects.toThrow();
  });

  it('transitions to FAILED and records the reason when rendering throws', async () => {
    mockPrisma.report.findFirst.mockResolvedValue(
      reportRow({ datasetId: 'ds-1', metricKeys: ['REVENUE'] }),
    );
    const original = mockPrisma.report.update;
    mockPrisma.report.update = vi.fn(async (args: any) => {
      if (args.data?.status === 'GENERATED') throw new Error('pdf disk full');
      return original(args);
    });

    await expect(service.generate({ reportId: 'report-1' }, 'org-1')).rejects.toThrow(
      /Report generation failed/,
    );

    const failedCall = mockPrisma.report.update.mock.calls.at(-1)?.[0];
    expect(failedCall.data.status).toBe('FAILED');
    expect(failedCall.data.error).toMatch(/disk full/);
  });

  it('stores content as an object and a storage key, not a JSON string or a public URL', async () => {
    mockPrisma.report.findFirst.mockResolvedValue(
      reportRow({ datasetId: 'ds-1', metricKeys: ['REVENUE'] }),
    );

    const { report } = await service.generate({ reportId: 'report-1' }, 'org-1');

    expect(typeof report.content).toBe('object');
    expect(report.content.metrics[0]).toMatchObject({
      metricKind: 'REVENUE',
      value: 1,
      available: true,
    });
    // A storage key, so the PDF is served by the authenticated route.
    expect(report.pdfUrl).toMatch(/^org-1\/reports\/report-report-1-\d+\.pdf$/);
    expect(report.pdfUrl).not.toMatch(/^\/uploads\//);
  });
});
