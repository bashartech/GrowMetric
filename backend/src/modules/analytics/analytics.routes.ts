import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { tenantGuard } from "../../middleware/tenant-guard.js";
import { validate } from "../../middleware/validate.js";
import {
  metricsController,
  comparePeriodsController,
  groupByController,
  metricCatalogController,
} from "./metrics.controller.js";
import {
  metricsQuerySchema,
  comparePeriodsSchema,
  groupBySchema,
} from "./metrics.schema.js";

export const analyticsRouter = Router();

analyticsRouter.use(requireAuth);
analyticsRouter.use(tenantGuard);

// The canonical metric list the report builder and alert-rule form render.
// Declared before the POST routes; it is a GET so ordering is cosmetic only.
analyticsRouter.get("/metric-catalog", metricCatalogController);

// Aggregate a canonical metric with optional filters
analyticsRouter.post("/metrics", validate({ body: metricsQuerySchema }), metricsController);

// Compare a canonical metric across two equal-length periods
analyticsRouter.post(
  "/compare-periods",
  validate({ body: comparePeriodsSchema }),
  comparePeriodsController,
);

// Group an aggregate by a dimension column
analyticsRouter.post("/group-by", validate({ body: groupBySchema }), groupByController);