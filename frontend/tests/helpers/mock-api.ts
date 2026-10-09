import { vi } from "vitest";

export interface RecordedRequest {
  url: string;
  method: string;
  body: unknown;
}

export interface RouteHandler {
  (request: RecordedRequest): unknown;
}

interface BinaryBody {
  __binary: true;
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
}

function isBinary(value: unknown): value is BinaryBody {
  return Boolean(
    value && typeof value === "object" && (value as BinaryBody).__binary === true,
  );
}

/** Serves raw bytes (e.g. a PDF download) instead of a JSON envelope. */
export function binary(
  bytes: Uint8Array<ArrayBuffer> | string,
  contentType = "application/octet-stream",
): BinaryBody {
  return {
    __binary: true,
    bytes: typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes,
    contentType,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  const payload = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => payload,
    json: async () => JSON.parse(payload) as unknown,
    blob: async () => new Blob([payload], { type: "application/json" }),
  } as unknown as Response;
}

function binaryResponse(bytes: Uint8Array<ArrayBuffer>, contentType: string): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": contentType }),
    text: async () => new TextDecoder().decode(bytes),
    json: async () => JSON.parse(new TextDecoder().decode(bytes)) as unknown,
    blob: async () => new Blob([bytes], { type: contentType }),
  } as unknown as Response;
}

/**
 * Stubs `fetch` with a tiny route table so component tests exercise the real
 * `api-client` (URL building + envelope unwrapping) instead of replacing it
 * with a mock. Mocking the client is what previously let a broken
 * `parseEnvelope` and a missing `?workspaceId=` pass CI.
 */
export function mockApi(routes: Record<string, RouteHandler | unknown>) {
  const requests: RecordedRequest[] = [];

  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    // API_URL is relative by default ("/api/v1"), so resolve against a dummy
    // origin to get a parseable pathname.
    const url = new URL(String(input), "http://api.test");
    const path = url.pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const request: RecordedRequest = { url: String(input), method, body };
    requests.push(request);

    const handler = Object.entries(routes).find(([route]) =>
      path.endsWith(route),
    )?.[1];
    if (handler === undefined) {
      return jsonResponse(404, {
        success: false,
        error: { code: "NOT_FOUND", message: `No stub for ${path}` },
      });
    }

    const result = typeof handler === "function" ? handler(request) : handler;
    if (isBinary(result)) {
      return binaryResponse(result.bytes, result.contentType);
    }
    if (result && typeof result === "object" && "status" in (result as object)) {
      const { status, ...rest } = result as { status: number } & Record<string, unknown>;
      return jsonResponse(status, rest);
    }
    return jsonResponse(200, { success: true, data: result });
  });

  vi.stubGlobal("fetch", fetchMock);

  return {
    requests,
    requestsFor: (path: string) => requests.filter((r) => r.url.includes(path)),
    restore: () => vi.unstubAllGlobals(),
  };
}

/** Wraps a value as an explicit non-200 envelope response. */
export function status(statusCode: number, error: { code: string; message: string }) {
  return { status: statusCode, success: false, error };
}
