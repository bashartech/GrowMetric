import { asyncHandler } from "../../lib/async-handler.js";
import { ok } from "../../lib/respond.js";
import * as service from "./import.service.js";

export const listImportsController = asyncHandler(async (req, res) => {
  const { status, dataSourceId, page, pageSize } = req.query;

  const result = await service.listImports(
    req.user!.organizationId,
    req.user!.workspaceId,
    {
      status: status as string | undefined,
      dataSourceId: dataSourceId as string | undefined,
      page: page !== undefined ? Number(page) : undefined,
      pageSize: pageSize !== undefined ? Number(pageSize) : undefined,
    },
  );

  ok(res, {
    imports: result.imports.map((imp) => ({
      id: imp.id,
      status: imp.status,
      source: imp.source,
      filename: imp.filename,
      totalRows: imp.totalRows,
      processedRows: imp.processedRows,
      error: imp.error,
      dataSource: imp.dataSource,
      dataset: imp.dataset,
      datasetId: imp.datasetId,
      startedAt: imp.startedAt?.toISOString() ?? null,
      completedAt: imp.completedAt?.toISOString() ?? null,
      createdAt: imp.createdAt.toISOString(),
    })),
    meta: {
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      hasMore: result.page * result.pageSize < result.total,
    },
  });
});

export const getImportController = asyncHandler(async (req, res) => {
  const importJob = await service.getImport(
    req.params.id!,
    req.user!.organizationId,
    req.user!.workspaceId,
  );

  ok(res, {
    id: importJob.id,
    status: importJob.status,
    source: importJob.source,
    filename: importJob.filename,
    totalRows: importJob.totalRows,
    processedRows: importJob.processedRows,
    error: importJob.error,
    dataSource: importJob.dataSource,
    dataset: importJob.dataset,
    job: {
      status: importJob.job.status,
      attempts: importJob.job.attempts,
      lastError: importJob.job.lastError,
    },
    startedAt: importJob.startedAt?.toISOString() ?? null,
    completedAt: importJob.completedAt?.toISOString() ?? null,
    createdAt: importJob.createdAt.toISOString(),
  });
});

export const cancelImportController = asyncHandler(async (req, res) => {
  const result = await service.cancelImport(
    req.params.id!,
    req.user!.organizationId,
    req.user!.workspaceId,
  );

  ok(res, result);
});

export const retryImportController = asyncHandler(async (req, res) => {
  const result = await service.retryImport(
    req.params.id!,
    req.user!.organizationId,
    req.user!.workspaceId,
  );

  ok(res, result);
});
