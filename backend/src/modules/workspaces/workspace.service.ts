import { AppError } from "../../lib/http-errors.js";
import { prisma } from "../../lib/prisma.js";
import { record } from "../audit/audit.service.js";
import type { RequestMeta } from "../auth/auth.types.js";

export async function listWorkspaces(organizationId: string) {
  return prisma.workspace.findMany({
    where: { organizationId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
}

export async function getCurrentWorkspace(organizationId: string) {
  const workspace = await prisma.workspace.findFirst({
    where: { organizationId },
    orderBy: { isDefault: "desc" },
  });

  if (!workspace) {
    throw new AppError("NOT_FOUND", "No workspace found for this organization");
  }

  return workspace;
}

export async function updateWorkspace(
  organizationId: string,
  actorUserId: string,
  workspaceId: string,
  name: string,
  meta: RequestMeta,
) {
  const existing = await prisma.workspace.findFirst({
    where: { id: workspaceId, organizationId },
  });

  if (!existing) {
    throw new AppError("NOT_FOUND", "Workspace not found");
  }

  const workspace = await prisma.workspace.update({
    where: { id: existing.id },
    data: { name },
  });

  await record({
    organizationId,
    workspaceId: workspace.id,
    actorUserId,
    action: "workspace.update",
    resourceType: "workspace",
    resourceId: workspace.id,
    metadata: { name },
    ipAddress: meta.ip,
    userAgent: meta.userAgent,
  });

  return workspace;
}
