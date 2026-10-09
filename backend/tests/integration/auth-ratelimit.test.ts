import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createAuthRateLimiter } from "../../src/middleware/rate-limit.js";

function buildApp(limit: number) {
  const app = express();
  app.use(express.json());
  app.post(
    "/api/v1/auth/login",
    createAuthRateLimiter({ limit, windowMs: 60_000 }),
    (_req, res) => {
      res.status(200).json({ success: true, data: { ok: true } });
    },
  );
  return app;
}

describe("auth rate limiter", () => {
  it("allows requests under the limit and blocks the next one", async () => {
    const app = buildApp(3);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const res = await request(app).post("/api/v1/auth/login").send({});
      expect(res.status).toBe(200);
    }

    const blocked = await request(app).post("/api/v1/auth/login").send({});
    expect(blocked.status).toBe(429);
    expect(blocked.body.success).toBe(false);
    expect(blocked.body.error.code).toBe("RATE_LIMITED");
  });
});
