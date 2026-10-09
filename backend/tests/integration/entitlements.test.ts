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
  await agent.post("/api/v1/auth/login").send({ email, password });
  return agent;
}

describe("entitlements and usage", () => {
  it("reports the organization's plan and feature limits", async () => {
    const agent = await signedInAgent();

    const res = await agent.get("/api/v1/entitlements");

    expect(res.status).toBe(200);
    expect(res.body.data.plan.key).toBe("free");
    expect(res.body.data.features.aiInvestigations).toBe(5);
    expect(res.body.data.subscription.status).toBe("ACTIVE");
  });

  it("records usage against the current period and enforces the limit", async () => {
    const agent = await signedInAgent();

    const empty = await agent.get("/api/v1/usage?metric=ai_investigations");
    expect(empty.status).toBe(200);
    expect(empty.body.data.amount).toBe(0);

    const first = await agent
      .post("/api/v1/usage")
      .send({ metric: "ai_investigations", amount: 2 });
    expect(first.status).toBe(200);
    expect(first.body.data.amount).toBe(2);

    const second = await agent
      .post("/api/v1/usage")
      .send({ metric: "ai_investigations", amount: 3 });
    expect(second.body.data.amount).toBe(5);

    const blocked = await agent
      .post("/api/v1/usage")
      .send({ metric: "ai_investigations", amount: 1 });
    expect(blocked.status).toBe(402);
    expect(blocked.body.error.code).toBe("ENTITLEMENT_REQUIRED");

    const still = await agent.get("/api/v1/usage?metric=ai_investigations");
    expect(still.body.data.amount).toBe(5);
  });

  it("lists all tracked metrics when no metric is given", async () => {
    const agent = await signedInAgent();

    await agent
      .post("/api/v1/usage")
      .send({ metric: "ai_investigations", amount: 1 });
    await agent.post("/api/v1/usage").send({ metric: "data_imports", amount: 1 });

    const all = await agent.get("/api/v1/usage");
    expect(all.status).toBe(200);
    const metrics = all.body.data.items.map(
      (item: { metric: string }) => item.metric,
    );
    expect(metrics).toContain("ai_investigations");
    expect(metrics).toContain("data_imports");
  });

  it("rejects invalid usage input", async () => {
    const agent = await signedInAgent();

    const res = await agent
      .post("/api/v1/usage")
      .send({ metric: "", amount: -1 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});
