import { asyncHandler } from "../../lib/async-handler.js";
import { ok } from "../../lib/respond.js";
import * as service from "./quality.service.js";

interface WarningDetail {
  column?: string;
  issue?: string;
  severity?: string;
  messages?: string[];
}

const toWarningDto = (
  item: unknown,
): { column: string; issue: string; severity: string } => {
  const warning = (item ?? {}) as WarningDetail;
  return {
    column: warning.column ?? "Unknown column",
    issue: warning.issue ?? warning.messages?.join(" ") ?? "",
    severity: warning.severity ?? "warning",
  };
};

export const getQualityReportController = asyncHandler(async (req, res) => {
  const { version } = req.query;

  const report = await service.getDataQualityReport(
    req.params.datasetId!,
    req.user!.organizationId,
    req.user!.workspaceId,
    version as string | undefined,
  );

  const detail = Array.isArray(report.detail) ? report.detail : [];

  ok(res, {
    id: report.id,
    datasetId: report.datasetId,
    datasetVersionId: report.datasetVersionId,
    totalRows: report.totalRows,
    columnCount: report.columnCount,
    missingValuePct: Number(report.missingValuePct),
    duplicateRowPct: Number(report.duplicateRowPct),
    invalidNumberPct: Number(report.invalidNumberPct),
    invalidDatePct: Number(report.invalidDatePct),
    numericOutlierCount: report.numericOutlierCount,
    status: report.status,
    warnings: detail.map(toWarningDto),
    createdAt: report.createdAt.toISOString(),
  });
});

export const recomputeQualityController = asyncHandler(async (req, res) => {
  const report = await service.recomputeDataQuality(
    req.params.datasetId!,
    req.user!.organizationId,
    req.user!.workspaceId,
  );

  ok(res, {
    id: report.id,
    datasetId: report.datasetId,
    status: report.status,
    recomputedAt: new Date().toISOString(),
  });
});
