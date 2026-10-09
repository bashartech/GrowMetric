import { prisma } from "./prisma.js";
import { AppError } from "./http-errors.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * Resolves the workspace a request should operate on.
 *
 * A caller-supplied `workspaceId` is honoured only when it is a syntactically
 * valid UUID that belongs to `organizationId`; otherwise the organization's
 * default workspace is used. This keeps list endpoints working when the query
 * parameter is absent or malformed, and prevents one tenant from addressing
 * another tenant's workspace by guessing an id.
 */
export async function resolveWorkspaceId(
  organizationId: string,
  candidate?: string | null,
): Promise<string> {
  if (isUuid(candidate)) {
    const owned = await prisma.workspace.findFirst({
      where: { id: candidate, organizationId },
      select: { id: true },
    });
    if (owned) {
      return owned.id;
    }
  }

  const fallback = await prisma.workspace.findFirst({
    where: { organizationId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true },
  });

  if (!fallback) {
    throw new AppError(
      "NOT_FOUND",
      "No workspace found for this organization",
    );
  }

  return fallback.id;
}

/**
 * Reads the workspace from an Express request, preferring the explicit query
 * parameter and falling back to the workspace `tenantGuard` already resolved.
 */
export function requestedWorkspaceId(queryValue: unknown): string | undefined {
  if (typeof queryValue === "string" && queryValue.length > 0) {
    return queryValue;
  }
  if (Array.isArray(queryValue) && typeof queryValue[0] === "string") {
    return queryValue[0];
  }
  return undefined;
}