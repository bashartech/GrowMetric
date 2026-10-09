import { AppError } from "../../lib/http-errors.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from "../../lib/cookies.js";
import { ok } from "../../lib/respond.js";
import type { LoginInput, RegisterInput } from "./auth.schema.js";
import * as service from "./auth.service.js";
import {
  requestMeta,
  toOrganizationDTO,
  toUserDTO,
  toWorkspaceDTO,
} from "./auth.types.js";

export const registerController = asyncHandler(async (req, res) => {
  const result = await service.register(
    req.body as RegisterInput,
    requestMeta(req),
  );
  setAuthCookies(res, result.accessToken, result.refreshToken);
  ok(
    res,
    {
      user: toUserDTO(result.user),
      organization: toOrganizationDTO(result.organization),
      workspace: toWorkspaceDTO(result.workspace),
    },
    201,
  );
});

export const loginController = asyncHandler(async (req, res) => {
  const result = await service.login(req.body as LoginInput, requestMeta(req));
  setAuthCookies(res, result.accessToken, result.refreshToken);
  ok(res, { user: toUserDTO(result.user) });
});

export const refreshController = asyncHandler(async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) {
    clearAuthCookies(res);
    throw new AppError("UNAUTHENTICATED");
  }
  try {
    const result = await service.refresh(token, requestMeta(req));
    setAuthCookies(res, result.accessToken, result.refreshToken);
    ok(res, { refreshed: true });
  } catch (error) {
    clearAuthCookies(res);
    throw error;
  }
});

export const logoutController = asyncHandler(async (req, res) => {
  await service.logout(req.cookies?.[REFRESH_COOKIE], requestMeta(req));
  clearAuthCookies(res);
  ok(res, { loggedOut: true });
});

export const meController = asyncHandler(async (req, res) => {
  const context = await service.getAuthContext(req.user!.id);
  const subscription = context.organization.subscription;

  ok(res, {
    user: toUserDTO(context.user),
    organization: toOrganizationDTO(context.organization),
    workspace: toWorkspaceDTO(context.workspace),
    subscription: subscription
      ? {
          planKey: subscription.plan.key,
          planName: subscription.plan.name,
          status: subscription.status,
          currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
        }
      : null,
  });
});
