import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

function getEncryptionKey(): Buffer {
  const key = process.env.DATA_SOURCE_ENCRYPTION_KEY;
  if (!key) {
    throw new Error("DATA_SOURCE_ENCRYPTION_KEY environment variable is not set");
  }
  return Buffer.from(key, "hex");
}

export interface EncryptedData {
  encrypted: string;
  iv: string;
  salt: string;
}

export function isEncryptedData(value: unknown): value is EncryptedData {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.encrypted === "string" &&
    candidate.encrypted.length > 0 &&
    typeof candidate.iv === "string" &&
    candidate.iv.length > 0 &&
    typeof candidate.salt === "string" &&
    candidate.salt.length > 0
  );
}

export async function encryptCredentials(
  plaintext: string,
): Promise<EncryptedData> {
  const salt = randomBytes(16);
  const key = await scryptAsync(getEncryptionKey(), salt, 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return {
    encrypted: Buffer.concat([encrypted, authTag]).toString("base64"),
    iv: iv.toString("base64"),
    salt: salt.toString("base64"),
  };
}

export async function decryptCredentials(
  encryptedData: EncryptedData,
): Promise<string> {
  const key = await scryptAsync(
    getEncryptionKey(),
    Buffer.from(encryptedData.salt, "base64"),
    32,
  );
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(encryptedData.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(encryptedData.encrypted, "base64").slice(-16));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedData.encrypted, "base64").slice(0, -16)),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export interface StoredCredentials {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  sslMode: string;
}

export async function decryptCredentialsObject(
  encryptedData: EncryptedData,
): Promise<StoredCredentials> {
  return parseCredentialsObject(await decryptCredentials(encryptedData));
}

export function buildCredentialsObject(
  host: string,
  port: number,
  database: string,
  username: string,
  password: string,
  sslMode: string,
): string {
  return JSON.stringify({ host, port, database, username, password, sslMode });
}

export function parseCredentialsObject(json: string): StoredCredentials {
  return JSON.parse(json);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}