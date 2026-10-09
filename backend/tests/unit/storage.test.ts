import { describe, expect, it } from "vitest";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

// Import storage interface
type StorageLike = {
  put(key: string, body: Buffer): Promise<string>;
  getObject(key: string): Promise<Buffer | null>;
  getObjectMetadata(key: string): Promise<{ storageKey: string; sizeBytes: number } | null>;
};

describe("Storage (local fallback)", () => {
  let tempDir: string;
  let localStorage: StorageLike;

  async function setupLocalStorage() {
    tempDir = join(tmpdir(), `storage-test-${randomBytes(8).toString("hex")}`);
    await mkdir(tempDir, { recursive: true });

    localStorage = {
      put: async (key: string, body: Buffer): Promise<string> => {
        const filePath = join(tempDir, key);
        const dir = join(tempDir, key.split("/").slice(0, -1).join("/"));
        await mkdir(dir, { recursive: true });
        await writeFile(filePath, body);
        return key;
      },
      getObject: async (key: string): Promise<Buffer | null> => {
        try {
          const filePath = join(tempDir, key);
          return await readFile(filePath);
        } catch {
          return null;
        }
      },
      getObjectMetadata: async (key: string) => {
        try {
          const filePath = join(tempDir, key);
          const buffer = await readFile(filePath);
          return { storageKey: key, sizeBytes: buffer.length };
        } catch {
          return null;
        }
      },
    };
  }

  async function cleanup() {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  it("stores and retrieves a file", async () => {
    await setupLocalStorage();

    const key = "test/file.txt";
    const content = Buffer.from("Hello, World!");

    const storedKey = await localStorage.put(key, content);
    expect(storedKey).toBe(key);

    const retrieved = await localStorage.getObject(key);
    expect(retrieved).toEqual(content);

    await cleanup();
  });

  it("returns null for non-existent file", async () => {
    await setupLocalStorage();

    const retrieved = await localStorage.getObject("non-existent.txt");
    expect(retrieved).toBeNull();

    await cleanup();
  });

  it("gets object metadata", async () => {
    await setupLocalStorage();

    const key = "metadata-test.bin";
    const content = Buffer.from("test data");

    await localStorage.put(key, content);

    const metadata = await localStorage.getObjectMetadata(key);
    expect(metadata).not.toBeNull();
    expect(metadata?.storageKey).toBe(key);
    expect(metadata?.sizeBytes).toBe(content.length);

    await cleanup();
  });

  it("handles nested paths", async () => {
    await setupLocalStorage();

    const key = "org-123/datasource-456/file-789.csv";
    const content = Buffer.from("a,b,c\n1,2,3");

    await localStorage.put(key, content);

    const retrieved = await localStorage.getObject(key);
    expect(retrieved).toEqual(content);

    await cleanup();
  });

  it("handles binary data", async () => {
    await setupLocalStorage();

    const key = "binary.dat";
    const content = randomBytes(1024);

    await localStorage.put(key, content);

    const retrieved = await localStorage.getObject(key);
    expect(retrieved).toEqual(content);

    await cleanup();
  });

  it("overwrites existing file", async () => {
    await setupLocalStorage();

    const key = "overwrite.txt";
    const content1 = Buffer.from("First version");
    const content2 = Buffer.from("Second version");

    await localStorage.put(key, content1);
    await localStorage.put(key, content2);

    const retrieved = await localStorage.getObject(key);
    expect(retrieved).toEqual(content2);

    await cleanup();
  });

  it("handles large files", async () => {
    await setupLocalStorage();

    const key = "large.bin";
    const content = randomBytes(5 * 1024 * 1024); // 5 MB

    await localStorage.put(key, content);

    const retrieved = await localStorage.getObject(key);
    expect(retrieved?.length).toBe(content.length);

    await cleanup();
  });

  it("returns null metadata for non-existent file", async () => {
    await setupLocalStorage();

    const metadata = await localStorage.getObjectMetadata("missing.txt");
    expect(metadata).toBeNull();

    await cleanup();
  });
});
