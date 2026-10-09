import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { tenantGuard } from "../../middleware/tenant-guard.js";
import { validate } from "../../middleware/validate.js";
import { uploadSingleFile } from "../../middleware/upload.js";
import {
  createFileSourceController,
  createExternalDbSourceController,
  listDataSourcesController,
  getDataSourceController,
  updateDataSourceController,
  deleteDataSourceController,
  listDataSourceTablesController,
  updateTableSelectionController,
  syncDataSourceController,
} from "./data-source.controller.js";
import {
  createFileSourceSchema,
  createExternalDbSourceSchema,
  updateDataSourceSchema,
  updateTableSelectionSchema,
} from "./data-source.schema.js";

export const dataSourceRouter = Router();

dataSourceRouter.use(requireAuth);
dataSourceRouter.use(tenantGuard);

// Create file data source
dataSourceRouter.post(
  "/",
  uploadSingleFile,
  validate({ body: createFileSourceSchema }),
  createFileSourceController,
);

// Create external database data source
dataSourceRouter.post(
  "/external-db",
  validate({ body: createExternalDbSourceSchema }),
  createExternalDbSourceController,
);

// List data sources
dataSourceRouter.get("/", listDataSourcesController);

// Get single data source
dataSourceRouter.get("/:id", getDataSourceController);

// Update data source
dataSourceRouter.patch(
  "/:id",
  validate({ body: updateDataSourceSchema }),
  updateDataSourceController,
);

// Delete data source
dataSourceRouter.delete("/:id", deleteDataSourceController);

// External DB table operations
dataSourceRouter.get("/:id/tables", listDataSourceTablesController);
dataSourceRouter.patch(
  "/:id/tables",
  validate({ body: updateTableSelectionSchema }),
  updateTableSelectionController,
);

// Start external DB sync (selected tables -> datasets)
dataSourceRouter.post("/:id/sync", syncDataSourceController);
