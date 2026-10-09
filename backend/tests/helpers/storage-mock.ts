import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../../src/lib/prisma.js";
import type { StorageLike } from "../../src/lib/storage.js";

export function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "GrowMetrics-"));
}

export const storageMock: StorageLike = {
  put: async (key: string, _body: Buffer) => key,
  getObject: async (key: string) => Buffer.from(key),
  getObjectMetadata: async (key: string) => ({ storageKey: key, sizeBytes: key.length }),
  delete: async (_key: string) => undefined,
};

export async function cleanupRecord<T extends { id: string }>(
  _record: T,
): Promise<void> {
  return undefined;
}

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}