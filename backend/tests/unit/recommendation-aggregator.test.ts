import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RecommendationService } from '../../src/modules/recommendations/recommendation.service.js';
import type { AnomalyDetection, Alert } from '@prisma/client';

vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn() }));

describe('Recommendation Service', () => {
  let mockPrisma: any;
  let service: any;

  beforeEach(() => {
    mockPrisma = {
      anomalyDetection: { findMany: vi.fn() },
      alert: { findMany: vi.fn() },
      recommendation: { createMany: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    };
    service = new RecommendationService(mockPrisma);
  });

  describe('generate', () => {
    it('should build Recommendation rows from anomalies with correct severity/source/evidence', async () => {
const mockAnomalies: Partial<AnomalyDetection>[] = [{
        id: 'anom-1', datasetId: 'ds-1', metricId: 'REVENUE', kind: 'SPIKE', period: '2024-Q1',
        baseline: 100000 as any, observed: 150000 as any, deviationPct: 50.0 as any, status: 'OPEN',
        organizationId: 'org-1', workspaceId: 'ws-1', createdAt: new Date(), updatedAt: new Date(),
      }];
      const mockAlerts: Partial<Alert>[] = [{
        id: 'alert-1', ruleId: 'rule-1', title: 'Revenue threshold exceeded',
        severity: 'HIGH', message: 'Revenue exceeded $140k', evidence: JSON.stringify({ threshold: 140000 }),
        status: 'OPEN', organizationId: 'org-1', workspaceId: 'ws-1', createdAt: new Date(), updatedAt: new Date(),
      }];

      mockPrisma.anomalyDetection.findMany.mockResolvedValue(mockAnomalies);
      mockPrisma.alert.findMany.mockResolvedValue(mockAlerts);
      mockPrisma.recommendation.createMany.mockResolvedValue({ count: 2 });

      await service.generate('ws-1', 'org-1');

      expect(mockPrisma.recommendation.createMany).toHaveBeenCalled();
    });

    it('should deduplicate and merge duplicate signals for same metric/period/source', async () => {
      const mockAnomalies: Partial<AnomalyDetection>[] = [
        { id: 'anom-1', datasetId: 'ds-1', metricId: 'REVENUE', kind: 'SPIKE', period: '2024-Q1', baseline: 100000 as any, observed: 150000 as any, deviationPct: 50.0 as any, status: 'OPEN', organizationId: 'org-1', workspaceId: 'ws-1', createdAt: new Date('2024-01-01'), updatedAt: new Date('2024-01-01') },
        { id: 'anom-2', datasetId: 'ds-1', metricId: 'REVENUE', kind: 'SPIKE', period: '2024-Q1', baseline: 100000 as any, observed: 155000 as any, deviationPct: 55.0 as any, status: 'OPEN', organizationId: 'org-1', workspaceId: 'ws-1', createdAt: new Date('2024-01-02'), updatedAt: new Date('2024-01-02') },
      ];

      mockPrisma.anomalyDetection.findMany.mockResolvedValue(mockAnomalies);
      mockPrisma.alert.findMany.mockResolvedValue([]);
      mockPrisma.recommendation.createMany.mockResolvedValue({ count: 1 });

      await service.generate('ws-1', 'org-1');

      const createCall = mockPrisma.recommendation.createMany.mock.calls[0][0];
      expect(createCall.data).toHaveLength(1);
      expect(createCall.data[0]).toMatchObject({ source: 'ANOMALY', category: 'METRIC_DEVIATION' });
    });
  });

  describe('list', () => {
    it('should return filtered recommendations', async () => {
      mockPrisma.recommendation.findMany.mockResolvedValue([]);
      const result = await service.list({ workspaceId: 'ws-1', source: 'ANOMALY', severity: 'HIGH', status: 'OPEN', page: 1, limit: 50 }, 'org-1');
      expect(result.recommendations).toEqual([]);
    });
  });

  describe('get', () => {
    it('should throw when recommendation not found', async () => {
      mockPrisma.recommendation.findFirst.mockResolvedValue(null);
      await expect(service.get('nonexistent', 'org-1')).rejects.toThrow('Recommendation not found');
    });
  });

  describe('updateStatus', () => {
    it('should update status to ACKNOWLEDGED', async () => {
      mockPrisma.recommendation.findFirst.mockResolvedValue({ id: 'rec-1' });
      mockPrisma.recommendation.update.mockResolvedValue({ id: 'rec-1', status: 'ACKNOWLEDGED' });
      const result = await service.updateStatus('rec-1', { status: 'ACKNOWLEDGED' }, 'org-1');
      expect(result.recommendation.status).toBe('ACKNOWLEDGED');
    });
  });
});
