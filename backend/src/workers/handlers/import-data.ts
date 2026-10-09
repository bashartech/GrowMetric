import type { DatasetKind, Job } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { storage } from "../../lib/storage.js";
import { parseSpreadsheet } from "../../lib/parser.js";
import { profileColumns, parseValue } from "../../lib/infer.js";
import { mapColumns } from "../../lib/mapping-rules.js";
import { computeQuality } from "../../lib/quality.js";
import { completeJob, enqueueJob, failJob } from "../../jobs/queue.js";
import { isAiEnabled } from "../../config/env.js";
import { createVersionedDataset, setImportStatus } from "../../modules/datasets/dataset.repo.js";
import { ensureDefaultDashboard } from "../../modules/dashboards/dashboard.service.js";
import { logger } from "../../lib/logger.js";
import type { VersionedCell } from "../../modules/datasets/dataset.types.js";

export interface ImportDataPayload {
  importJobId: string;
  commit: "APPEND" | "REPLACE" | "UPSERT";
  upsertKeyColumnName?: string | null;
  datasetName?: string | null;
}

function inferKind(semanticKeys: Array<string | null | undefined>): DatasetKind | undefined {
  const present = new Set(semanticKeys.filter(Boolean) as string[]);
  if (present.has("revenue") || present.has("orders")) return "SALES";
  if (present.has("customers")) return "CUSTOMERS";
  if (present.has("inventory")) return "INVENTORY";
  if (present.has("products")) return "PRODUCTS";
  if (present.has("expenses")) return "EXPENSES";
  return undefined;
}

function baseName(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

export async function processImportDataJob(job: Job): Promise<void> {
  const payload = (job.payload ?? {}) as unknown as ImportDataPayload;
  const importJobId = payload.importJobId;
  if (!importJobId) {
    await failJob(job.id, "Import job payload is missing importJobId.");
    return;
  }

  await setImportStatus(importJobId, "RUNNING", { startedAt: new Date() });

  logger.info(
    { importJobId, commit: payload.commit, datasetName: payload.datasetName ?? null },
    "Import job started.",
  );

  try {
    const importJob = await prisma.importJob.findUnique({
      where: { id: importJobId },
      include: { file: true },
    });
    if (!importJob || !importJob.file) {
      throw new Error(`Import job ${importJobId} has no associated import file.`);
    }

    const key = importJob.file.storageKey;
    const fileBuffer = await storage.getObject(key);
    if (!fileBuffer) {
      throw new Error(`Import file could not be read from storage (${key}).`);
    }

    const parsed = await parseSpreadsheet(fileBuffer, importJob.filename);

    const profiles = profileColumns(parsed.headers, parsed.rows);
    const mappings = mapColumns(
      parsed.headers,
      profiles.map((profile) => profile.type),
    );

    const columns = profiles.map((profile, index) => {
      const mapping = mappings[index] ?? null;
      // Record the best guess even when it is too uncertain to auto-apply, so a
      // reviewer sees what the system thinks the column means. This cannot leak
      // into a metric: when any column needs confirmation the dataset is forced
      // back to DRAFT below, and analytics only ever reads READY datasets. A
      // confirmed mapping overwrites this value.
      const best = mapping?.best ?? null;
      return {
        name: profile.name,
        type: profile.type,
        isNullable: profile.isNullable,
        ordinalPosition: index,
        semanticKey: best?.semanticKey ?? null,
        businessMeaning: best?.businessMeaning ?? null,
        representativeSample: profile.sample,
      };
    });

    const rows: VersionedCell[][] = parsed.rows.map((row) =>
      profiles.map((profile, index) => {
        const parsedCell = parseValue(row[index] ?? "", profile.type);
        return {
          columnName: profile.name,
          columnType: profile.type,
          value: parsedCell.ok ? (parsedCell.value ?? null) : null,
        };
      }),
    );

    const quality = computeQuality({ rows: parsed.rows, columns: profiles });

const requiresConfirmation = mappings.some(
    (mapping) => mapping.requiresConfirmation,
  );

  const pendingMappings = mappings
    .filter((mapping) => mapping.requiresConfirmation)
    .map((mapping) => ({
      columnName: mapping.columnName,
      candidates: mapping.candidates
        .slice(0, 4)
        .map((candidate) => ({
          semanticKey: candidate.semanticKey,
          businessMeaning: candidate.businessMeaning,
          confidence: candidate.confidence,
        })),
    }));

  if (requiresConfirmation && pendingMappings.length === 0) {
    // Defensive: if the handler flags confirmation but no candidates were
    // persisted, treat the import as completed rather than stalling forever.
    logger.warn(
      { importJobId, filename: importJob.filename },
      "Mapping confirmation requested but no candidate list could be built.",
    );
  }

  const { datasetId, versionId } = await createVersionedDataset({
    organizationId: importJob.organizationId,
    workspaceId: importJob.workspaceId,
    dataSourceId: importJob.dataSourceId,
    datasetName: payload.datasetName ?? baseName(importJob.filename),
    datasetKind: inferKind(columns.map((column) => column.semanticKey)),
    sourceTable: parsed.sheetName,
    source: importJob.source,
    commit: payload.commit,
    importJobId: importJob.id,
    existingDatasetId: importJob.datasetId,
    upsertKeyColumnName: payload.upsertKeyColumnName,
    columns,
    rows,
    pendingMappings: requiresConfirmation ? pendingMappings : undefined,
    quality: {
      totalRows: quality.totalRows,
      columnCount: quality.columnCount,
      missingValuePct: quality.missingValuePct,
      duplicateRowPct: quality.duplicateRowPct,
      invalidNumberPct: quality.invalidNumberPct,
      invalidDatePct: quality.invalidDatePct,
      numericOutlierCount: quality.numericOutlierCount,
      status: quality.status,
      detail: quality.warnings,
    },
  });

    const unresolved = mappings.filter(
      (mapping) => mapping.requiresConfirmation || mapping.best === null,
    );

    if (unresolved.length > 0) {
      const createdColumns = await prisma.datasetColumn.findMany({
        where: { datasetVersionId: versionId },
        select: { id: true, name: true },
      });
      const columnIdByName = new Map(createdColumns.map((column) => [column.name, column.id]));
      const aiEnabled = isAiEnabled();

      for (const mapping of unresolved) {
        const columnId = columnIdByName.get(mapping.columnName);
        if (!columnId) continue;

        if (mapping.candidates.length > 0) {
          await prisma.mappingSuggestion.createMany({
            data: mapping.candidates.slice(0, 4).map((candidate) => ({
              organizationId: importJob.organizationId,
              workspaceId: importJob.workspaceId,
              importJobId,
              datasetId,
              columnId,
              semanticKey: candidate.semanticKey,
              businessMeaning: candidate.businessMeaning,
              source: "RULES",
              status: "PENDING",
              confidence: new Prisma.Decimal(candidate.confidence),
            })),
          });
        }

        if (aiEnabled) {
          await enqueueJob({
            type: "SUGGEST_MAPPING",
            payload: { importJobId, columnId },
            organizationId: importJob.organizationId,
          });
        }
      }
    }

    if (requiresConfirmation) {
      await prisma.dataset.update({
        where: { id: datasetId },
        data: { status: "DRAFT" },
      });
    } else {
      await ensureDefaultDashboard(
        importJob.organizationId,
        importJob.workspaceId,
        datasetId,
      );
    }

    await setImportStatus(importJobId, requiresConfirmation ? "REQUESTING_MAPPING" : "COMPLETED", {
      datasetId,
      totalRows: quality.totalRows,
      processedRows: quality.totalRows,
      ...(requiresConfirmation ? {} : { completedAt: new Date() }),
    });

    logger.info(
      { importJobId, datasetId, versionId, rows: quality.totalRows, requiresConfirmation },
      "Import job completed.",
    );
    await completeJob(job.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown import failure.";
    await setImportStatus(importJobId, "FAILED", { error: message, completedAt: new Date() });
    logger.error({ importJobId, error }, "Import job failed.");
    await failJob(job.id, message);
  }
}