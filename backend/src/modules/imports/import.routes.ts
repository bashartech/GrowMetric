import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { tenantGuard } from "../../middleware/tenant-guard.js";
import { validate } from "../../middleware/validate.js";
import {
  listImportsController,
  getImportController,
  cancelImportController,
  retryImportController,
} from "./import.controller.js";
import { listImportsQuerySchema } from "./import.schema.js";

export const importRouter = Router();

importRouter.use(requireAuth);
importRouter.use(tenantGuard);

// List imports
importRouter.get("/", validate({ query: listImportsQuerySchema }), listImportsController);

// Get single import
importRouter.get("/:id", getImportController);

// Cancel import
importRouter.post("/:id/cancel", cancelImportController);

// Retry failed import
importRouter.post("/:id/retry", retryImportController);
