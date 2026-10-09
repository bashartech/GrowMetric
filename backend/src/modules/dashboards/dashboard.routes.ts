import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { tenantGuard } from "../../middleware/tenant-guard.js";
import { validate } from "../../middleware/validate.js";
import {
  listDashboardsController,
  getDashboardController,
  createDashboardController,
  updateDashboardController,
  addWidgetController,
  updateWidgetController,
  deleteWidgetController,
  previewDashboardController,
} from "./dashboard.controller.js";
import {
  dashboardNameSchema,
  widgetSchema,
  updateWidgetSchema,
  dashboardPreviewSchema,
} from "./dashboard.schema.js";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);
dashboardRouter.use(tenantGuard);

dashboardRouter.get("/", listDashboardsController);
dashboardRouter.post("/", validate({ body: dashboardNameSchema }), createDashboardController);
dashboardRouter.get("/:id", getDashboardController);
dashboardRouter.patch("/:id", validate({ body: dashboardNameSchema }), updateDashboardController);
dashboardRouter.post(
  "/:id/preview",
  validate({ body: dashboardPreviewSchema }),
  previewDashboardController,
);
dashboardRouter.post("/:id/widgets", validate({ body: widgetSchema }), addWidgetController);
dashboardRouter.patch(
  "/:id/widgets/:widgetId",
  validate({ body: updateWidgetSchema }),
  updateWidgetController,
);
dashboardRouter.delete("/:id/widgets/:widgetId", deleteWidgetController);