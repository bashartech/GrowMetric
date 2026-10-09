import { SignJWT, jwtVerify } from "jose";
import { env } from "../config/env.js";
import { randomToken, sha256Hex } from "./crypto.js";
import type { AccessTokenPayload, VerifiedAccessToken } from "../types/auth.js";

const secret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

export async function signAccessToken(
  payload: AccessTokenPayload,
): Promise<string> {
  return new SignJWT({ email: payload.email, org: payload.org, ws: payload.ws })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_MINUTES}m`)
    .sign(secret);
}

export async function verifyAccessToken(
  token: string,
): Promise<VerifiedAccessToken> {
  const { payload } = await jwtVerify(token, secret, {
    algorithms: ["HS256"],
  });

  if (!payload.sub || typeof payload.iat !== "number" || typeof payload.exp !== "number") {
    throw new Error("Access token is missing required claims");
  }

  return {
    sub: payload.sub,
    email: String(payload.email ?? ""),
    org: String(payload.org ?? ""),
    ws: String(payload.ws ?? ""),
    iat: payload.iat,
    exp: payload.exp,
  };
}

export function generateRefreshToken(): { token: string; hash: string } {
  const token = randomToken(32);
  return { token, hash: sha256Hex(token) };
}

export function hashRefreshToken(token: string): string {
  return sha256Hex(token);
}

export function refreshTokenExpiry(): Date {
  return new Date(
    Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
}

export function accessTokenMaxAgeMs(): number {
  return env.ACCESS_TOKEN_TTL_MINUTES * 60 * 1000;
}

export function refreshTokenMaxAgeMs(): number {
  return env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
}
