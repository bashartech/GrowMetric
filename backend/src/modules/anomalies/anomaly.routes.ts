import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { tenantGuard } from "../../middleware/tenant-guard.js";
import { validate } from "../../middleware/validate.js";
import { anomalyController } from "./anomaly.controller.js";
import { listAnomaliesQuerySchema } from "./anomaly.schema.js";

export const anomalyRouter = Router();

anomalyRouter.use(requireAuth);
anomalyRouter.use(tenantGuard);

// Detection itself runs on the scheduler, so there is no user-triggered route
// to gate here. Reading and triaging anomalies is deliberately ungated: a
// tenant that downgrades must still be able to see and resolve what it already
// detected, otherwise those rows become unreachable forever.
anomalyRouter.get("/", validate({ query: listAnomaliesQuerySchema }), anomalyController.list);
anomalyRouter.get("/:id", anomalyController.detail);
anomalyRouter.patch("/:id/acknowledge", anomalyController.acknowledge);
anomalyRouter.patch("/:id/resolve", anomalyController.resolve);
