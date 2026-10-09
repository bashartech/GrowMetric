import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/http-errors.js";
import { computeQuality } from "../../lib/quality.js";
import { profileColumns } from "../../lib/infer.js";

export async function getDataQualityReport(
  datasetId: string,
  organizationId: string,
  workspaceId: string,
  versionId?: string,
) {
  // Verify ownership
  const dataset = await prisma.dataset.findFirst({
    where: { id: datasetId, organizationId, workspaceId },
    select: { id: true, currentVersionId: true },
  });

  if (!dataset) {
    throw new AppError("NOT_FOUND", "Dataset not found");
  }

  const targetVersionId = versionId ?? dataset.currentVersionId;
  if (!targetVersionId) {
    throw new AppError("NOT_FOUND", "Dataset has no versions");
  }

  const report = await prisma.dataQualityReport.findFirst({
    where: {
      datasetId,
      datasetVersionId: targetVersionId,
    },
  });

  if (!report) {
    throw new AppError("NOT_FOUND", "Quality report not found for this version");
  }

  return report;
}

export async function recomputeDataQuality(
  datasetId: string,
  organizationId: string,
  workspaceId: string,
) {
  // Verify ownership
  const dataset = await prisma.dataset.findFirst({
    where: { id: datasetId, organizationId, workspaceId },
    select: { id: true, currentVersionId: true },
  });

  if (!dataset || !dataset.currentVersionId) {
    throw new AppError("NOT_FOUND", "Dataset not found or has no current version");
  }

  const versionId = dataset.currentVersionId;

  const columns = await prisma.datasetColumn.findMany({
    where: { datasetId, datasetVersionId: versionId },
    orderBy: { ordinalPosition: "asc" },
  });

  // Get sample rows for recomputation
  const rows = await prisma.datasetRow.findMany({
    where: {
      datasetId,
      datasetVersionId: versionId,
    },
    take: 1000,
    include: {
      textValues: { include: { column: true } },
      numericValues: { include: { column: true } },
      datetimeValues: { include: { column: true } },
      booleanValues: { include: { column: true } },
    },
  });

  const columnIndexById = new Map(columns.map((column, index) => [column.id, index]));

  // Transform rows back to array format for quality computation
  const rowArrays = rows.map((row) => {
    const values: string[] = new Array(columns.length).fill("");

    row.textValues.forEach((v) => {
      const idx = columnIndexById.get(v.columnId);
      if (idx !== undefined) values[idx] = v.value;
    });
    row.numericValues.forEach((v) => {
      const idx = columnIndexById.get(v.columnId);
      if (idx !== undefined) values[idx] = v.value.toString();
    });
    row.datetimeValues.forEach((v) => {
      const idx = columnIndexById.get(v.columnId);
      if (idx !== undefined) values[idx] = v.value.toISOString();
    });
    row.booleanValues.forEach((v) => {
      const idx = columnIndexById.get(v.columnId);
      if (idx !== undefined) values[idx] = String(v.value);
    });

    return values;
  });

  // Profile columns for quality computation
  const profiles = profileColumns(
    columns.map((c) => c.name),
    rowArrays,
  );

  // Compute quality
  const quality = computeQuality({ columns: profiles, rows: rowArrays });

  // Update existing report
  const updated = await prisma.dataQualityReport.updateMany({
    where: {
      datasetId,
      datasetVersionId: versionId,
    },
    data: {
      totalRows: quality.totalRows,
      columnCount: quality.columnCount,
      missingValuePct: new Prisma.Decimal(quality.missingValuePct),
      duplicateRowPct: new Prisma.Decimal(quality.duplicateRowPct),
      invalidNumberPct: new Prisma.Decimal(quality.invalidNumberPct),
      invalidDatePct: new Prisma.Decimal(quality.invalidDatePct),
      numericOutlierCount: quality.numericOutlierCount,
      status: quality.status,
      detail: quality.warnings as unknown as Prisma.InputJsonValue,
    },
  });

  if (updated.count === 0) {
    throw new AppError("NOT_FOUND", "Quality report not found");
  }

  return getDataQualityReport(datasetId, organizationId, workspaceId);
}