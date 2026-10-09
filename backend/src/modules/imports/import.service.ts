import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/http-errors.js";

export async function listImports(
  organizationId: string,
  workspaceId: string,
  filters?: {
    status?: string;
    dataSourceId?: string;
    page?: number;
    pageSize?: number;
  },
) {
  const page = Math.max(1, filters?.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters?.pageSize ?? 25));

  const where = {
    organizationId,
    workspaceId,
    ...(filters?.status ? { status: filters.status as any } : {}),
    ...(filters?.dataSourceId ? { dataSourceId: filters.dataSourceId } : {}),
  };

  const [imports, total] = await Promise.all([
    prisma.importJob.findMany({
      where,
      include: {
        dataSource: {
          select: {
            id: true,
            name: true,
            kind: true,
          },
        },
        dataset: {
          select: { id: true, name: true, status: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.importJob.count({ where }),
  ]);

  return { imports, total, page, pageSize };
}

export async function getImport(
  id: string,
  organizationId: string,
  workspaceId: string,
) {
  const importJob = await prisma.importJob.findFirst({
    where: {
      id,
      organizationId,
      workspaceId,
    },
    include: {
      dataSource: {
        select: {
          id: true,
          name: true,
          kind: true,
        },
      },
      dataset: {
        select: {
          id: true,
          name: true,
          status: true,
        },
      },
      job: {
        select: {
          status: true,
          attempts: true,
          lastError: true,
        },
      },
    },
  });

  if (!importJob) {
    throw new AppError("NOT_FOUND", "Import not found");
  }

  return importJob;
}

export async function cancelImport(
  id: string,
  organizationId: string,
  workspaceId: string,
) {
  const importJob = await getImport(id, organizationId, workspaceId);

  if (!["QUEUED", "RUNNING"].includes(importJob.status)) {
    throw new AppError(
      "CONFLICT",
      "Only queued or running imports can be cancelled",
    );
  }

  // Update import status
  await prisma.importJob.update({
    where: { id },
    data: {
      status: "FAILED",
      error: "Cancelled by user",
      completedAt: new Date(),
    },
  });

  // Update job status
  await prisma.job.update({
    where: { id: importJob.jobId },
    data: {
      status: "FAILED",
      lastError: "Cancelled by user",
    },
  });

  return { cancelled: true };
}

export async function retryImport(
  id: string,
  organizationId: string,
  workspaceId: string,
) {
  const importJob = await getImport(id, organizationId, workspaceId);

  if (importJob.status !== "FAILED") {
    throw new AppError(
      "CONFLICT",
      "Only failed imports can be retried",
    );
  }

  // Create new job for retry
  const newJob = await prisma.job.create({
    data: {
      organizationId,
      type: "IMPORT_DATA",
      payload: {
        importJobId: id,
        commit: "APPEND",
        datasetName: importJob.filename.replace(/\.[^.]+$/, ""),
      },
      status: "PENDING",
    },
  });

  // Update import job
  await prisma.importJob.update({
    where: { id },
    data: {
      jobId: newJob.id,
      status: "QUEUED",
      error: null,
      startedAt: null,
      completedAt: null,
    },
  });

  return { retried: true, importId: id };
}
