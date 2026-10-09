import { AppError } from "../../lib/http-errors.js";
import { prisma } from "../../lib/prisma.js";
import { record } from "../audit/audit.service.js";
import type { RequestMeta } from "../auth/auth.types.js";

export async function getCurrentOrganization(organizationId: string) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
  });

  if (!organization) {
    throw new AppError("NOT_FOUND", "Organization not found");
  }

  return organization;
}

export async function updateCurrentOrganization(
  organizationId: string,
  actorUserId: string,
  name: string,
  meta: RequestMeta,
) {
  const organization = await prisma.organization.update({
    where: { id: organizationId },
    data: { name },
  });

  await record({
    organizationId,
    actorUserId,
    action: "org.update",
    resourceType: "organization",
    resourceId: organizationId,
    metadata: { name },
    ipAddress: meta.ip,
    userAgent: meta.userAgent,
  });

  return organization;
}
