import type { Request } from "express";
import { asyncHandler } from "../lib/async-handler.js";
import { AppError } from "../lib/http-errors.js";
import { prisma } from "../lib/prisma.js";

export interface TenantContext {
  organizationId: string;
  workspaceId: string;
}

export function requireTenant(req: { tenant?: TenantContext }): TenantContext {
  if (!req.tenant) {
    throw new AppError("UNAUTHENTICATED");
  }
  return req.tenant;
}

export const tenantGuard = asyncHandler(async (req: Request, _res, next) => {
  if (!req.user) {
    throw new AppError("UNAUTHENTICATED");
  }

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) {
    throw new AppError("UNAUTHENTICATED");
  }

  const workspace = await prisma.workspace.findFirst({
    where: { organizationId: user.organizationId },
    orderBy: { isDefault: "desc" },
  });

  if (!workspace) {
    throw new AppError("NOT_FOUND", "No workspace found for this organization");
  }

  req.tenant = {
    organizationId: user.organizationId,
    workspaceId: workspace.id,
  };

  next();
});
