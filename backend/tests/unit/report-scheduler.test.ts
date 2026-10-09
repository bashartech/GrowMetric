import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReportService } from '../../src/modules/reports/report.service.js';

vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn() }));

describe('Report Scheduler', () => {
  let mockPrisma: any;
  let service: any;

  beforeEach(() => {
    mockPrisma = {
      report: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn(), findMany: vi.fn() },
      reportSchedule: {
        findFirst: vi.fn(),
        update: vi.fn(),
        create: vi.fn(async (args: any) => ({ id: 'sched-1', ...args.data })),
        findMany: vi.fn(),
      },
    };
    service = new ReportService(mockPrisma);
  });

  const baseInput = {
    reportId: 'report-1',
    workspaceId: 'ws-1',
    timezone: 'UTC',
    recipients: ['owner@example.com'],
  };

  it('advances nextRunAt by 24h for DAILY schedules', async () => {
    const before = Date.now();
    await service.createSchedule({ ...baseInput, frequency: 'DAILY' }, 'org-1');
    const created = mockPrisma.reportSchedule.create.mock.calls[0][0].data;
    expect(created.enabled).toBe(true);
    const delta = created.nextRunAt.getTime() - before;
    expect(delta).toBeGreaterThanOrEqual(23.9 * 60 * 60 * 1000);
    expect(delta).toBeLessThanOrEqual(24.1 * 60 * 60 * 1000);
  });

  it('advances nextRunAt by 7 days for WEEKLY schedules', async () => {
    const before = Date.now();
    await service.createSchedule({ ...baseInput, frequency: 'WEEKLY' }, 'org-1');
    const created = mockPrisma.reportSchedule.create.mock.calls[0][0].data;
    const delta = created.nextRunAt.getTime() - before;
    expect(delta).toBeGreaterThanOrEqual(6.9 * 24 * 60 * 60 * 1000);
    expect(delta).toBeLessThanOrEqual(7.1 * 24 * 60 * 60 * 1000);
  });

  it('advances nextRunAt to the next calendar month for MONTHLY schedules', async () => {
    const before = new Date('2026-01-15T12:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(before);
    try {
      await service.createSchedule({ ...baseInput, frequency: 'MONTHLY' }, 'org-1');
    } finally {
      vi.useRealTimers();
    }
    const created = mockPrisma.reportSchedule.create.mock.calls[0][0].data;
    const delta = created.nextRunAt.getTime() - before.getTime();
    expect(delta).toBeGreaterThanOrEqual(28 * 24 * 60 * 60 * 1000);
    expect(delta).toBeLessThanOrEqual(31 * 24 * 60 * 60 * 1000);
  });

  it('advances nextRunAt for CUSTOM cron schedules (falls back to 24h)', async () => {
    const before = Date.now();
    await service.createSchedule({ ...baseInput, frequency: 'CUSTOM', cronExpression: '0 9 * * 1' }, 'org-1');
    const created = mockPrisma.reportSchedule.create.mock.calls[0][0].data;
    const delta = created.nextRunAt.getTime() - before;
    expect(delta).toBeGreaterThanOrEqual(23.9 * 60 * 60 * 1000);
    expect(delta).toBeLessThanOrEqual(24.1 * 60 * 60 * 1000);
  });

  it('updates an existing schedule', async () => {
    mockPrisma.reportSchedule.findFirst.mockResolvedValue({ id: 'sched-1', organizationId: 'org-1' });
    mockPrisma.reportSchedule.update.mockResolvedValue({ id: 'sched-1', enabled: false });

    const result = await service.updateSchedule('sched-1', { enabled: false }, 'org-1');
    expect(mockPrisma.reportSchedule.update).toHaveBeenCalledWith({
      where: { id: 'sched-1' },
      data: { enabled: false },
    });
    expect(result.schedule.enabled).toBe(false);
  });

  it('throws when updating a schedule in another tenant', async () => {
    mockPrisma.reportSchedule.findFirst.mockResolvedValue(null);
    await expect(service.updateSchedule('sched-1', { enabled: false }, 'org-2')).rejects.toThrow(
      'Report schedule not found',
    );
  });
});