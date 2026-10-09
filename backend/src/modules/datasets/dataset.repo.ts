import { Prisma } from "@prisma/client";
import type { Prisma as PrismaTypes } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";
import { AppError } from "../../lib/http-errors.js";
import { recordUsage } from "../entitlements/entitlement.service.js";
import type {
  PendingMappingCandidate,
  PendingMappingDTO,
  VersionedCell,
  VersionedDatasetInput,
} from "./dataset.types.js";

type Tx = PrismaTypes.TransactionClient;

const BATCH = 10_000;

interface ValueTableContext {
  findMany: (args: {
    where: { rowId: { in: string[] } };
  }) => Promise<Array<{ rowId: string; columnId: string; value: unknown }>>;
  createMany: (args: {
    data: Array<{ rowId: string; columnId: string; value: unknown }>;
  }) => Promise<void>;
}

const VALUE_TABLES = [
  "datasetTextValue" as const,
  "datasetNumericValue" as const,
  "datasetDatetimeValue" as const,
  "datasetBooleanValue" as const,
];

function valueTableContexts(tx: Tx): Record<(typeof VALUE_TABLES)[number], ValueTableContext> {
  return {
    datasetTextValue: tx.datasetTextValue as unknown as ValueTableContext,
    datasetNumericValue: tx.datasetNumericValue as unknown as ValueTableContext,
    datasetDatetimeValue: tx.datasetDatetimeValue as unknown as ValueTableContext,
    datasetBooleanValue: tx.datasetBooleanValue as unknown as ValueTableContext,
  };
}

export async function createVersionedDataset(
  input: VersionedDatasetInput,
): Promise<{ datasetId: string; versionId: string }> {
  return prisma.$transaction(
    async (tx) => {
      let datasetId = input.existingDatasetId ?? undefined;
      let fromVersionId: string | null = null;
      let createdDataset = false;

    if (input.importJobId && !datasetId) {
      const importJob = await tx.importJob.findUnique({
        where: { id: input.importJobId },
        select: { datasetId: true },
      });
      datasetId = importJob?.datasetId ?? undefined;
    }

    if (datasetId) {
      const existing = await tx.dataset.findUnique({
        where: { id: datasetId },
        select: { dataSourceId: true, currentVersionId: true },
      });
      if (existing && existing.dataSourceId !== input.dataSourceId) {
        throw new AppError(
          "DATA_SOURCE_CONFLICT",
          "This dataset belongs to a different data source.",
        );
      }
      fromVersionId = existing?.currentVersionId ?? null;
    } else {
      const created = await tx.dataset.create({
        data: {
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          dataSourceId: input.dataSourceId,
          name: input.datasetName,
          kind: input.datasetKind ?? "CUSTOM",
          sourceTable: input.sourceTable,
          status: "DRAFT",
        },
      });
      datasetId = created.id;
      createdDataset = true;
    }

    const versionNumber = await tx.datasetVersion.count({ where: { datasetId } });
    const version = await tx.datasetVersion.create({
      data: {
        datasetId,
        version: versionNumber + 1,
        importJobId: input.importJobId ?? null,
        commit: input.commit,
        source: input.source,
        status: "BUILDING",
        summary:
          input.pendingMappings && input.pendingMappings.length > 0
            ? ({ pendingMappings: input.pendingMappings } as unknown as PrismaTypes.InputJsonValue)
            : undefined,
      },
    });

    const columnNameToId = new Map<string, string>();
    const oldColumnIdToNew = new Map<string, string>();
    let priorKeyColumnId: string | undefined;
    if (fromVersionId) {
      const priorColumns = await tx.datasetColumn.findMany({
        where: { datasetVersionId: fromVersionId },
        select: { id: true, name: true },
      });
      for (const column of priorColumns) oldColumnIdToNew.set(column.id, column.name);
      if (input.upsertKeyColumnName) {
        priorKeyColumnId = priorColumns.find((column) => column.name === input.upsertKeyColumnName)?.id;
      }
    }
    for (const column of input.columns) {
      const created = await tx.datasetColumn.create({
        data: {
          datasetId,
          datasetVersionId: version.id,
          name: column.name,
          type: column.type,
          ordinalPosition: column.ordinalPosition,
          isNullable: column.isNullable,
          semanticKey: column.semanticKey ?? null,
          businessMeaning: column.businessMeaning ?? null,
          representativeSample: column.representativeSample as PrismaTypes.InputJsonValue | undefined,
        },
      });
      columnNameToId.set(column.name, created.id);
    }
    for (const [priorId, name] of oldColumnIdToNew) {
      const next = columnNameToId.get(name);
      if (next) oldColumnIdToNew.set(priorId, next);
    }

    const newRowCount = await writeRows(tx, {
      datasetId,
      versionId: version.id,
      rows: input.rows,
      columnNameToId,
      startRowIndex: 0,
    });

    let totalRows = newRowCount;
    const copied = await copyPriorVersion(tx, {
      fromVersionId,
      toVersionId: version.id,
      datasetId,
      columnIdMap: oldColumnIdToNew,
      startRowIndex: newRowCount,
      commit: input.commit,
      skipKeys: input.commit === "UPSERT" ? collectKeys(input.rows, input.upsertKeyColumnName) : undefined,
      skipKeysColumnId: input.commit === "UPSERT" ? priorKeyColumnId : undefined,
    });
    totalRows += copied;

    await tx.dataQualityReport.create({
      data: {
        datasetId,
        datasetVersionId: version.id,
        totalRows: input.quality.totalRows,
        columnCount: input.quality.columnCount,
        missingValuePct: new Prisma.Decimal(input.quality.missingValuePct),
        duplicateRowPct: new Prisma.Decimal(input.quality.duplicateRowPct),
        invalidNumberPct: new Prisma.Decimal(input.quality.invalidNumberPct),
        invalidDatePct: new Prisma.Decimal(input.quality.invalidDatePct),
        numericOutlierCount: input.quality.numericOutlierCount,
        status: input.quality.status,
        detail: input.quality.detail as PrismaTypes.InputJsonValue,
      },
    });

    await tx.datasetVersion.update({
      where: { id: version.id },
      data: { status: "READY" },
    });
    await tx.dataset.update({
      where: { id: datasetId },
      data: {
        currentVersionId: version.id,
        rowCount: totalRows,
        status: mapDatasetStatus(input.quality.status),
      },
    });

    return { datasetId, versionId: version.id, createdDataset };
    },
    { timeout: 60_000 },
  ).then(async (result) => {
    // The `datasets` plan allowance is billed once per new dataset, and only
    // after the transaction commits: billing inside the transaction would
    // charge a quota for a dataset that a rollback then erased. Appending a new
    // version to an existing dataset bills nothing extra.
    if (result.createdDataset) {
      try {
        await recordUsage(input.organizationId, "datasets", 1);
      } catch (error) {
        // The dataset is already committed, so rejecting here would report a
        // failed import for a dataset that exists. Log the unbilled unit.
        logger.error(
          { organizationId: input.organizationId, datasetId: result.datasetId, error },
          "Dataset metering exceeded the plan quota after commit.",
        );
      }
    }
    return { datasetId: result.datasetId, versionId: result.versionId };
  });
}

function collectKeys(rows: VersionedCell[][], upsertKeyColumnName?: string | null): Set<string> {
  const keys = new Set<string>();
  if (!upsertKeyColumnName) return keys;
  for (const row of rows) {
    for (const cell of row) {
      if (cell.columnName === upsertKeyColumnName && cell.value != null) {
        keys.add(String(cell.value));
      }
    }
  }
  return keys;
}

async function writeRows(
  tx: Tx,
  args: {
    datasetId: string;
    versionId: string;
    rows: VersionedCell[][];
    columnNameToId: Map<string, string>;
    startRowIndex: number;
  },
): Promise<number> {
  if (args.rows.length === 0) return 0;
  const rowRecords = await tx.datasetRow.createManyAndReturn({
    data: args.rows.map((cells, index) => ({
      datasetId: args.datasetId,
      datasetVersionId: args.versionId,
      rowIndex: args.startRowIndex + index,
    })),
  });

  const text: Array<{ rowId: string; columnId: string; value: string }> = [];
  const numeric: Array<{ rowId: string; columnId: string; value: Prisma.Decimal }> = [];
  const datetime: Array<{ rowId: string; columnId: string; value: Date }> = [];
  const boolean: Array<{ rowId: string; columnId: string; value: boolean }> = [];

  args.rows.forEach((cells, index) => {
    const rowId = rowRecords[index]!.id;
    for (const cell of cells) {
      const columnId = args.columnNameToId.get(cell.columnName);
      if (!columnId || cell.value == null) continue;
      switch (cell.columnType) {
        case "TEXT":
          text.push({ rowId, columnId, value: String(cell.value) });
          break;
        case "INTEGER":
        case "DECIMAL":
          numeric.push({ rowId, columnId, value: new Prisma.Decimal(Number(cell.value)) });
          break;
        case "DATE":
        case "TIME":
        case "TIMESTAMP":
          if (cell.value instanceof Date) datetime.push({ rowId, columnId, value: cell.value });
          break;
        case "BOOLEAN":
          boolean.push({ rowId, columnId, value: Boolean(cell.value) });
          break;
      }
    }
  });

  for (const batch of chunk(text)) await tx.datasetTextValue.createMany({ data: batch });
  for (const batch of chunk(numeric)) await tx.datasetNumericValue.createMany({ data: batch });
  for (const batch of chunk(datetime)) await tx.datasetDatetimeValue.createMany({ data: batch });
  for (const batch of chunk(boolean)) await tx.datasetBooleanValue.createMany({ data: batch });

  return args.rows.length;
}

async function copyPriorVersion(
  tx: Tx,
  args: {
    fromVersionId: string | null;
    toVersionId: string;
    datasetId: string;
    columnIdMap: Map<string, string>;
    startRowIndex: number;
    commit: string;
    skipKeys?: Set<string>;
    skipKeysColumnId?: string;
  },
): Promise<number> {
  if (!args.fromVersionId || args.commit === "REPLACE") return 0;

  const priorRowIds = await tx.datasetRow.findMany({
    where: { datasetVersionId: args.fromVersionId },
    select: { id: true },
    orderBy: { rowIndex: "asc" },
  });

  let total = 0;
  let rowIndexCursor = args.startRowIndex;
  const tables = valueTableContexts(tx);
  for (const chunkIds of chunkIDs(priorRowIds.map((row) => row.id))) {
    const values = new Map<string, Partial<Record<(typeof VALUE_TABLES)[number], Array<{ columnId: string; value: unknown }>>>>();
    for (const table of VALUE_TABLES) {
      const rows = await tables[table].findMany({
        where: { rowId: { in: chunkIds } },
      });
      for (const value of rows) {
        const entry = values.get(value.rowId) ?? {};
        entry[table] = (entry[table] ?? []).concat({ columnId: value.columnId, value: value.value });
        values.set(value.rowId, entry);
      }
    }

    const survivingChunk: string[] = [];
    for (const rowId of chunkIds) {
      if (args.skipKeys && args.skipKeysColumnId) {
        const key = valueIn(values, rowId, args.skipKeysColumnId);
        if (key != null && args.skipKeys.has(String(key))) continue;
      }
      survivingChunk.push(rowId);
    }

    if (survivingChunk.length === 0) continue;
    const newRows = await tx.datasetRow.createManyAndReturn({
      data: survivingChunk.map((_id, i) => ({
        datasetId: args.datasetId,
        datasetVersionId: args.toVersionId,
        rowIndex: rowIndexCursor + i,
      })),
    });
    const newRowIds = new Map(survivingChunk.map((id, i) => [id, newRows[i]!.id]));

    for (const table of VALUE_TABLES) {
      const batch: Array<{ rowId: string; columnId: string; value: unknown }> = [];
      for (const rowId of survivingChunk) {
        for (const value of values.get(rowId)?.[table] ?? []) {
          const newColumnId = args.columnIdMap.get(value.columnId);
          if (!newColumnId) continue;
          batch.push({ rowId: newRowIds.get(rowId)!, columnId: newColumnId, value: value.value });
        }
      }
      for (const part of chunk(batch)) {
        await tables[table].createMany({ data: part });
      }
    }

    total += survivingChunk.length;
    rowIndexCursor += survivingChunk.length;
  }
  return total;
}

function valueIn(
  values: Map<string, Partial<Record<(typeof VALUE_TABLES)[number], Array<{ columnId: string; value: unknown }>>>>,
  rowId: string,
  columnId: string | undefined,
): unknown {
  if (!columnId) return undefined;
  for (const table of VALUE_TABLES) {
    const found = (values.get(rowId)?.[table] ?? []).find((v) => v.columnId === columnId);
    if (found) return found.value;
  }
  return undefined;
}

function chunk<T>(items: T[], size = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface DatasetOrigin {
  source: "UPLOAD" | "TABLE_SYNC";
  dataSourceId: string | null;
  lastSyncAt: string | null;
}

async function resolveDatasetOrigins(
  datasetIds: string[],
): Promise<Map<string, DatasetOrigin>> {
  const origins = new Map<string, DatasetOrigin>();
  if (datasetIds.length === 0) return origins;
  const jobs = await prisma.importJob.findMany({
    where: { datasetId: { in: datasetIds } },
    orderBy: { createdAt: "desc" },
    select: {
      datasetId: true,
      source: true,
      dataSourceId: true,
      createdAt: true,
      completedAt: true,
    },
  });
  for (const job of jobs) {
    if (!job.datasetId) continue;
    if (origins.has(job.datasetId)) continue;
    origins.set(job.datasetId, {
      source: job.source === "TABLE_SYNC" ? "TABLE_SYNC" : "UPLOAD",
      dataSourceId: job.dataSourceId,
      lastSyncAt: (job.completedAt ?? job.createdAt).toISOString(),
    });
  }
  return origins;
}

function chunkIDs(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += BATCH) out.push(ids.slice(i, i + BATCH));
  return out;
}

export function mapDatasetStatus(quality: "CLEAN" | "WARNINGS" | "ERROR") {
  switch (quality) {
    case "CLEAN":
      return "READY";
    case "WARNINGS":
      return "READY_WITH_WARNINGS";
    default:
      return "ERROR";
  }
}

export async function queryDatasets(organizationId: string, workspaceId: string) {
  const datasets = await prisma.dataset.findMany({
    where: { organizationId, workspaceId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      kind: true,
      status: true,
      rowCount: true,
      currentVersionId: true,
      sourceTable: true,
      createdAt: true,
    },
  });
  const origins = await resolveDatasetOrigins(datasets.map((dataset) => dataset.id));
  return datasets.map((dataset) => ({
    ...dataset,
    ...(origins.get(dataset.id) ?? { source: "UPLOAD", dataSourceId: null, lastSyncAt: null }),
  }));
}

function describeColumn(column: {
  id: string;
  name: string;
  type: string;
  ordinalPosition: number;
  isNullable: boolean;
  semanticKey: string | null;
  businessMeaning: string | null;
  representativeSample: unknown;
}) {
  return {
    id: column.id,
    name: column.name,
    type: column.type,
    ordinalPosition: column.ordinalPosition,
    isNullable: column.isNullable,
    semanticKey: column.semanticKey,
    businessMeaning: column.businessMeaning,
    representativeSample: column.representativeSample,
  };
}

export async function queryDatasetDetail(datasetId: string, organizationId: string) {
  const dataset = await prisma.dataset.findFirst({
    where: { id: datasetId, organizationId },
  });
  if (!dataset) return null;
  const origin = (await resolveDatasetOrigins([dataset.id])).get(dataset.id);
  const version = dataset.currentVersionId
    ? await prisma.datasetVersion.findUnique({
        where: { id: dataset.currentVersionId },
        select: { summary: true },
      })
    : null;
  const columns = dataset.currentVersionId
    ? await prisma.datasetColumn.findMany({
        where: { datasetId: dataset.id, datasetVersionId: dataset.currentVersionId },
        orderBy: { ordinalPosition: "asc" },
      })
    : [];
  const summary = (version?.summary ?? {}) as {
    pendingMappings?: Array<{ columnName: string; candidates: Array<PendingMappingCandidate> }>;
  };
  const columnsById = new Map(columns.map((column) => [column.name, column.id]));
  const pendingMappings = (summary.pendingMappings ?? [])
    .map((pending) => {
      const columnId = columnsById.get(pending.columnName);
      if (!columnId) return null;
      return {
        columnName: pending.columnName,
        datasetColumnId: columnId,
        candidates: pending.candidates,
      };
    })
    .filter((value): value is PendingMappingDTO => value !== null);
  return {
    id: dataset.id,
    name: dataset.name,
    kind: dataset.kind,
    status: dataset.status,
    rowCount: dataset.rowCount,
    currentVersionId: dataset.currentVersionId,
    sourceTable: dataset.sourceTable,
    createdAt: dataset.createdAt,
    source: (origin?.source ?? "UPLOAD") as "UPLOAD" | "TABLE_SYNC",
    dataSourceId: origin?.dataSourceId ?? null,
    lastSyncAt: origin?.lastSyncAt ?? null,
    columns: columns.map((column) => describeColumn(column)),
    pendingMappings,
  };
}

export async function queryDatasetVersions(datasetId: string, organizationId: string) {
  const belongs = await prisma.dataset.findFirst({
    where: { id: datasetId, organizationId },
    select: { id: true },
  });
  if (!belongs) return null;
  return prisma.datasetVersion.findMany({
    where: { datasetId },
    orderBy: { version: "desc" },
  });
}

export async function renameDataset(datasetId: string, organizationId: string, name: string) {
  const updated = await prisma.dataset.updateMany({
    where: { id: datasetId, organizationId },
    data: { name },
  });
  return updated.count === 1;
}

export async function confirmDatasetMapping(
  datasetId: string,
  organizationId: string,
  workspaceId: string,
  mappings: Array<{ datasetColumnId: string; semanticKey: string; businessMeaning: string }>,
) {
  return prisma.$transaction(
    async (tx) => {
      const dataset = await tx.dataset.findFirst({
        where: { id: datasetId, organizationId, workspaceId },
        select: { id: true, currentVersionId: true },
      });
      if (!dataset || !dataset.currentVersionId) {
        throw new AppError("NOT_FOUND", "Dataset not found or has no current version");
      }

    const pendingImport = await tx.importJob.findFirst({
      where: { datasetId, status: "REQUESTING_MAPPING" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!pendingImport) {
      throw new AppError("CONFLICT", "No mapping confirmation is pending for this dataset");
    }

    for (const mapping of mappings) {
      const column = await tx.datasetColumn.findFirst({
        where: {
          id: mapping.datasetColumnId,
          datasetId,
          datasetVersionId: dataset.currentVersionId,
        },
        select: { id: true },
      });
      if (!column) {
        throw new AppError("NOT_FOUND", "Dataset column not found for the current version");
      }
    }

    for (const mapping of mappings) {
      await tx.datasetColumn.update({
        where: { id: mapping.datasetColumnId },
        data: {
          semanticKey: mapping.semanticKey,
          businessMeaning: mapping.businessMeaning,
        },
      });

      const pendingRows = await tx.mappingSuggestion.findMany({
        where: { datasetId, columnId: mapping.datasetColumnId, status: "PENDING" },
        select: { id: true, semanticKey: true },
      });
      const rejected = pendingRows
        .filter((row) => row.semanticKey !== mapping.semanticKey)
        .map((row) => row.id);
      if (rejected.length > 0) {
        await tx.mappingSuggestion.updateMany({
          where: { id: { in: rejected } },
          data: { status: "REJECTED", updatedAt: new Date() },
        });
      }
      const confirmed = pendingRows.find(
        (row) => row.semanticKey === mapping.semanticKey,
      );
      if (confirmed) {
        await tx.mappingSuggestion.update({
          where: { id: confirmed.id },
          data: { status: "CONFIRMED", updatedAt: new Date() },
        });
      }
    }

    await tx.datasetVersion.update({
      where: { id: dataset.currentVersionId },
      data: { summary: {} as PrismaTypes.InputJsonValue },
    });

    const report = await tx.dataQualityReport.findFirst({
      where: { datasetId, datasetVersionId: dataset.currentVersionId },
      select: { status: true },
    });

    await tx.importJob.update({
      where: { id: pendingImport.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    await tx.dataset.update({
      where: { id: datasetId },
      data: { status: mapDatasetStatus(report?.status ?? "CLEAN") },
    });

    return { confirmed: true };
    },
    { timeout: 60_000 },
  );
}

export async function setImportStatus(
  importJobId: string,
  status: "QUEUED" | "RUNNING" | "REQUESTING_MAPPING" | "COMPLETED" | "FAILED",
  patch?: {
    datasetId?: string;
    totalRows?: number;
    processedRows?: number;
    error?: string | null;
    startedAt?: Date;
    completedAt?: Date;
  },
): Promise<void> {
  await prisma.importJob.update({
    where: { id: importJobId },
    data: { status, ...(patch ?? {}) },
  });
}