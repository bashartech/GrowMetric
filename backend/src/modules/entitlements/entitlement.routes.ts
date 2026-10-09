import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { tenantGuard } from "../../middleware/tenant-guard.js";
import { validate } from "../../middleware/validate.js";
import { usageSchema } from "./entitlement.schema.js";
import {
  getEntitlementsController,
  getUsageController,
  postUsageController,
} from "./entitlement.controller.js";

export const entitlementRouter = Router();

entitlementRouter.get(
  "/entitlements",
  requireAuth,
  tenantGuard,
  getEntitlementsController,
);
entitlementRouter.get("/usage", requireAuth, tenantGuard, getUsageController);
entitlementRouter.post(
  "/usage",
  requireAuth,
  tenantGuard,
  validate({ body: usageSchema }),
  postUsageController,
);
