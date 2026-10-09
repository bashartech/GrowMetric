import { describe, it, expect, beforeEach, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  workspace: { findFirst: vi.fn() },
}));

vi.mock("../../src/lib/prisma.js", () => ({ prisma: prismaMock }));

import { resolveWorkspaceId, isUuid, requestedWorkspaceId } from "../../src/lib/workspace.js";

const ORG = "11111111-1111-4111-8111-111111111111";
const WS_DEFAULT = "22222222-2222-4222-8222-222222222222";
const WS_OTHER = "33333333-3333-4333-8333-333333333333";

describe("isUuid", () => {
  it("rejects the empty string that caused the original 400s", () => {
    expect(isUuid("")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(null)).toBe(false);
  });

  it("rejects non-UUID strings", () => {
    expect(isUuid("ws-1")).toBe(false);
    expect(isUuid("default-workspace-id")).toBe(false);
    expect(isUuid(123)).toBe(false);
  });

  it("accepts a real UUID", () => {
    expect(isUuid(WS_DEFAULT)).toBe(true);
  });
});

describe("requestedWorkspaceId", () => {
  it("returns undefined when absent or empty", () => {
    expect(requestedWorkspaceId(undefined)).toBeUndefined();
    expect(requestedWorkspaceId("")).toBeUndefined();
  });

  it("takes the first value of a repeated query parameter", () => {
    expect(requestedWorkspaceId([WS_DEFAULT, WS_OTHER])).toBe(WS_DEFAULT);
  });

  it("passes a single string through", () => {
    expect(requestedWorkspaceId(WS_DEFAULT)).toBe(WS_DEFAULT);
  });
});

describe("resolveWorkspaceId", () => {
  beforeEach(() => {
    prismaMock.workspace.findFirst.mockReset();
  });

  it("honours a workspace that belongs to the organization", async () => {
    prismaMock.workspace.findFirst.mockResolvedValueOnce({ id: WS_OTHER });

    await expect(resolveWorkspaceId(ORG, WS_OTHER)).resolves.toBe(WS_OTHER);
    expect(prismaMock.workspace.findFirst).toHaveBeenCalledTimes(1);
    expect(prismaMock.workspace.findFirst.mock.calls[0]![0]).toMatchObject({
      where: { id: WS_OTHER, organizationId: ORG },
    });
  });

  it("falls back to the default workspace when none is supplied", async () => {
    prismaMock.workspace.findFirst.mockResolvedValueOnce({ id: WS_DEFAULT });

    await expect(resolveWorkspaceId(ORG)).resolves.toBe(WS_DEFAULT);
    // Only the default lookup should run.
    expect(prismaMock.workspace.findFirst).toHaveBeenCalledTimes(1);
  });

  it("never sends an empty or malformed id to the database", async () => {
    prismaMock.workspace.findFirst.mockResolvedValue({ id: WS_DEFAULT });

    await expect(resolveWorkspaceId(ORG, "")).resolves.toBe(WS_DEFAULT);
    await expect(resolveWorkspaceId(ORG, "ws-1")).resolves.toBe(WS_DEFAULT);
    await expect(resolveWorkspaceId(ORG, null)).resolves.toBe(WS_DEFAULT);

    // An invalid candidate is never used as a lookup key; the first call of
    // each is the unscoped default-workspace query.
    for (const call of prismaMock.workspace.findFirst.mock.calls) {
      expect(call[0].where).not.toHaveProperty("id");
    }
  });

  it("rejects a workspace owned by another organization", async () => {
    // Owned lookup misses, then the default workspace is found.
    prismaMock.workspace.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: WS_DEFAULT });

    await expect(resolveWorkspaceId(ORG, WS_OTHER)).resolves.toBe(WS_DEFAULT);
  });

  it("throws NOT_FOUND when the organization has no workspace", async () => {
    prismaMock.workspace.findFirst.mockResolvedValue(null);

    await expect(resolveWorkspaceId(ORG)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });
});
