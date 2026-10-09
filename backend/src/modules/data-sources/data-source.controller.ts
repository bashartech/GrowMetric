import { asyncHandler } from "../../lib/async-handler.js";
import { ok } from "../../lib/respond.js";
import { AppError } from "../../lib/http-errors.js";
import * as service from "./data-source.service.js";
import type {
  CreateFileSourceInput,
  CreateExternalDbSourceInput,
  UpdateDataSourceInput,
  UpdateTableSelectionInput,
} from "./data-source.schema.js";

export const createFileSourceController = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError("VALIDATION_ERROR", "File is required");
  }

  const input = req.body as CreateFileSourceInput;

  const result = await service.createFileSource({
    organizationId: req.user!.organizationId,
    workspaceId: req.user!.workspaceId,
    createdById: req.user!.id,
    input,
    file: {
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
    },
  });

  ok(
    res,
    {
      dataSource: {
        id: result.dataSource.id,
        name: result.dataSource.name,
        kind: result.dataSource.kind,
        status: result.dataSource.status,
        createdAt: result.dataSource.createdAt.toISOString(),
      },
      import: {
        id: result.import.id,
        status: result.import.status,
        filename: result.import.filename,
        source: result.import.source,
        createdAt: result.import.createdAt.toISOString(),
      },
    },
    201,
  );
});

export const listDataSourcesController = asyncHandler(async (req, res) => {
  const sources = await service.listDataSources(
    req.user!.organizationId,
    req.user!.workspaceId,
  );

  ok(res, {
    dataSources: sources.map((source) => ({
      id: source.id,
      name: source.name,
      kind: source.kind,
      status: source.status,
      lastSyncAt: source.lastSyncAt?.toISOString() ?? null,
      importCount: source._count.imports,
      datasetCount: source._count.datasets,
      createdAt: source.createdAt.toISOString(),
    })),
  });
});

export const getDataSourceController = asyncHandler(async (req, res) => {
  const source = await service.getDataSource(
    req.params.id!,
    req.user!.organizationId,
    req.user!.workspaceId,
  );

  ok(res, {
    id: source.id,
    name: source.name,
    kind: source.kind,
    status: source.status,
    lastSyncAt: source.lastSyncAt?.toISOString() ?? null,
    tables: source.tables,
    importCount: source._count.imports,
    datasetCount: source._count.datasets,
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
  });
});

export const updateDataSourceController = asyncHandler(async (req, res) => {
  const updated = await service.updateDataSource(
    req.params.id!,
    req.user!.organizationId,
    req.user!.workspaceId,
    req.body as UpdateDataSourceInput,
  );

  ok(res, {
    id: updated.id,
    name: updated.name,
    status: updated.status,
    updatedAt: updated.updatedAt.toISOString(),
  });
});

export const deleteDataSourceController = asyncHandler(async (req, res) => {
  await service.deleteDataSource(
    req.params.id!,
    req.user!.organizationId,
    req.user!.workspaceId,
    req.user!.id,
  );

  ok(res, { deleted: true });
});

export const createExternalDbSourceController = asyncHandler(async (req, res) => {
  const input = req.body as CreateExternalDbSourceInput;

  const dataSource = await service.createExternalDbSource({
    organizationId: req.user!.organizationId,
    workspaceId: req.user!.workspaceId,
    createdById: req.user!.id,
    input,
  });

  ok(
    res,
    {
      dataSource: {
        id: dataSource.id,
        name: dataSource.name,
        kind: dataSource.kind,
        status: dataSource.status,
        createdAt: dataSource.createdAt.toISOString(),
      },
    },
    201,
  );
});

export const listDataSourceTablesController = asyncHandler(async (req, res) => {
  const tables = await service.listDataSourceTables(
    req.params.id!,
    req.user!.organizationId,
    req.user!.workspaceId,
  );

  ok(res, { tables });
});

export const updateTableSelectionController = asyncHandler(async (req, res) => {
  const updated = await service.updateTableSelection(
    req.params.id!,
    req.user!.organizationId,
    req.user!.workspaceId,
    req.body as UpdateTableSelectionInput,
  );

  ok(res, {
    selectedCount: updated.tables.filter((table) => table.isSelected).length,
  });
});

export const syncDataSourceController = asyncHandler(async (req, res) => {
  const result = await service.syncDataSource(
    req.params.id!,
    req.user!.organizationId,
    req.user!.workspaceId,
  );

  ok(
    res,
    {
      importJobs: result.imports.map((importJob) => ({
        id: importJob.id,
        source: importJob.source,
        status: importJob.status,
        filename: importJob.filename,
        createdAt: importJob.createdAt.toISOString(),
      })),
    },
    202,
  );
});
