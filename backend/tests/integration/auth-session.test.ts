import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { extractCookie, registerUser } from "../helpers/auth.js";
import { cleanupByEmails } from "../helpers/db.js";

const app = createApp();
const createdEmails: string[] = [];

afterAll(async () => {
  await cleanupByEmails(createdEmails);
  await prisma.$disconnect();
});

describe("authentication session lifecycle", () => {
  it("rejects unauthenticated access to a protected route", async () => {
    const res = await request(app).get("/api/v1/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("signs in, exposes context, rotates the session, and signs out", async () => {
    const { email, password } = await registerUser(app);
    createdEmails.push(email);

    const agent = request.agent(app);

    const login = await agent
      .post("/api/v1/auth/login")
      .send({ email, password });
    expect(login.status).toBe(200);
    expect(login.body.data.user.email).toBe(email);

    const me = await agent.get("/api/v1/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe(email);
    expect(me.body.data.organization.name).toBe("Test Organization");
    expect(me.body.data.workspace.isDefault).toBe(true);
    expect(me.body.data.subscription.planKey).toBe("free");

    const refresh = await agent.post("/api/v1/auth/refresh");
    expect(refresh.status).toBe(200);
    expect(refresh.body.data.refreshed).toBe(true);

    const meAfterRefresh = await agent.get("/api/v1/auth/me");
    expect(meAfterRefresh.status).toBe(200);

    const logout = await agent.post("/api/v1/auth/logout");
    expect(logout.status).toBe(200);
    expect(logout.body.data.loggedOut).toBe(true);

    const meAfterLogout = await agent.get("/api/v1/auth/me");
    expect(meAfterLogout.status).toBe(401);
  });

  it("rejects a wrong password with a generic error and no session", async () => {
    const { email } = await registerUser(app);
    createdEmails.push(email);

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password: "WrongPass123" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
    expect(res.body.error.message).toBe("Invalid email or password.");

    const cookies = res.headers["set-cookie"];
    expect(cookies).toBeUndefined();
  });

  it("gives the same generic error for an unknown email", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "nobody@example.com", password: "Secret123" });

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("Invalid email or password.");
  });

  it("rejects a revoked refresh token", async () => {
    const { email, password } = await registerUser(app);
    createdEmails.push(email);

    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password });
    const refreshCookie = extractCookie(login, "dd_refresh");

    const logout = await request(app)
      .post("/api/v1/auth/logout")
      .set("Cookie", refreshCookie);
    expect(logout.status).toBe(200);

    const replayed = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", refreshCookie);

    expect(replayed.status).toBe(401);
    expect(replayed.body.error.code).toBe("UNAUTHENTICATED");
  });
});
