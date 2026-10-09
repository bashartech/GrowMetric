import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { tenantGuard } from "../../middleware/tenant-guard.js";
import { validate } from "../../middleware/validate.js";
import { requireEntitlement } from "../entitlements/entitlement.middleware.js";
import { reportScheduleController } from "./report-schedule.controller.js";
import { createReportScheduleSchema, updateReportScheduleSchema } from "./report.schema.js";

export const reportScheduleRouter = Router();

reportScheduleRouter.use(requireAuth);
reportScheduleRouter.use(tenantGuard);

reportScheduleRouter.get("/", reportScheduleController.list);
reportScheduleRouter.get("/:id", reportScheduleController.get);

// A schedule is a standing order to generate reports, so it is metered against
// the same `reports` quota as manual generation. Re-enabling an existing
// schedule is gated too, otherwise a tenant could disable at the limit and then
// switch every schedule back on.
reportScheduleRouter.post(
  "/",
  requireEntitlement("reports"),
  validate({ body: createReportScheduleSchema }),
  reportScheduleController.create,
);
reportScheduleRouter.patch(
  "/:id",
  requireEntitlement("reports"),
  validate({ body: updateReportScheduleSchema }),
  reportScheduleController.update,
);
reportScheduleRouter.delete("/:id", requireEntitlement("reports"), reportScheduleController.remove);

export default reportScheduleRouter;
