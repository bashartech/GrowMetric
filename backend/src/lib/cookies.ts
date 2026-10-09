import type { Response } from "express";
import { env } from "../config/env.js";
import { accessTokenMaxAgeMs, refreshTokenMaxAgeMs } from "./tokens.js";

export const ACCESS_COOKIE = "dd_access";
export const REFRESH_COOKIE = "dd_refresh";
export const REFRESH_COOKIE_PATH = "/api/v1/auth";

const baseOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: env.COOKIE_SECURE,
};

export function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshToken: string,
): void {
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...baseOptions,
    path: "/",
    maxAge: accessTokenMaxAgeMs(),
  });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...baseOptions,
    path: REFRESH_COOKIE_PATH,
    maxAge: refreshTokenMaxAgeMs(),
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...baseOptions, path: "/" });
  res.clearCookie(REFRESH_COOKIE, {
    ...baseOptions,
    path: REFRESH_COOKIE_PATH,
  });
}
