import { describe, expect, it } from "vitest";
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from "../../src/lib/tokens.js";

describe("access tokens", () => {
  it("round-trips the access token payload", async () => {
    const token = await signAccessToken({
      sub: "user-1",
      email: "person@example.com",
      org: "org-1",
      ws: "ws-1",
    });

    const payload = await verifyAccessToken(token);
    expect(payload).toMatchObject({
      sub: "user-1",
      email: "person@example.com",
      org: "org-1",
      ws: "ws-1",
    });
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });

  it("rejects a tampered access token", async () => {
    const token = await signAccessToken({
      sub: "user-1",
      email: "person@example.com",
      org: "org-1",
      ws: "ws-1",
    });

    await expect(verifyAccessToken(`${token}x`)).rejects.toBeTruthy();
  });
});

describe("refresh tokens", () => {
  it("generates an opaque token and stores only its hash", () => {
    const { token, hash } = generateRefreshToken();

    expect(token).not.toBe(hash);
    expect(hashRefreshToken(token)).toBe(hash);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("generates a unique token each time", () => {
    const first = generateRefreshToken();
    const second = generateRefreshToken();
    expect(first.token).not.toBe(second.token);
    expect(first.hash).not.toBe(second.hash);
  });
});
