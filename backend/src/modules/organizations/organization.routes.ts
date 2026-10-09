import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { tenantGuard } from "../../middleware/tenant-guard.js";
import { validate } from "../../middleware/validate.js";
import {
  getCurrentOrganizationController,
  updateCurrentOrganizationController,
} from "./organization.controller.js";
import { updateOrganizationSchema } from "./organization.schema.js";

export const organizationRouter = Router();

organizationRouter.use(requireAuth, tenantGuard);

organizationRouter.get("/current", getCurrentOrganizationController);
organizationRouter.patch(
  "/current",
  validate({ body: updateOrganizationSchema }),
  updateCurrentOrganizationController,
);
