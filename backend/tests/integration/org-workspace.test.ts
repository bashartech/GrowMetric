import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { registerUser } from "../helpers/auth.js";
import { cleanupByEmails } from "../helpers/db.js";

const app = createApp();
const createdEmails: string[] = [];

afterAll(async () => {
  await cleanupByEmails(createdEmails);
  await prisma.$disconnect();
});

async function signedInAgent() {
  const { email, password } = await registerUser(app);
  createdEmails.push(email);
  const agent = request.agent(app);
  const login = await agent.post("/api/v1/auth/login").send({ email, password });
  expect(login.status).toBe(200);
  return agent;
}

describe("organization and workspace management", () => {
  it("reads and renames the current organization with an audit entry", async () => {
    const agent = await signedInAgent();

    const before = await agent.get("/api/v1/organizations/current");
    expect(before.status).toBe(200);
    expect(before.body.data.organization.name).toBe("Test Organization");

    const updated = await agent
      .patch("/api/v1/organizations/current")
      .send({ name: "Renamed Organization" });
    expect(updated.status).toBe(200);
    expect(updated.body.data.organization.name).toBe("Renamed Organization");
    expect(updated.body.data.organization.slug).toBeTruthy();

    const after = await agent.get("/api/v1/organizations/current");
    expect(after.body.data.organization.name).toBe("Renamed Organization");

    const organizationId = after.body.data.organization.id;
    const audit = await prisma.auditLog.findFirst({
      where: { organizationId, action: "org.update" },
    });
    expect(audit).not.toBeNull();
  });

  it("rejects an empty organization name", async () => {
    const agent = await signedInAgent();

    const res = await agent
      .patch("/api/v1/organizations/current")
      .send({ name: "   " });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("lists workspaces, returns the current workspace, and renames one", async () => {
    const agent = await signedInAgent();

    const list = await agent.get("/api/v1/workspaces");
    expect(list.status).toBe(200);
    expect(list.body.data.workspaces).toHaveLength(1);
    expect(list.body.data.workspaces[0].isDefault).toBe(true);

    const current = await agent.get("/api/v1/workspaces/current");
    expect(current.status).toBe(200);
    const workspaceId = current.body.data.workspace.id;
    expect(current.body.data.workspace.name).toBe("Test Organization");

    const renamed = await agent
      .patch(`/api/v1/workspaces/${workspaceId}`)
      .send({ name: "Revenue Analytics" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.workspace.name).toBe("Revenue Analytics");

    const audit = await prisma.auditLog.findFirst({
      where: { resourceId: workspaceId, action: "workspace.update" },
    });
    expect(audit).not.toBeNull();
  });

  it("reflects renamed organization and workspace in auth context", async () => {
    const agent = await signedInAgent();

    await agent
      .patch("/api/v1/organizations/current")
      .send({ name: "Context Org" });
    const current = await agent.get("/api/v1/workspaces/current");
    await agent
      .patch(`/api/v1/workspaces/${current.body.data.workspace.id}`)
      .send({ name: "Context Workspace" });

    const me = await agent.get("/api/v1/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.data.organization.name).toBe("Context Org");
    expect(me.body.data.workspace.name).toBe("Context Workspace");
  });
});
