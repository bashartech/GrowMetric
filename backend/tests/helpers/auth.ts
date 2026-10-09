import type { Express } from "express";
import request from "supertest";
import { uniqueEmail } from "./db.js";

interface RegisterOverrides {
  email?: string;
  password?: string;
  name?: string;
  organizationName?: string;
}

export const DEFAULT_PASSWORD = "Secret123";

export async function registerUser(
  app: Express,
  overrides: RegisterOverrides = {},
) {
  const email = overrides.email ?? uniqueEmail("user");
  const password = overrides.password ?? DEFAULT_PASSWORD;
  const response = await request(app).post("/api/v1/auth/register").send({
    name: overrides.name ?? "Test User",
    email,
    password,
    organizationName: overrides.organizationName ?? "Test Organization",
  });
  return { email, password, response };
}

export function extractCookie(
  response: request.Response,
  name: string,
): string {
  const cookies = (response.headers["set-cookie"] as unknown as string[]) ?? [];
  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  if (!match) {
    throw new Error(`Cookie ${name} not found in response`);
  }
  return match.split(";")[0]!;
}
