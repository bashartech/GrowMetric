import { createHash } from "node:crypto";
import { extname } from "node:path";
import { fileTypeFromBuffer } from "file-type";
import { env } from "../config/env.js";
import { AppError } from "./http-errors.js";

export const ALLOWED_EXTENSIONS = [".csv", ".xlsx"] as const;

export interface ValidatedFile {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  extension: string;
}

const MAX_FILE_BYTES = env.IMPORT_MAX_FILE_BYTES;

function extensionOf(name: string): string {
  return extname(name).toLowerCase();
}

function isBinaryContent(buffer: Buffer): boolean {
  const probe = buffer.subarray(0, 8192);
  return probe.includes(0);
}

export async function assertSupportedFile(
  originalName: string,
  buffer: Buffer,
): Promise<void> {
  const extension = extensionOf(originalName);

  if (buffer.length === 0) {
    throw new AppError("FILE_EMPTY", "The uploaded file is empty.");
  }

  if (buffer.length > MAX_FILE_BYTES) {
    throw new AppError(
      "FILE_TOO_LARGE",
      `File exceeds the ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)} MB limit.`,
    );
  }

  if (!ALLOWED_EXTENSIONS.includes(extension as (typeof ALLOWED_EXTENSIONS)[number])) {
    throw new AppError(
      "FILE_TYPE_UNSUPPORTED",
      "Only .csv and .xlsx files are supported.",
    );
  }

  const detected = await awaitDetection(extension, buffer);
  if (!detected) {
    throw new AppError(
      "FILE_TYPE_UNSUPPORTED",
      "The file content does not match its extension.",
    );
  }
}

async function awaitDetection(
  extension: string,
  buffer: Buffer,
): Promise<boolean> {
  if (extension === ".xlsx") {
    const detected = await fileTypeFromBuffer(buffer);
    return detected?.mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }

  if (extension === ".csv") {
    return !isBinaryContent(buffer);
  }

  return false;
}

export function computeChecksum(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function validateUploadedFile(
  originalName: string,
  buffer: Buffer,
): Promise<ValidatedFile> {
  await assertSupportedFile(originalName, buffer);
  return {
    originalName,
    mimeType:
      extensionOf(originalName) === ".xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "text/csv",
    sizeBytes: buffer.length,
    checksum: computeChecksum(buffer),
    extension: extensionOf(originalName),
  };
}