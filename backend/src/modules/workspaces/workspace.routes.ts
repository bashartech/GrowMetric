import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { tenantGuard } from "../../middleware/tenant-guard.js";
import { validate } from "../../middleware/validate.js";
import {
  getCurrentWorkspaceController,
  listWorkspacesController,
  updateWorkspaceController,
} from "./workspace.controller.js";
import { updateWorkspaceSchema } from "./workspace.schema.js";

export const workspaceRouter = Router();

workspaceRouter.use(requireAuth, tenantGuard);

workspaceRouter.get("/", listWorkspacesController);
workspaceRouter.get("/current", getCurrentWorkspaceController);
workspaceRouter.patch(
  "/:id",
  validate({ body: updateWorkspaceSchema }),
  updateWorkspaceController,
);
