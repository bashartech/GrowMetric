import { describe, expect, it } from "vitest";
import { identifier } from "../../src/lib/external-db.js";
import { isEncryptedData } from "../../src/lib/crypto.js";
import { localStoragePath } from "../../src/lib/storage.js";
import { AppError } from "../../src/lib/http-errors.js";

describe("SQL identifier quoting (external-db)", () => {
  it("double-quotes and escapes embedded quotes", () => {
    expect(identifier("orders")).toBe('"orders"');
    expect(identifier('weird"name')).toBe('"weird""name"');
  });

  it("neutralizes injection payloads in table names", () => {
    const hostile = String.raw`orders"; DROP TABLE "users"; --`;
    const quoted = identifier(hostile);
    expect(quoted).toBe('"orders""; DROP TABLE ""users""; --"');
    expect(quoted.includes('"; DROP TABLE "users";')).toBe(false);
  });
});

describe("EncryptedData validation", () => {
  it("accepts a well-formed encrypted payload", () => {
    expect(
      isEncryptedData({
        encrypted: "aGVsbG8=",
        iv: "aXN2",
        salt: "c2FsdA==",
      }),
    ).toBe(true);
  });

  it("rejects malformed or partial payloads", () => {
    expect(isEncryptedData(null)).toBe(false);
    expect(isEncryptedData("not-an-object")).toBe(false);
    expect(isEncryptedData({ encrypted: "x", iv: "y" })).toBe(false);
    expect(isEncryptedData({ encrypted: "x", iv: "", salt: "z" })).toBe(false);
    expect(isEncryptedData({ encrypted: 1, iv: "y", salt: "z" })).toBe(false);
  });
});

describe("local storage path containment", () => {
  it("resolves keys inside the upload directory", () => {
    const path = localStoragePath("org/ds/file.csv");
    expect(path).toContain("file.csv");
  });

  it.each([
    "../secrets.env",
    "../../etc/passwd",
    "..\\..\\windows\\file",
    "/etc/passwd",
    "\\absolute\\path",
    "org/../escape",
  ])("rejects traversal key %s", (key) => {
    expect(() => localStoragePath(key)).toThrow(AppError);
  });
});