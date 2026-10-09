import { describe, expect, it, vi, beforeEach } from "vitest";
import { listAnomalies, getAnomaly, updateAnomalyStatus } from "../../src/modules/anomalies/anomaly.service.js";
import { prisma } from "../../src/lib/prisma.js";

vi.mock("../../src/lib/prisma.js", () => ({
  prisma: {
    anomalyDetection: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

describe("anomaly service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("listAnomalies returns paginated anomalies", async () => {
    const mockAnomalies = [{ id: "a1", organizationId: "org-1", workspaceId: "ws-1", metricId: "REVENUE", status: "OPEN", createdAt: new Date(), updatedAt: new Date(), kind: "REVENUE", datasetId: "ds-1", period: "2026-08", baseline: {}, observed: {}, deviationPct: 50 } as never];
    vi.mocked(prisma.anomalyDetection.findMany).mockResolvedValue(mockAnomalies);
    vi.mocked(prisma.anomalyDetection.count).mockResolvedValue(1);

    const result = await listAnomalies("org-1", "ws-1", { status: "OPEN", page: 1, limit: 50 });

    expect(result.anomalies).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(prisma.anomalyDetection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 50, orderBy: { createdAt: "desc" } }),
    );
  });

  it("getAnomaly returns null for non-existent anomaly", async () => {
    vi.mocked(prisma.anomalyDetection.findFirst).mockResolvedValue(null);

    const result = await getAnomaly("unknown", "org-1");
    expect(result).toBeNull();
  });

  it("updateAnomalyStatus changes status to RESOLVED", async () => {
    const updated = { id: "a1", status: "RESOLVED", organizationId: "org-1", workspaceId: "ws-1", metricId: "REVENUE", datasetId: "ds-1", period: "2026-08", baseline: {}, observed: {}, deviationPct: 50, createdAt: new Date(), updatedAt: new Date(), kind: "REVENUE" } as never;
    vi.mocked(prisma.anomalyDetection.update).mockResolvedValue(updated);

    const result = await updateAnomalyStatus("a1", "org-1", "RESOLVED");
    expect(result?.status).toBe("RESOLVED");
    expect(prisma.anomalyDetection.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "a1", organizationId: "org-1" }, data: { status: "RESOLVED" } }),
    );
  });
});
