import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { tenantGuard } from "../../middleware/tenant-guard.js";
import { validate } from "../../middleware/validate.js";
import { uploadSingleFile } from "../../middleware/upload.js";
import {
  listDatasetsController,
  getDatasetController,
  updateDatasetController,
  getDatasetVersionsController,
  getDatasetRowsController,
  confirmMappingController,
  reimportController,
} from "./dataset.controller.js";
import {
  updateDatasetSchema,
  getDatasetRowsSchema,
  confirmMappingSchema,
  reimportSchema,
} from "./dataset.schema.js";

export const datasetRouter = Router();

datasetRouter.use(requireAuth);
datasetRouter.use(tenantGuard);

// List datasets
datasetRouter.get("/", listDatasetsController);

// Get single dataset
datasetRouter.get("/:id", getDatasetController);

// Update dataset
datasetRouter.patch(
  "/:id",
  validate({ body: updateDatasetSchema }),
  updateDatasetController,
);

// Get dataset versions
datasetRouter.get("/:id/versions", getDatasetVersionsController);

// Get dataset rows
datasetRouter.get(
  "/:id/rows",
  validate({ query: getDatasetRowsSchema }),
  getDatasetRowsController,
);

// Confirm column mappings for an import paused at REQUESTING_MAPPING
datasetRouter.post(
  "/:id/confirm-mapping",
  validate({ body: confirmMappingSchema }),
  confirmMappingController,
);

// Re-import a file into an existing dataset (append/replace/upsert)
datasetRouter.post(
  "/:id/re-import",
  uploadSingleFile,
  validate({ body: reimportSchema }),
  reimportController,
);
