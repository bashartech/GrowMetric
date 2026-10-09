import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { env } from "../config/env.js";
import { AppError } from "./http-errors.js";
import { logger } from "./logger.js";

export interface StoredObject {
  storageKey: string;
  sizeBytes: number;
}

export interface StorageLike {
  put(key: string, body: Buffer): Promise<string>;
  getObject(key: string): Promise<Buffer | null>;
  getObjectMetadata(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

function isR2Configured(): boolean {
  return Boolean(
    env.R2_ACCOUNT_ID &&
      env.R2_ACCESS_KEY_ID &&
      env.R2_SECRET_ACCESS_KEY &&
      env.R2_BUCKET_NAME,
  );
}

function r2Client(): S3Client {
  const endpoint =
    env.R2_ENDPOINT ??
    `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  return new S3Client({
    region: "auto",
    endpoint,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

export function localStoragePath(key: string): string {
  if (
    key.startsWith("/") ||
    key.startsWith("\\") ||
    key.split(/[\\/]/).includes("..")
  ) {
    throw new AppError("INTERNAL_ERROR", "Storage key must be a relative path");
  } 
  return resolve(env.UPLOAD_DIR, key);
}

const localStorage: StorageLike = {
  put: async (key: string, body: Buffer): Promise<string> => {
    const target = localStoragePath(key);
    await mkdir(dirname(target), { recursive: true });
    await new Promise<void>((resolvePromise, reject) => {
      const stream = createWriteStream(target);
      stream.once("error", reject);
      stream.once("finish", () => resolvePromise());
      stream.end(body);
    });
    return target;
  },
  getObject: async (key: string): Promise<Buffer | null> => {
    const target = localStoragePath(key);
    try {
      return await readFile(target);
    } catch {
      return null;
    }
  },
  getObjectMetadata: async (key: string): Promise<StoredObject | null> => {
    const target = localStoragePath(key);
    try {
      const info = await stat(target);
      return { storageKey: target, sizeBytes: info.size };
    } catch {
      return null;
    }
  },
  delete: async (key: string): Promise<void> => {
    const target = localStoragePath(key);
    try {
      await rm(target, { force: true });
    } catch {
      // best-effort cleanup
    }
  },
};

const r2Storage: StorageLike = {
  put: async (key: string, body: Buffer): Promise<string> => {
    const client = r2Client();
    await client.send(
      new PutObjectCommand({
        Bucket: env.R2_BUCKET_NAME,
        Key: key,
        Body: body,
      }),
    );
    return key;
  },
  getObject: async (key: string): Promise<Buffer | null> => {
    const client = r2Client();
    try {
      const result = await client.send(
        new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }),
      );
      if (result.Body == null) return null;
      const bytes = await result.Body.transformToByteArray();
      return Buffer.from(bytes);
    } catch {
      return null;
    }
  },
  getObjectMetadata: async (key: string): Promise<StoredObject | null> => {
    const client = r2Client();
    try {
      const result = await client.send(
        new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }),
      );
      return { storageKey: key, sizeBytes: result.ContentLength ?? 0 };
    } catch {
      return null;
    }
  },
  delete: async (key: string): Promise<void> => {
    const client = r2Client();
    await client.send(
      new DeleteObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }),
    );
  },
};

export function buildStorageKey(
  organizationId: string,
  dataSourceId: string,
  fileId: string,
): string {
  return join(organizationId, dataSourceId, fileId);
}

export const storage: StorageLike = isR2Configured()
  ? r2Storage
  : localStorage;

export function storageBackendName(): string {
  return isR2Configured() ? "r2" : "local-uploads";
}

export function logStorageBackend(): void {
  logger.info({ backend: storageBackendName() }, "Object storage backend active");
}