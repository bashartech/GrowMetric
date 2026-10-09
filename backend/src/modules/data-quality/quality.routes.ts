import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { tenantGuard } from "../../middleware/tenant-guard.js";
import {
  getQualityReportController,
  recomputeQualityController,
} from "./quality.controller.js";

export const qualityRouter = Router();

qualityRouter.use(requireAuth);
qualityRouter.use(tenantGuard);

// Get quality report for dataset
qualityRouter.get("/:datasetId/quality", getQualityReportController);

// Recompute quality report
qualityRouter.post("/:datasetId/quality/recompute", recomputeQualityController);
