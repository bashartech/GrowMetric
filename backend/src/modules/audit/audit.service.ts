import type { Prisma, PrismaClient } from "@prisma/client";
import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";

type AuditClient = Pick<PrismaClient, "auditLog">;

export interface AuditInput {
  organizationId: string;
  workspaceId?: string | null;
  actorUserId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Prisma.InputJsonValue | undefined;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const SENSITIVE_KEY = /pass|token|secret|authorization|cookie|hash|credential/i;

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) continue;
      result[key] = sanitizeValue(nested);
    }
    return result;
  }
  return value;
}

export function sanitizeMetadata(
  metadata: Prisma.InputJsonValue | undefined,
): Prisma.InputJsonValue | undefined {
  if (metadata === undefined) return undefined;
  return sanitizeValue(metadata) as Prisma.InputJsonValue;
}

export function buildAuditData(input: AuditInput) {
  return {
    organizationId: input.organizationId,
    workspaceId: input.workspaceId ?? null,
    actorUserId: input.actorUserId ?? null,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    metadata: sanitizeMetadata(input.metadata),
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  };
}

export async function record(
  input: AuditInput,
  client: AuditClient = prisma,
): Promise<void> {
  try {
    await client.auditLog.create({ data: buildAuditData(input) });
  } catch (error) {
    logger.error(
      { err: error, action: input.action },
      "Failed to write audit log",
    );
    throw error;
  }
}

export interface ListAuditLogsOptions {
  page: number;
  pageSize: number;
  action?: string;
}

export async function listAuditLogs(
  organizationId: string,
  { page, pageSize, action }: ListAuditLogsOptions,
) {
  const where = {
    organizationId,
    ...(action ? { action } : {}),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { actor: { select: { id: true, name: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      actor: row.actor ? { id: row.actor.id, name: row.actor.name } : null,
      workspaceId: row.workspaceId,
      ipAddress: row.ipAddress,
      createdAt: row.createdAt.toISOString(),
    })),
    page,
    pageSize,
    total,
  };
}
