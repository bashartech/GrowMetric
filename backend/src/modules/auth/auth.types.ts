import type { Organization, User, Workspace } from "@prisma/client";
import type { Request } from "express";

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

export function requestMeta(req: Request): RequestMeta {
  const userAgent = req.headers["user-agent"];
  return {
    ip: req.ip,
    userAgent: typeof userAgent === "string" ? userAgent : undefined,
  };
}

export function toUserDTO(user: User) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toOrganizationDTO(organization: Organization) {
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    createdAt: organization.createdAt.toISOString(),
  };
}

export function toWorkspaceDTO(workspace: Workspace) {
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    isDefault: workspace.isDefault,
  };
}
