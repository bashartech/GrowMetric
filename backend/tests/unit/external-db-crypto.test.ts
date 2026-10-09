import { beforeEach, describe, expect, it } from "vitest";
import {
  buildCredentialsObject,
  decryptCredentials,
  encryptCredentials,
  parseCredentialsObject,
} from "../../src/lib/crypto.js";

const TEST_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("external-db credential encryption", () => {
  beforeEach(() => {
    process.env.DATA_SOURCE_ENCRYPTION_KEY = TEST_KEY;
  });

  it("round-trips credentials through AES-256-GCM", async () => {
    const credentials = buildCredentialsObject(
      "db.example.com",
      5432,
      "analytics",
      "dd_readonly_user",
      "super-secret-password",
      "require",
    );

    const encrypted = await encryptCredentials(credentials);
    expect(typeof encrypted.encrypted).toBe("string");
    expect(typeof encrypted.iv).toBe("string");
    expect(typeof encrypted.salt).toBe("string");

    const decrypted = await decryptCredentials(encrypted);
    expect(decrypted).toBe(credentials);
    expect(parseCredentialsObject(decrypted)).toEqual({
      host: "db.example.com",
      port: 5432,
      database: "analytics",
      username: "dd_readonly_user",
      password: "super-secret-password",
      sslMode: "require",
    });
  });

  it("produces a unique ciphertext for the same plaintext", async () => {
    const credentials = buildCredentialsObject(
      "db.example.com",
      5432,
      "analytics",
      "user",
      "password",
      "require",
    );

    const first = await encryptCredentials(credentials);
    const second = await encryptCredentials(credentials);

    expect(first.encrypted).not.toBe(second.encrypted);
    expect(first.iv).not.toBe(second.iv);
  });

  it("fails to decrypt with a different encryption key", async () => {
    const credentials = buildCredentialsObject(
      "db.example.com",
      5432,
      "analytics",
      "user",
      "password",
      "require",
    );
    const encrypted = await encryptCredentials(credentials);

    process.env.DATA_SOURCE_ENCRYPTION_KEY = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

    await expect(decryptCredentials(encrypted)).rejects.toThrow();
  });

  it("fails to decrypt tampered ciphertext", async () => {
    const credentials = buildCredentialsObject(
      "db.example.com",
      5432,
      "analytics",
      "user",
      "password",
      "require",
    );
    const encrypted = await encryptCredentials(credentials);

    const tampered = {
      ...encrypted,
      encrypted: `AAAA${encrypted.encrypted}`,
    };

    await expect(decryptCredentials(tampered)).rejects.toThrow();
  });
});