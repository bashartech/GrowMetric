import bcrypt from "bcryptjs";
import { AppError } from "../../lib/http-errors.js";
import { prisma } from "../../lib/prisma.js";
import { randomToken } from "../../lib/crypto.js";
import { slugify, slugWithSuffix } from "../../lib/slug.js";
import { logger } from "../../lib/logger.js";
import { record } from "../audit/audit.service.js";
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
} from "../../lib/tokens.js";
import type { LoginInput, RegisterInput } from "./auth.schema.js";
import type { RequestMeta } from "./auth.types.js";

const DEFAULT_PLAN_KEY = "free";

interface SessionUser {
  id: string;
  email: string;
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
}

async function uniqueOrganizationSlug(name: string): Promise<string> {
  const base = slugify(name) || "org";
  let candidate = base;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existing = await prisma.organization.findUnique({
      where: { slug: candidate },
    });
    if (!existing) return candidate;
    candidate = slugWithSuffix(
      base,
      randomToken(3).replace(/[^a-z0-9]/gi, "").slice(0, 4).toLowerCase(),
    );
  }
  return slugWithSuffix(base, randomToken(4).slice(0, 6).toLowerCase());
}

export async function createSession(
  user: SessionUser,
  organizationId: string,
  workspaceId: string,
  meta: RequestMeta,
): Promise<IssuedSession> {
  const accessToken = await signAccessToken({
    sub: user.id,
    email: user.email,
    org: organizationId,
    ws: workspaceId,
  });
  const { token: refreshToken, hash } = generateRefreshToken();

  await prisma.authSession.create({
    data: {
      userId: user.id,
      refreshTokenHash: hash,
      userAgent: meta.userAgent,
      ipAddress: meta.ip,
      expiresAt: refreshTokenExpiry(),
    },
  });

  return { accessToken, refreshToken };
}

export async function register(input: RegisterInput, meta: RequestMeta) {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
  });
  if (existing) {
    throw new AppError("EMAIL_IN_USE");
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  const organizationSlug = await uniqueOrganizationSlug(input.organizationName);
  const workspaceSlug = (slugify(input.organizationName) || "default").slice(
    0,
    48,
  );

  const result = await prisma.$transaction(
    async (tx) => {
    const organization = await tx.organization.create({
      data: { name: input.organizationName, slug: organizationSlug },
    });

    const workspace = await tx.workspace.create({
      data: {
        name: input.organizationName,
        slug: workspaceSlug,
        isDefault: true,
        organizationId: organization.id,
      },
    });

    const user = await tx.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash,
        organizationId: organization.id,
      },
    });

    const plan = await tx.plan.findUnique({ where: { key: DEFAULT_PLAN_KEY } });
    if (!plan) {
      throw new Error(`Default plan '${DEFAULT_PLAN_KEY}' is not seeded`);
    }

    const periodStart = new Date();
    const periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    await tx.subscription.create({
      data: {
        organizationId: organization.id,
        planId: plan.id,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      },
    });

    await tx.notification.create({
      data: {
        userId: user.id,
        type: "system.welcome",
        title: "Welcome to GrowMetrics",
        body: "Your organization and workspace are ready. Connect your business data to get started.",
      },
    });

    await record(
      {
        organizationId: organization.id,
        workspaceId: workspace.id,
        actorUserId: user.id,
        action: "auth.register",
        resourceType: "user",
        resourceId: user.id,
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      },
      tx,
    );

    return { user, organization, workspace };
  },
    { timeout: 30000, maxWait: 15000 },
  );

  const session = await createSession(
    result.user,
    result.organization.id,
    result.workspace.id,
    meta,
  );

  logger.debug(
    { event: "auth.register", userId: result.user.id },
    "Registration completed",
  );

  return { ...result, ...session };
}

export async function findDefaultWorkspace(organizationId: string) {
  return prisma.workspace.findFirst({
    where: { organizationId },
    orderBy: { isDefault: "desc" },
  });
}

export async function getAuthContext(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      organization: {
        include: { subscription: { include: { plan: true } } },
      },
    },
  });

  if (!user) {
    throw new AppError("UNAUTHENTICATED");
  }

  const workspace = await findDefaultWorkspace(user.organizationId);
  if (!workspace) {
    throw new AppError("NOT_FOUND", "No workspace found for this organization");
  }

  return { user, organization: user.organization, workspace };
}

const DUMMY_HASH =
  "$2a$12$C6UzMDM.H6dfI/f/IKcEe.9pXQq5n4Q7s8b0vB3F8xZ0a6N2m1jLu";

export async function login(input: LoginInput, meta: RequestMeta) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  const passwordMatches = await bcrypt.compare(
    input.password,
    user?.passwordHash ?? DUMMY_HASH,
  );

  if (!user || !passwordMatches) {
    throw new AppError("UNAUTHENTICATED", "Invalid email or password.");
  }

  const workspace = await findDefaultWorkspace(user.organizationId);
  if (!workspace) {
    throw new AppError("NOT_FOUND", "No workspace found for this organization");
  }

  const session = await createSession(user, user.organizationId, workspace.id, meta);

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  await record({
    organizationId: user.organizationId,
    workspaceId: workspace.id,
    actorUserId: user.id,
    action: "auth.login",
    resourceType: "user",
    resourceId: user.id,
    ipAddress: meta.ip,
    userAgent: meta.userAgent,
  });

  logger.debug(
    { event: "auth.login", userId: user.id },
    "Sign-in completed",
  );

  return {
    user,
    organizationId: user.organizationId,
    workspaceId: workspace.id,
    ...session,
  };
}

export async function refresh(refreshTokenValue: string, meta: RequestMeta) {
  const session = await prisma.authSession.findUnique({
    where: { refreshTokenHash: hashRefreshToken(refreshTokenValue) },
    include: { user: true },
  });

  if (!session || session.revokedAt !== null || session.expiresAt <= new Date()) {
    throw new AppError("UNAUTHENTICATED", "Session is invalid or expired.");
  }

  const workspace = await findDefaultWorkspace(session.user.organizationId);
  if (!workspace) {
    throw new AppError("UNAUTHENTICATED", "Session has no workspace.");
  }

  const { token: newRefreshToken, hash: newHash } = generateRefreshToken();

  await prisma.$transaction([
    prisma.authSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    }),
    prisma.authSession.create({
      data: {
        userId: session.user.id,
        refreshTokenHash: newHash,
        userAgent: meta.userAgent,
        ipAddress: meta.ip,
        expiresAt: refreshTokenExpiry(),
      },
    }),
  ]);

  const accessToken = await signAccessToken({
    sub: session.user.id,
    email: session.user.email,
    org: session.user.organizationId,
    ws: workspace.id,
  });

  logger.debug(
    { event: "auth.refresh", userId: session.user.id },
    "Session refreshed",
  );

  return {
    accessToken,
    refreshToken: newRefreshToken,
    userId: session.user.id,
    organizationId: session.user.organizationId,
    workspaceId: workspace.id,
  };
}

export async function logout(
  refreshTokenValue: string | undefined,
  meta: RequestMeta,
): Promise<void> {
  if (!refreshTokenValue) return;

  const session = await prisma.authSession.findUnique({
    where: { refreshTokenHash: hashRefreshToken(refreshTokenValue) },
    include: { user: true },
  });

  if (!session || session.revokedAt !== null) return;

  await prisma.authSession.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  });

  await record({
    organizationId: session.user.organizationId,
    actorUserId: session.user.id,
    action: "auth.logout",
    resourceType: "user",
    resourceId: session.user.id,
    ipAddress: meta.ip,
    userAgent: meta.userAgent,
  });

  logger.debug(
    { event: "auth.logout", userId: session.user.id },
    "Sign-out completed",
  );
}
