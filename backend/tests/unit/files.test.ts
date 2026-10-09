import { describe, expect, it } from "vitest";
import {
  computeChecksum,
  validateUploadedFile,
} from "../../src/lib/files.js";
import ExcelJS from "exceljs";

describe("validateUploadedFile", () => {
  it("accepts valid CSV file", async () => {
    const buffer = Buffer.from("name,value\nAlice,123\nBob,456");
    const result = await validateUploadedFile("data.csv", buffer);

    expect(result.originalName).toBe("data.csv");
    expect(result.extension).toBe(".csv");
    expect(result.sizeBytes).toBe(buffer.length);
    expect(result.checksum).toHaveLength(64);
  });

  it("accepts valid XLSX file", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Sales");
    worksheet.addRow(["Product", "Quantity"]);
    worksheet.addRow(["Widget", 10]);

    const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;

    const result = await validateUploadedFile("data.xlsx", buffer);

    expect(result.extension).toBe(".xlsx");
    expect(result.mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });

  it("rejects oversized file", async () => {
    const maxBytes = 26_214_400; // 25 MB
    const buffer = Buffer.alloc(maxBytes + 1);

    await expect(validateUploadedFile("large.csv", buffer)).rejects.toMatchObject({
      code: "FILE_TOO_LARGE",
    });
  });

  it("rejects unsupported file extension", async () => {
    const buffer = Buffer.from("content");

    await expect(validateUploadedFile("data.pdf", buffer)).rejects.toMatchObject({
      code: "FILE_TYPE_UNSUPPORTED",
    });
  });

  it("rejects empty file", async () => {
    const buffer = Buffer.alloc(0);

    await expect(validateUploadedFile("empty.csv", buffer)).rejects.toMatchObject({
      code: "FILE_EMPTY",
    });
  });

  it("rejects file with mismatched content type", async () => {
    const buffer = Buffer.from("not an excel file");

    await expect(validateUploadedFile("fake.xlsx", buffer)).rejects.toMatchObject({
      code: "FILE_TYPE_UNSUPPORTED",
    });
  });

  it("handles files with unusual but valid names", async () => {
    const buffer = Buffer.from("a,b\n1,2");
    const result = await validateUploadedFile("my-data-2024_v2.final.csv", buffer);

    expect(result.extension).toBe(".csv");
  });
});

describe("computeChecksum", () => {
  it("computes SHA-256 checksum", () => {
    const buffer = Buffer.from("hello world");
    const hash = computeChecksum(buffer);

    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces deterministic checksums", () => {
    const buffer = Buffer.from("test data");
    const hash1 = computeChecksum(buffer);
    const hash2 = computeChecksum(buffer);

    expect(hash1).toBe(hash2);
  });

  it("produces different checksums for different content", () => {
    const buffer1 = Buffer.from("content A");
    const buffer2 = Buffer.from("content B");

    const hash1 = computeChecksum(buffer1);
    const hash2 = computeChecksum(buffer2);

    expect(hash1).not.toBe(hash2);
  });

  it("handles empty buffer", () => {
    const hash = computeChecksum(Buffer.alloc(0));

    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});