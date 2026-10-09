import type { Job } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { profileColumns, parseValue } from "../../lib/infer.js";
import { mapColumns, isAutoApplicable } from "../../lib/mapping-rules.js";
import { computeQuality } from "../../lib/quality.js";
import { completeJob, failJob } from "../../jobs/queue.js";
import { env } from "../../config/env.js";
import { decryptCredentialsObject, type EncryptedData } from "../../lib/crypto.js";
import {
  connectReadOnly,
  streamSelect,
  listColumns,
  externalValueToString,
} from "../../lib/external-db.js";
import { createVersionedDataset, setImportStatus } from "../../modules/datasets/dataset.repo.js";
import { ensureDefaultDashboard } from "../../modules/dashboards/dashboard.service.js";
import { logger } from "../../lib/logger.js";
import type { VersionedCell } from "../../modules/datasets/dataset.types.js";

interface SyncDatabasePayload {
  dataSourceId: string;
  importJobId?: string;
  table?: { schemaName: string; tableName: string };
}

function sourceTableLabel(schemaName: string, tableName: string): string {
  return `${schemaName}.${tableName}`;
}

export async function processSyncDatabaseJob(job: Job): Promise<void> {
  const payload = (job.payload ?? {}) as unknown as SyncDatabasePayload;
  const { dataSourceId, importJobId, table } = payload;

  if (!dataSourceId || !importJobId || !table) {
    await failJob(job.id, "Sync job payload is missing dataSourceId, importJobId, or table.");
    return;
  }

  await setImportStatus(importJobId, "RUNNING", { startedAt: new Date() });

  try {
    const dataSource = await prisma.dataSource.findUnique({
      where: { id: dataSourceId },
      include: { credential: true },
    });
    if (!dataSource?.credential) {
      throw new Error(`External data source ${dataSourceId} has no stored credentials.`);
    }

    const sourceTableRow = await prisma.dataSourceTable.findFirst({
      where: { dataSourceId, schemaName: table.schemaName, tableName: table.tableName },
    });
    const syncMode = sourceTableRow?.syncMode === "UPSERT" ? "UPSERT" : "REPLACE";
    const upsertKeyColumnName = sourceTableRow?.upsertKeyColumnName ?? undefined;

    const config = await decryptCredentialsObject(
      JSON.parse(dataSource.credential.passwordEnc) as EncryptedData,
    );

    const driver = await connectReadOnly(config);
    try {
      const columns = await listColumns(driver, table.schemaName, table.tableName);
      const headers = columns.map((column) => column.name);

      const rows: string[][] = [];
      await streamSelect(
        driver,
        table.schemaName,
        table.tableName,
        env.IMPORT_ROW_CAP,
        (row) => {
          rows.push(headers.map((name) => externalValueToString(row[name])));
        },
      );

      const profiles = profileColumns(headers, rows);
      const mappings = mapColumns(
        headers,
        profiles.map((profile) => profile.type),
      );

      const datasetColumns = profiles.map((profile, index) => {
        const mapping = mappings[index] ?? null;
        const best = mapping && isAutoApplicable(mapping) ? mapping.best : null;
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

      const versionedRows: VersionedCell[][] = rows.map((row) =>
        profiles.map((profile, index) => {
          const parsedCell = parseValue(row[index] ?? "", profile.type);
          return {
            columnName: profile.name,
            columnType: profile.type,
            value: parsedCell.ok ? (parsedCell.value ?? null) : null,
          };
        }),
      );

      const quality = computeQuality({ rows, columns: profiles });

      const sourceTable = sourceTableLabel(table.schemaName, table.tableName);
      const existingDataset = await prisma.dataset.findFirst({
        where: { dataSourceId, sourceTable },
        select: { id: true },
      });

      const { datasetId } = await createVersionedDataset({
        organizationId: dataSource.organizationId,
        workspaceId: dataSource.workspaceId,
        dataSourceId,
        datasetName: table.tableName,
        datasetKind: undefined,
        sourceTable,
        source: "TABLE_SYNC",
        commit: syncMode,
        upsertKeyColumnName,
        importJobId,
        existingDatasetId: existingDataset?.id,
        columns: datasetColumns,
        rows: versionedRows,
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

      await ensureDefaultDashboard(
        dataSource.organizationId,
        dataSource.workspaceId,
        datasetId,
      );

      await setImportStatus(importJobId, "COMPLETED", {
        datasetId,
        totalRows: quality.totalRows,
        processedRows: quality.totalRows,
        completedAt: new Date(),
      });

      logger.info(
        { jobId: job.id, importJobId, datasetId, sourceTable, rows: quality.totalRows },
        "External DB sync completed.",
      );
      await completeJob(job.id);
    } finally {
      await driver.end().catch(() => undefined);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown sync failure.";
    await setImportStatus(importJobId, "FAILED", { error: message, completedAt: new Date() });
    logger.error({ jobId: job.id, importJobId, error }, "External DB sync failed.");
    await failJob(job.id, message);
  }
}