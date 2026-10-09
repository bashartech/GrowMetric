import { asyncHandler } from "../../lib/async-handler.js";
import { ok } from "../../lib/respond.js";
import { AppError } from "../../lib/http-errors.js";
import * as service from "./dataset.service.js";
import type {
  UpdateDatasetInput,
  GetDatasetRowsInput,
  ConfirmMappingInput,
  ReimportInput,
} from "./dataset.schema.js";

export const listDatasetsController = asyncHandler(async (req, res) => {
  const datasets = await service.listDatasets(
    req.user!.organizationId,
    req.user!.workspaceId,
  );

  ok(res, {
    datasets: datasets.map((ds) => ({
      id: ds.id,
      name: ds.name,
      kind: ds.kind,
      status: ds.status,
      rowCount: ds.rowCount,
      currentVersionId: ds.currentVersionId,
      sourceTable: ds.sourceTable,
      source: ds.source,
      dataSourceId: ds.dataSourceId,
      lastSyncAt: ds.lastSyncAt,
      createdAt: ds.createdAt.toISOString(),
    })),
  });
});

export const getDatasetController = asyncHandler(async (req, res) => {
  const dataset = await service.getDataset(
    req.params.id!,
    req.user!.organizationId,
    req.user!.workspaceId,
  );

  ok(res, {
    id: dataset.id,
    name: dataset.name,
    kind: dataset.kind,
    status: dataset.status,
    rowCount: dataset.rowCount,
    currentVersionId: dataset.currentVersionId,
    sourceTable: dataset.sourceTable,
    source: dataset.source,
    dataSourceId: dataset.dataSourceId,
    lastSyncAt: dataset.lastSyncAt,
    createdAt: dataset.createdAt.toISOString(),
    columns: dataset.columns.map((col) => ({
      id: col.id,
      name: col.name,
      type: col.type,
      ordinalPosition: col.ordinalPosition,
      isNullable: col.isNullable,
      semanticKey: col.semanticKey,
      businessMeaning: col.businessMeaning,
      representativeSample: col.representativeSample,
    })),
    pendingMappings: dataset.pendingMappings,
  });
});

export const updateDatasetController = asyncHandler(async (req, res) => {
  const updated = await service.updateDataset(
    req.params.id!,
    req.user!.organizationId,
    req.user!.workspaceId,
    req.body as UpdateDatasetInput,
  );

  ok(res, {
    id: updated.id,
    name: updated.name,
    status: updated.status,
  });
});

export const getDatasetVersionsController = asyncHandler(async (req, res) => {
  const versions = await service.getDatasetVersions(
    req.params.id!,
    req.user!.organizationId,
    req.user!.workspaceId,
  );

  ok(res, {
    versions: versions.map((v) => ({
      id: v.id,
      version: v.version,
      commit: v.commit,
      source: v.source,
      status: v.status,
      summary: v.summary,
      createdAt: v.createdAt.toISOString(),
    })),
  });
});

export const getDatasetRowsController = asyncHandler(async (req, res) => {
  const query = req.query as GetDatasetRowsInput;

  const result = await service.getDatasetRows(
    req.params.id!,
    req.user!.organizationId,
    req.user!.workspaceId,
    {
      limit: query.limit,
      offset: query.offset,
    },
  );

  ok(res, result);
});

export const confirmMappingController = asyncHandler(async (req, res) => {
  const dataset = await service.confirmMapping(
    req.params.id!,
    req.user!.organizationId,
    req.user!.workspaceId,
    req.body as ConfirmMappingInput,
  );

  ok(res, {
    id: dataset.id,
    name: dataset.name,
    kind: dataset.kind,
    status: dataset.status,
    rowCount: dataset.rowCount,
    currentVersionId: dataset.currentVersionId,
    columns: dataset.columns.map((col) => ({
      id: col.id,
      name: col.name,
      type: col.type,
      semanticKey: col.semanticKey,
      businessMeaning: col.businessMeaning,
    })),
    pendingMappings: dataset.pendingMappings,
  });
});

export const reimportController = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError("VALIDATION_ERROR", "File is required");
  }

  const input = req.body as ReimportInput;

  const result = await service.reimportDataset({
    datasetId: req.params.id!,
    organizationId: req.user!.organizationId,
    workspaceId: req.user!.workspaceId,
    createdById: req.user!.id,
    commit: input.commit,
    upsertKey: input.upsertKey,
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
      import: {
        id: result.import.id,
        status: result.import.status,
        filename: result.import.filename,
        source: result.import.source,
        createdAt: result.import.createdAt.toISOString(),
      },
    },
    202,
  );
});
