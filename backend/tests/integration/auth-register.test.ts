import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { cleanupByEmails, uniqueEmail } from "../helpers/db.js";

const app = createApp();
const createdEmails: string[] = [];

afterAll(async () => {
  await cleanupByEmails(createdEmails);
  await prisma.$disconnect();
});

async function register(payload: Record<string, unknown>) {
  return request(app).post("/api/v1/auth/register").send(payload);
}

describe("POST /api/v1/auth/register", () => {
  it("creates a user, organization, default workspace and a session", async () => {
    const email = uniqueEmail("register");
    createdEmails.push(email);

    const res = await register({
      name: "Test Owner",
      email,
      password: "Secret123",
      organizationName: "Acme Analytics",
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe(email);
    expect(res.body.data.user.role).toBe("OWNER");
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(res.body.data.organization.name).toBe("Acme Analytics");
    expect(res.body.data.workspace.isDefault).toBe(true);

    const cookies = (res.headers["set-cookie"] as unknown as string[]) ?? [];
    const cookieHeader = cookies.join(";");
    expect(cookieHeader).toContain("dd_access");
    expect(cookieHeader).toContain("dd_refresh");
    expect(cookieHeader.toLowerCase()).toContain("httponly");

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).not.toBeNull();

    const organization = await prisma.organization.findUnique({
      where: { id: user!.organizationId },
      include: { workspaces: true, subscription: { include: { plan: true } } },
    });
    expect(organization).not.toBeNull();
    expect(organization!.workspaces).toHaveLength(1);
    expect(organization!.workspaces[0]!.isDefault).toBe(true);
    expect(organization!.subscription?.plan.key).toBe("free");

    const audit = await prisma.auditLog.findFirst({
      where: { organizationId: organization!.id, action: "auth.register" },
    });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit)).not.toContain("Secret123");
  });

  it("rejects a duplicate email without creating another organization", async () => {
    const email = uniqueEmail("duplicate");
    createdEmails.push(email);
    const payload = {
      name: "Dupe",
      email,
      password: "Secret123",
      organizationName: "Dupe Org",
    };

    const first = await register(payload);
    expect(first.status).toBe(201);

    const second = await register(payload);
    expect(second.status).toBe(409);
    expect(second.body.success).toBe(false);
    expect(second.body.error.code).toBe("EMAIL_IN_USE");

    const organizations = await prisma.organization.findMany({
      where: { users: { some: { email } } },
    });
    expect(organizations).toHaveLength(1);
  });

  it("rejects invalid input with field-level guidance and persists nothing", async () => {
    const email = uniqueEmail("invalid");
    createdEmails.push(email);

    const res = await register({
      name: "",
      email,
      password: "short",
      organizationName: "",
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details).toBeDefined();

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).toBeNull();
  });

  it("normalizes email casing so one person cannot register twice", async () => {
    const email = uniqueEmail("case");
    createdEmails.push(email);

    const first = await register({
      name: "Case",
      email,
      password: "Secret123",
      organizationName: "Case Org",
    });
    expect(first.status).toBe(201);

    const second = await register({
      name: "Case",
      email: email.toUpperCase(),
      password: "Secret123",
      organizationName: "Case Org 2",
    });
    expect(second.status).toBe(409);
  });
});
