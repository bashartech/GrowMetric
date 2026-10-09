import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { registerUser } from "../helpers/auth.js";
import { cleanupByEmails } from "../helpers/db.js";

const app = createApp();
const createdEmails: string[] = [];
const PASSWORD = "Secret123";

afterAll(async () => {
  await cleanupByEmails(createdEmails);
  await prisma.$disconnect();
});

async function signedInAgent(organizationName = "Audit Org") {
  const { email } = await registerUser(app, {
    organizationName,
    password: PASSWORD,
  });
  createdEmails.push(email);
  const agent = request.agent(app);
  await agent.post("/api/v1/auth/login").send({ email, password: PASSWORD });
  return { agent, email };
}

describe("audit trail", () => {
  it("records one entry per account action without leaking secrets", async () => {
    const { agent, email } = await signedInAgent();

    await agent
      .patch("/api/v1/organizations/current")
      .send({ name: "Audit Org Renamed" });
    const current = await agent.get("/api/v1/workspaces/current");
    await agent
      .patch(`/api/v1/workspaces/${current.body.data.workspace.id}`)
      .send({ name: "Audit Workspace" });

    const list = await agent.get("/api/v1/audit-logs?pageSize=100");
    expect(list.status).toBe(200);

    const actions = list.body.data.items.map(
      (item: { action: string }) => item.action,
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        "auth.register",
        "auth.login",
        "org.update",
        "workspace.update",
      ]),
    );

    const serialized = JSON.stringify(list.body.data.items);
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain("dd_refresh");
    expect(serialized).not.toContain("passwordHash");

    await agent.post("/api/v1/auth/logout");

    const user = await prisma.user.findUnique({ where: { email } });
    const logoutEntries = await prisma.auditLog.count({
      where: { action: "auth.logout", actorUserId: user!.id },
    });
    expect(logoutEntries).toBe(1);
  });

  it("strips sensitive keys from audit metadata", async () => {
    const { record } = await import("../../src/modules/audit/audit.service.js");
    const { email } = await registerUser(app);
    createdEmails.push(email);

    const user = await prisma.user.findUnique({ where: { email } });
    await record({
      organizationId: user!.organizationId,
      actorUserId: user!.id,
      action: "test.sensitive",
      resourceType: "user",
      resourceId: user!.id,
      metadata: {
        safeField: "visible",
        password: "should-not-appear",
        refreshToken: "should-not-appear",
      },
    });

    const entry = await prisma.auditLog.findFirst({
      where: { action: "test.sensitive", actorUserId: user!.id },
    });

    expect(entry!.metadata).toEqual({ safeField: "visible" });
  });

  it("paginates newest-first and filters by action", async () => {
    const { agent } = await signedInAgent("Audit Pagination Org");

    for (let index = 0; index < 4; index += 1) {
      await agent
        .patch("/api/v1/organizations/current")
        .send({ name: `Rename ${index}` });
    }

    const firstPage = await agent.get(
      "/api/v1/audit-logs?page=1&pageSize=2&action=org.update",
    );
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.data.items).toHaveLength(2);
    expect(firstPage.body.data.total).toBeGreaterThanOrEqual(4);

    for (const item of firstPage.body.data.items) {
      expect(item.action).toBe("org.update");
    }

    const [a, b] = firstPage.body.data.items;
    expect(new Date(a.createdAt).getTime()).toBeGreaterThanOrEqual(
      new Date(b.createdAt).getTime(),
    );
  });

  it("keeps audit entries isolated per organization", async () => {
    const { agent: agentA } = await signedInAgent("Audit Isolation A");
    const { agent: agentB } = await signedInAgent("Audit Isolation B");

    const orgA = await agentA.get("/api/v1/organizations/current");
    const orgAId = orgA.body.data.organization.id;
    const userA = await agentA.get("/api/v1/auth/me");
    const userAId = userA.body.data.user.id;

    const listB = await agentB.get("/api/v1/audit-logs?pageSize=100");
    expect(listB.status).toBe(200);

    const ids = listB.body.data.items.map(
      (item: { resourceId: string | null }) => item.resourceId,
    );
    expect(ids).not.toContain(orgAId);

    const actorIds = listB.body.data.items.map(
      (item: { actor: { id: string } | null }) => item.actor?.id,
    );
    expect(actorIds).not.toContain(userAId);
  });
});
