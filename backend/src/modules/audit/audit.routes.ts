import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { tenantGuard } from "../../middleware/tenant-guard.js";
import { validate } from "../../middleware/validate.js";
import { listAuditLogsController } from "./audit.controller.js";
import { auditQuerySchema } from "./audit.schema.js";

export const auditRouter = Router();

auditRouter.use(requireAuth, tenantGuard);
auditRouter.get(
  "/",
  validate({ query: auditQuerySchema }),
  listAuditLogsController,
);
