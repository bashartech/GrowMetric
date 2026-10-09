import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/http-errors.js";
import { storage, buildStorageKey } from "../../lib/storage.js";
import { computeChecksum, validateUploadedFile } from "../../lib/files.js";
import { recordUsage } from "../entitlements/entitlement.service.js";
import { record } from "../audit/audit.service.js";
import {
  queryDatasets,
  queryDatasetDetail,
  queryDatasetVersions,
  renameDataset,
  confirmDatasetMapping,
} from "./dataset.repo.js";
import { ensureDefaultDashboard } from "../dashboards/dashboard.service.js";
import type { ImportJob } from "@prisma/client";
import type { ConfirmMappingInput, ReimportInput } from "./dataset.schema.js";

export async function listDatasets(
  organizationId: string,
  workspaceId: string,
) {
  return queryDatasets(organizationId, workspaceId);
}

export async function getDataset(
  id: string,
  organizationId: string,
  workspaceId: string,
) {
  const dataset = await queryDatasetDetail(id, organizationId);

  if (!dataset) {
    throw new AppError("NOT_FOUND", "Dataset not found");
  }

  // Verify workspace ownership
  const ownership = await prisma.dataset.findFirst({
    where: { id, organizationId, workspaceId },
    select: { id: true },
  });

  if (!ownership) {
    throw new AppError("NOT_FOUND", "Dataset not found");
  }

  return dataset;
}

export async function updateDataset(
  id: string,
  organizationId: string,
  workspaceId: string,
  updates: { name?: string },
) {
  // Verify ownership
  await getDataset(id, organizationId, workspaceId);

  if (updates.name) {
    const success = await renameDataset(id, organizationId, updates.name);
    if (!success) {
      throw new AppError("NOT_FOUND", "Dataset not found");
    }
  }

  return getDataset(id, organizationId, workspaceId);
}

export async function getDatasetVersions(
  datasetId: string,
  organizationId: string,
  workspaceId: string,
) {
  // Verify ownership
  await getDataset(datasetId, organizationId, workspaceId);

  const versions = await queryDatasetVersions(datasetId, organizationId);

  if (!versions) {
    throw new AppError("NOT_FOUND", "Dataset not found");
  }

  return versions;
}

export async function getDatasetRows(
  datasetId: string,
  organizationId: string,
  workspaceId: string,
  options: {
    limit?: number;
    offset?: number;
  } = {},
) {
  // Verify ownership
  const dataset = await getDataset(datasetId, organizationId, workspaceId);

  const limit = Math.min(options.limit ?? 50, 100);
  const offset = options.offset ?? 0;

  const rows = await prisma.datasetRow.findMany({
    where: {
      datasetId,
      datasetVersionId: dataset.currentVersionId ?? undefined,
    },
    take: limit,
    skip: offset,
    orderBy: { rowIndex: "asc" },
    include: {
      textValues: { include: { column: { select: { name: true } } } },
      numericValues: { include: { column: { select: { name: true } } } },
      datetimeValues: { include: { column: { select: { name: true } } } },
      booleanValues: { include: { column: { select: { name: true } } } },
    },
  });

  // Transform to column-value pairs
  const transformed = rows.map((row) => {
    const values: Record<string, any> = {};

    row.textValues.forEach((v) => {
      values[v.column.name] = v.value;
    });
    row.numericValues.forEach((v) => {
      values[v.column.name] = v.value.toString();
    });
    row.datetimeValues.forEach((v) => {
      values[v.column.name] = v.value.toISOString();
    });
    row.booleanValues.forEach((v) => {
      values[v.column.name] = v.value;
    });

    return {
      rowIndex: row.rowIndex,
      values,
    };
  });

  return {
    rows: transformed,
    limit,
    offset,
    hasMore: rows.length === limit,
  };
}

export async function confirmMapping(
  datasetId: string,
  organizationId: string,
  workspaceId: string,
  input: ConfirmMappingInput,
) {
  await getDataset(datasetId, organizationId, workspaceId);

  const result = await confirmDatasetMapping(
    datasetId,
    organizationId,
    workspaceId,
    input.mappings.map((m) => ({
      datasetColumnId: m.datasetColumnId,
      semanticKey: m.semanticKey,
      businessMeaning: m.businessMeaning,
    })),
  );

  if (!result.confirmed) {
    throw new AppError("CONFLICT", "Mapping confirmation could not be applied");
  }

  const dataset = await getDataset(datasetId, organizationId, workspaceId);
  if (
    dataset.status === "READY" ||
    dataset.status === "READY_WITH_WARNINGS"
  ) {
    await ensureDefaultDashboard(organizationId, workspaceId, datasetId);
  }

  return dataset;
}

interface ReimportFile {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

interface ReimportParams {
  datasetId: string;
  organizationId: string;
  workspaceId: string;
  createdById: string | null;
  commit: ReimportInput["commit"];
  upsertKey?: string;
  file: ReimportFile;
}

export async function reimportDataset(
  params: ReimportParams,
): Promise<{ import: ImportJob }> {
  const dataset = await prisma.dataset.findFirst({
    where: {
      id: params.datasetId,
      organizationId: params.organizationId,
      workspaceId: params.workspaceId,
    },
    select: {
      id: true,
      name: true,
      dataSourceId: true,
      currentVersionId: true,
    },
  });
  if (!dataset) {
    throw new AppError("NOT_FOUND", "Dataset not found");
  }

  if (params.commit === "UPSERT" && !params.upsertKey) {
    throw new AppError(
      "VALIDATION_ERROR",
      "upsertKey is required for an UPSERT re-import",
    );
  }

  if (params.upsertKey && dataset.currentVersionId) {
    const keyColumn = await prisma.datasetColumn.findFirst({
      where: {
        datasetId: dataset.id,
        datasetVersionId: dataset.currentVersionId,
        name: params.upsertKey,
      },
      select: { id: true },
    });
    if (!keyColumn) {
      throw new AppError(
        "VALIDATION_ERROR",
        `upsert key column "${params.upsertKey}" does not exist in the dataset`,
      );
    }
  }

  // Validate the file and check entitlement before touching storage.
  await validateUploadedFile(params.file.originalName, params.file.buffer);
  await recordUsage(params.organizationId, "imports", 1);

  const fileChecksum = computeChecksum(params.file.buffer);
  const storageKey = buildStorageKey(
    params.organizationId,
    "pending",
    fileChecksum.slice(0, 16),
  );
  await storage.put(storageKey, params.file.buffer);

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const importFile = await tx.importFile.create({
          data: {
            dataSourceId: dataset.dataSourceId,
            originalName: params.file.originalName,
            storageKey,
            mimeType: params.file.mimeType,
            sizeBytes: params.file.sizeBytes,
            checksum: fileChecksum,
          },
        });

        const job = await tx.job.create({
          data: {
            organizationId: params.organizationId,
            type: "IMPORT_DATA",
            status: "PENDING",
            runAt: new Date(),
            payload: {},
          },
        });

        const importJob = await tx.importJob.create({
          data: {
            organizationId: params.organizationId,
            workspaceId: params.workspaceId,
            jobId: job.id,
            dataSourceId: dataset.dataSourceId,
            datasetId: dataset.id,
            fileId: importFile.id,
            source: "UPLOAD",
            status: "QUEUED",
            filename: params.file.originalName,
          },
        });

        await tx.job.update({
          where: { id: job.id },
          data: {
            payload: {
              importJobId: importJob.id,
              commit: params.commit,
              ...(params.upsertKey ? { upsertKeyColumnName: params.upsertKey } : {}),
              datasetName: dataset.name,
            },
          },
        });

        await record(
          {
            organizationId: params.organizationId,
            workspaceId: params.workspaceId,
            actorUserId: params.createdById,
            action: "import.create",
            resourceType: "ImportJob",
            resourceId: importJob.id,
            metadata: {
              datasetId: dataset.id,
              datasetName: dataset.name,
              commit: params.commit,
              filename: params.file.originalName,
            },
          },
          tx,
        );

        return importJob;
      },
      { timeout: 60_000 },
    );

    return { import: result };
  } catch (error) {
    await storage.delete(storageKey).catch(() => undefined);
    throw error;
  }
}
