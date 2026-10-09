import type { RequestHandler } from "express";
import multer from "multer";
import { env } from "../config/env.js";
import { AppError } from "../lib/http-errors.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.IMPORT_MAX_FILE_BYTES,
    files: 1,
  },
});

export const uploadSingleFile: RequestHandler = (req, res, next) => {
  upload.single("file")(req, res, (error: unknown) => {
    if (error && error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        next(
          new AppError(
            "FILE_TOO_LARGE",
            `File exceeds the ${Math.floor(env.IMPORT_MAX_FILE_BYTES / 1024 / 1024)} MB limit.`,
          ),
        );
        return;
      }
      next(new AppError("UPLOAD_INVALID", error.message));
      return;
    }
    if (error) {
      next(new AppError("UPLOAD_INVALID", "The upload could not be processed."));
      return;
    }
    next();
  });
};