import type { RequestHandler } from "express";
import { ACCESS_COOKIE } from "../lib/cookies.js";
import { AppError } from "../lib/http-errors.js";
import { verifyAccessToken } from "../lib/tokens.js";

export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const token = req.cookies?.[ACCESS_COOKIE];
    if (!token) {
      throw new AppError("UNAUTHENTICATED");
    }
    const payload = await verifyAccessToken(token);
    req.user = {
      id: payload.sub,
      email: payload.email,
      organizationId: payload.org,
      workspaceId: payload.ws,
    };
    next();
  } catch {
    next(new AppError("UNAUTHENTICATED"));
  }
};
