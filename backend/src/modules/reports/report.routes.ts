import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { tenantGuard } from "../../middleware/tenant-guard.js";
import { validate } from "../../middleware/validate.js";
import { requireEntitlement } from "../entitlements/entitlement.middleware.js";
import { reportController } from "./report.controller.js";
import { createReportSchema } from "./report.schema.js";

export const reportRouter = Router();

reportRouter.use(requireAuth);
reportRouter.use(tenantGuard);

// Reads stay open on every plan; only the paths that consume a metered report
// are gated. `GET /reports/:id/pdf` is a read of an already-generated report.
reportRouter.get("/", reportController.list);
reportRouter.get("/:id/pdf", reportController.download);
reportRouter.get("/:id", reportController.get);

reportRouter.post(
  "/",
  requireEntitlement("reports"),
  validate({ body: createReportSchema }),
  reportController.create,
);
reportRouter.post("/:id/generate", requireEntitlement("reports"), reportController.generate);
reportRouter.delete("/:id", requireEntitlement("reports"), reportController.remove);

export default reportRouter;
