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

async function signedInAgent(organizationName: string) {
  const { email, password } = await registerUser(app, { organizationName });
  createdEmails.push(email);
  const agent = request.agent(app);
  await agent.post("/api/v1/auth/login").send({ email, password });
  return agent;
}

describe("tenant isolation", () => {
  it("returns only the caller's workspaces", async () => {
    const agentA = await signedInAgent("Tenant A");
    const agentB = await signedInAgent("Tenant B");

    const listA = await agentA.get("/api/v1/workspaces");
    const listB = await agentB.get("/api/v1/workspaces");

    expect(listA.body.data.workspaces).toHaveLength(1);
    expect(listB.body.data.workspaces).toHaveLength(1);
    expect(listA.body.data.workspaces[0].id).not.toBe(
      listB.body.data.workspaces[0].id,
    );
  });

  it("does not allow updating another organization's workspace", async () => {
    const agentA = await signedInAgent("Isolation A");
    const agentB = await signedInAgent("Isolation B");

    const workspaceB = await agentB.get("/api/v1/workspaces/current");
    const foreignId = workspaceB.body.data.workspace.id;

    const attempt = await agentA
      .patch(`/api/v1/workspaces/${foreignId}`)
      .send({ name: "Hijacked" });

    expect(attempt.status).toBe(404);
    expect(attempt.body.error.code).toBe("NOT_FOUND");

    const unchanged = await agentB.get("/api/v1/workspaces/current");
    expect(unchanged.body.data.workspace.name).toBe("Isolation B");
  });

  it("does not accept an organization id from the client", async () => {
    const agentA = await signedInAgent("Client Id A");
    const agentB = await signedInAgent("Client Id B");

    const orgB = await agentB.get("/api/v1/organizations/current");
    const orgBId = orgB.body.data.organization.id;

    const attempt = await agentA
      .patch("/api/v1/organizations/current")
      .send({ name: "Spoofed", organizationId: orgBId });

    expect(attempt.status).toBe(200);
    // The caller's own organization changed, not the target organization.
    const orgAAfter = await agentA.get("/api/v1/organizations/current");
    expect(orgAAfter.body.data.organization.name).toBe("Spoofed");

    const orgBAfter = await agentB.get("/api/v1/organizations/current");
    expect(orgBAfter.body.data.organization.name).toBe("Client Id B");
  });
});
