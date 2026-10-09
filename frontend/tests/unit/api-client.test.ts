import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest } from "@/lib/api-client";

function makeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("apiRequest", () => {
  it("unwraps the success envelope", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(makeResponse(200, { success: true, data: { id: "1" } }));
    vi.stubGlobal("fetch", fetchMock);

    const data = await apiRequest<{ id: string }>("/health");

    expect(data).toEqual({ id: "1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a named collection intact instead of unwrapping it to an array", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeResponse(200, {
        success: true,
        data: { reports: [{ id: "r1", title: "Weekly" }] },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const data = await apiRequest<{ reports: { id: string; title: string }[] }>(
      "/ai/reports",
    );

    // The list pages read `result.reports`. If the client unwraps `reports` the
    // caller gets a bare array and every list renders empty.
    expect(Array.isArray(data)).toBe(false);
    expect(data).toEqual({ reports: [{ id: "r1", title: "Weekly" }] });
  });

  it("passes the workspaceId query parameter through to the list endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeResponse(200, { success: true, data: { rules: [] } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/ai/alert-rules?workspaceId=ws-1");

    expect(fetchMock.mock.calls[0][0]).toContain("/ai/alert-rules?workspaceId=ws-1");
  });

  it("throws an ApiError carrying the server error code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        makeResponse(409, {
          success: false,
          error: { code: "EMAIL_IN_USE", message: "exists" },
        }),
      ),
    );

    await expect(apiRequest("/auth/register")).rejects.toMatchObject({
      code: "EMAIL_IN_USE",
      status: 409,
    });
  });

  it("refreshes the session once on 401 and retries the request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        makeResponse(401, {
          success: false,
          error: { code: "UNAUTHENTICATED", message: "no session" },
        }),
      )
      .mockResolvedValueOnce(makeResponse(200, { success: true, data: {} }))
      .mockResolvedValueOnce(
        makeResponse(200, { success: true, data: { ok: true } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const data = await apiRequest<{ ok: boolean }>("/auth/me");

    expect(data).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("surfaces ApiError for a failed refresh without retrying forever", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        makeResponse(401, {
          success: false,
          error: { code: "UNAUTHENTICATED", message: "no session" },
        }),
      )
      .mockResolvedValueOnce(makeResponse(401, { success: false, error: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/auth/me")).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
