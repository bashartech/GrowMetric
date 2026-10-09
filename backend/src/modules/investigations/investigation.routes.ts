import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { tenantGuard } from "../../middleware/tenant-guard.js";
import { validate } from "../../middleware/validate.js";
import { requireEntitlement } from "../entitlements/entitlement.middleware.js";
import {
  createInvestigationController,
  getInvestigationController,
  listInvestigationsController,
} from "./investigation.controller.js";
import {
  createInvestigationSchema,
  investigationParamsSchema,
} from "./investigation.schema.js";

export const investigationRouter = Router();

investigationRouter.use(requireAuth);
investigationRouter.use(tenantGuard);
investigationRouter.use(requireEntitlement("aiConversations"));

investigationRouter.post(
  "/investigations",
  validate({ body: createInvestigationSchema }),
  createInvestigationController,
);

investigationRouter.get("/investigations", listInvestigationsController);

investigationRouter.get(
  "/investigations/:id",
  validate({ params: investigationParamsSchema }),
  getInvestigationController,
);