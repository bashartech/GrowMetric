import type { DataSource, ImportJob, ImportFile, DataSourceCredential } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { storage, buildStorageKey } from "../../lib/storage.js";
import { computeChecksum, validateUploadedFile } from "../../lib/files.js";
import { AppError } from "../../lib/http-errors.js";
import { record } from "../audit/audit.service.js";
import { recordUsage } from "../entitlements/entitlement.service.js";
import {
  decryptCredentialsObject,
  encryptCredentials,
  buildCredentialsObject,
  isEncryptedData,
} from "../../lib/crypto.js";
import {
  connectReadOnly,
  discoverTables,
  parseConnectionUrl,
  type ExternalDbConfig,
} from "../../lib/external-db.js";
import type {
  CreateFileSourceInput,
  CreateExternalDbSourceInput,
  UpdateDataSourceInput,
  UpdateTableSelectionInput,
} from "./data-source.schema.js";

interface CreateFileSourceParams {
  organizationId: string;
  workspaceId: string;
  createdById: string;
  input: CreateFileSourceInput;
  file: {
    buffer: Buffer;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
  };
}

interface CreateFileSourceResult {
  dataSource: DataSource;
  import: ImportJob;
  file: ImportFile;
}

export async function createFileSource(
  params: CreateFileSourceParams,
): Promise<CreateFileSourceResult> {
  // Validate file
  await validateUploadedFile(params.file.originalName, params.file.buffer);

  // Check entitlement
  await recordUsage(params.organizationId, "data_sources", 1);

  // Store file (I/O kept outside the DB transaction)
  const fileChecksum = computeChecksum(params.file.buffer);
  const storageKey = buildStorageKey(
    params.organizationId,
    "pending",
    fileChecksum.slice(0, 16),
  );
  await storage.put(storageKey, params.file.buffer);

  try {
    // Create records atomically. The interactive transaction timeout is
    // raised well above the default 5s to tolerate pooled-connection latency.
    const result = await prisma.$transaction(
      async (tx) => {
        // Create data source
        const dataSource = await tx.dataSource.create({
          data: {
            organizationId: params.organizationId,
            workspaceId: params.workspaceId,
            name: params.input.name,
            kind: "FILE",
            status: "NEW",
            createdById: params.createdById,
          },
        });

        // Create import file record
        const importFile = await tx.importFile.create({
          data: {
            dataSourceId: dataSource.id,
            originalName: params.file.originalName,
            storageKey,
            mimeType: params.file.mimeType,
            sizeBytes: params.file.sizeBytes,
            checksum: fileChecksum,
          },
        });

        // Create job
        const job = await tx.job.create({
          data: {
            organizationId: params.organizationId,
            type: "IMPORT_DATA",
            status: "PENDING",
            runAt: new Date(),
            payload: {
              commit: "APPEND",
              datasetName: params.input.name,
            },
          },
        });

        // Create import job
        const importJob = await tx.importJob.create({
          data: {
            organizationId: params.organizationId,
            workspaceId: params.workspaceId,
            jobId: job.id,
            dataSourceId: dataSource.id,
            fileId: importFile.id,
            source: "UPLOAD",
            status: "QUEUED",
            filename: params.file.originalName,
          },
        });

        // Complete the job payload with the import job id
        await tx.job.update({
          where: { id: job.id },
          data: {
            payload: {
              importJobId: importJob.id,
              commit: "APPEND",
              datasetName: params.input.name,
            },
          },
        });

        // Record audit within the same transaction
        await record(
          {
            organizationId: params.organizationId,
            workspaceId: params.workspaceId,
            actorUserId: params.createdById,
            action: "data-source.create",
            resourceType: "DataSource",
            resourceId: dataSource.id,
            metadata: {
              name: dataSource.name,
              kind: dataSource.kind,
              filename: params.file.originalName,
            },
          },
          tx,
        );

        return { dataSource, import: importJob, file: importFile };
      },
      { timeout: 60_000 },
    );

    // Record import creation outside the transaction
    await recordUsage(params.organizationId, "imports", 1).catch(
      () => undefined,
    );

    return result;
  } catch (error) {
    // Best-effort cleanup of the stored object on failure
    await storage.delete(storageKey).catch(() => undefined);
    throw error;
  }
}

export async function listDataSources(
  organizationId: string,
  workspaceId: string,
) {
  return prisma.dataSource.findMany({
    where: {
      organizationId,
      workspaceId,
    },
    include: {
      _count: {
        select: {
          imports: true,
          datasets: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getDataSource(
  id: string,
  organizationId: string,
  workspaceId: string,
) {
  const dataSource = await prisma.dataSource.findFirst({
    where: {
      id,
      organizationId,
      workspaceId,
    },
    include: {
      tables: true,
      _count: {
        select: {
          imports: true,
          datasets: true,
        },
      },
    },
  });

  if (!dataSource) {
    throw new AppError("NOT_FOUND", "Data source not found");
  }

  return dataSource;
}

export async function updateDataSource(
  id: string,
  organizationId: string,
  workspaceId: string,
  input: UpdateDataSourceInput,
) {
  const existing = await getDataSource(id, organizationId, workspaceId);

  const updated = await prisma.dataSource.update({
    where: { id: existing.id },
    data: input,
  });

  return updated;
}

export async function deleteDataSource(
  id: string,
  organizationId: string,
  workspaceId: string,
  actorUserId: string,
) {
  const existing = await getDataSource(id, organizationId, workspaceId);

  await prisma.dataSource.delete({
    where: { id: existing.id },
  });

  await record({
    organizationId,
    workspaceId,
    actorUserId,
    action: "data-source.delete",
    resourceType: "DataSource",
    resourceId: existing.id,
    metadata: { name: existing.name },
  });

  return { deleted: true };
}

interface CreateExternalDbSourceParams {
  organizationId: string;
  workspaceId: string;
  createdById: string;
  input: CreateExternalDbSourceInput;
}

export async function createExternalDbSource(
  params: CreateExternalDbSourceParams,
): Promise<DataSource> {
  // Check entitlement
  await recordUsage(params.organizationId, "data_sources", 1);

  const parsed = normalizeExternalDbHost(params.input.host)
    ? parseConnectionUrl(params.input.host, {
        port: params.input.port,
        database: params.input.database,
        sslMode: params.input.sslMode,
      })
    : null;

  const host = parsed?.host ?? params.input.host;
  const credentials = buildCredentialsObject(
    host,
    parsed?.port ?? params.input.port,
    parsed?.database ?? params.input.database,
    parsed?.username ?? params.input.username,
    parsed?.password ?? params.input.password,
    params.input.sslMode,
  );
  const encryptedData = await encryptCredentials(credentials);
  const encryptedPayload = JSON.stringify(encryptedData);

  const config: ExternalDbConfig = {
    host,
    port: parsed?.port ?? params.input.port,
    database: parsed?.database ?? params.input.database,
    username: parsed?.username ?? params.input.username,
    password: parsed?.password ?? params.input.password,
    sslMode: parsed?.sslMode ?? params.input.sslMode,
  };

  const driver = await connectReadOnly(config);
  config.password = "";

  try {
    const discovered = await discoverTables(driver);

    const result = await prisma.$transaction(
      async (tx) => {
        const dataSource = await tx.dataSource.create({
          data: {
            organizationId: params.organizationId,
            workspaceId: params.workspaceId,
            name: params.input.name,
            kind: "EXTERNAL_DB",
            status: "CONNECTED",
            createdById: params.createdById,
          },
        });

        await tx.dataSourceCredential.create({
          data: {
            dataSourceId: dataSource.id,
            engine: "POSTGRES",
            host,
            port: parsed?.port ?? params.input.port,
            database: parsed?.database ?? params.input.database,
            username: parsed?.username ?? params.input.username,
            passwordEnc: encryptedPayload,
            sslMode: params.input.sslMode,
          },
        });

        for (const table of discovered) {
          await tx.dataSourceTable.create({
            data: {
              dataSourceId: dataSource.id,
              schemaName: table.schemaName,
              tableName: table.tableName,
              columnCount: table.columnCount,
              rowEstimate: table.rowEstimate,
              isSelected: false,
            },
          });
        }

        await record(
          {
            organizationId: params.organizationId,
            workspaceId: params.workspaceId,
            actorUserId: params.createdById,
            action: "data-source.create",
            resourceType: "DataSource",
            resourceId: dataSource.id,
            metadata: {
              name: dataSource.name,
              kind: dataSource.kind,
              host,
              database: parsed?.database ?? params.input.database,
            },
          },
          tx,
        );

        return dataSource;
      },
      { timeout: 60_000 },
    );

    return result;
  } finally {
    await driver.end().catch(() => undefined);
  }
}

const normalizeExternalDbHost = (host: string): boolean =>
  /^postgres(?:ql)?:\/\//i.test(host.trim());

async function resolveExternalDbConfig(
  dataSource: DataSource & { credential: DataSourceCredential | null },
): Promise<ExternalDbConfig> {
  if (dataSource.kind !== "EXTERNAL_DB") {
    throw new AppError("VALIDATION_ERROR", "Data source is not an external database");
  }
  if (!dataSource.credential) {
    throw new AppError("EXT_DB_CONNECTION_FAILED", "Credentials not found");
  }

  const parsed: unknown = JSON.parse(dataSource.credential.passwordEnc);
  if (!isEncryptedData(parsed)) {
    throw new AppError(
      "EXT_DB_CONNECTION_FAILED",
      "Stored credentials are corrupted or in an unsupported format",
    );
  }
  const credentials = await decryptCredentialsObject(parsed);

  return {
    host: credentials.host,
    port: credentials.port,
    database: credentials.database,
    username: credentials.username,
    password: credentials.password,
    sslMode: credentials.sslMode,
  };
}

export async function listDataSourceTables(
  id: string,
  organizationId: string,
  workspaceId: string,
) {
  const dataSource = await prisma.dataSource.findFirst({
    where: {
      id,
      organizationId,
      workspaceId,
    },
    include: {
      credential: true,
      tables: true,
    },
  });

  if (!dataSource) {
    throw new AppError("NOT_FOUND", "Data source not found");
  }

  const config = await resolveExternalDbConfig(dataSource);
  const driver = await connectReadOnly(config);
  try {
    const discovered = await discoverTables(driver);

    const existing = await prisma.dataSourceTable.findMany({
      where: { dataSourceId: id },
    });
    const existingKeys = new Set(
      existing.map((table) => `${table.schemaName}.${table.tableName}`),
    );

    const missing = discovered.filter(
      (table) => !existingKeys.has(`${table.schemaName}.${table.tableName}`),
    );
    if (missing.length > 0) {
      await prisma.dataSourceTable.createMany({
        data: missing.map((table) => ({
          dataSourceId: id,
          schemaName: table.schemaName,
          tableName: table.tableName,
          columnCount: table.columnCount,
          rowEstimate: table.rowEstimate,
          isSelected: false,
        })),
        skipDuplicates: true,
      });
    }

    for (const table of discovered) {
      if (existingKeys.has(`${table.schemaName}.${table.tableName}`)) {
        await prisma.dataSourceTable.updateMany({
          where: { dataSourceId: id, schemaName: table.schemaName, tableName: table.tableName },
          data: {
            columnCount: table.columnCount,
            rowEstimate: table.rowEstimate,
          },
        });
      }
    }

    return prisma.dataSourceTable.findMany({
      where: { dataSourceId: id },
      orderBy: [{ schemaName: "asc" }, { tableName: "asc" }],
    });
  } finally {
    await driver.end().catch(() => undefined);
  }
}

export async function syncDataSource(
  id: string,
  organizationId: string,
  workspaceId: string,
): Promise<{ imports: ImportJob[] }> {
  const dataSource = await prisma.dataSource.findFirst({
    where: { id, organizationId, workspaceId },
    include: { credential: true },
  });
  if (!dataSource) {
    throw new AppError("NOT_FOUND", "Data source not found");
  }

  const config = await resolveExternalDbConfig(dataSource);
  const driver = await connectReadOnly(config);
  try {
    const existing = await prisma.dataSourceTable.findMany({
      where: { dataSourceId: id, isSelected: true },
      orderBy: [{ schemaName: "asc" }, { tableName: "asc" }],
    });
    if (existing.length === 0) {
      throw new AppError("BAD_REQUEST", "No tables selected for sync");
    }

    const discovered = await discoverTables(driver);

    const imports: ImportJob[] = [];
    for (const table of existing) {
      const discoveredTable = discovered.find(
        (candidate) =>
          candidate.schemaName === table.schemaName && candidate.tableName === table.tableName,
      );

      const job = await prisma.job.create({
        data: {
          organizationId,
          type: "SYNC_DATABASE",
          status: "PENDING",
          runAt: new Date(),
          payload: {
            dataSourceId: id,
            table: { schemaName: table.schemaName, tableName: table.tableName },
            columnCount: discoveredTable?.columnCount ?? table.columnCount,
            rowEstimate: discoveredTable?.rowEstimate ?? table.rowEstimate,
          },
        },
      });

      const importJob = await prisma.importJob.create({
        data: {
          organizationId,
          workspaceId,
          jobId: job.id,
          dataSourceId: id,
          source: "TABLE_SYNC",
          status: "QUEUED",
          filename: `${table.schemaName}.${table.tableName}`,
        },
      });

      await prisma.job.update({
        where: { id: job.id },
        data: { payload: { ...(job.payload as object), importJobId: importJob.id } },
      });

      imports.push(importJob);
    }

    await prisma.dataSource.update({
      where: { id },
      data: { lastSyncAt: new Date() },
    });

    return { imports };
  } finally {
    await driver.end().catch(() => undefined);
  }
}

export async function updateTableSelection(
  id: string,
  organizationId: string,
  workspaceId: string,
  input: UpdateTableSelectionInput,
) {
  const dataSource = await prisma.dataSource.findFirst({
    where: {
      id,
      organizationId,
      workspaceId,
    },
  });

  if (!dataSource) {
    throw new AppError("NOT_FOUND", "Data source not found");
  }

  if (dataSource.kind !== "EXTERNAL_DB") {
    throw new AppError("VALIDATION_ERROR", "Data source is not an external database");
  }

  // Update table selections
  for (const table of input.tables) {
    await prisma.dataSourceTable.updateMany({
      where: {
        dataSourceId: id,
        schemaName: table.schemaName,
        tableName: table.tableName,
      },
      data: {
        isSelected: table.isSelected,
        ...(table.syncMode !== undefined && table.isSelected
          ? { syncMode: table.syncMode }
          : {}),
        ...(table.upsertKeyColumnName !== undefined && table.isSelected
          ? { upsertKeyColumnName: table.upsertKeyColumnName || null }
          : {}),
      },
    });
  }

  return getDataSource(id, organizationId, workspaceId);
}
