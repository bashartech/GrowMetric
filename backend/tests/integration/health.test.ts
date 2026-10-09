import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";

describe("GET /api/v1/health", () => {
  it("returns the success envelope with service status", async () => {
    const res = await request(createApp()).get("/api/v1/health");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("ok");
    expect(typeof res.body.data.version).toBe("string");
  });

  it("echoes a provided request id", async () => {
    const res = await request(createApp())
      .get("/api/v1/health")
      .set("x-request-id", "test-request-id");

    expect(res.headers["x-request-id"]).toBe("test-request-id");
  });

  it("returns a safe error envelope for unknown routes", async () => {
    const res = await request(createApp()).get("/api/v1/does-not-exist");

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
