import { Request, Response, NextFunction } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { ok } from "../../lib/respond.js";
import * as service from "./anomaly.service.js";
import { listAnomaliesQuerySchema } from "./anomaly.schema.js";

export const anomalyController = {
  list: asyncHandler(async (_req: Request, res: Response, _next: NextFunction) => {
    const input = listAnomaliesQuerySchema.parse(_req.query);
    const result = await service.listAnomalies(
      _req.user!.organizationId!,
      _req.user!.workspaceId!,
      { status: input.status, metricKind: input.metricKind, page: input.page, limit: input.limit },
    );
    ok(res, result);
  }),

  detail: asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const anomaly = await service.getAnomaly(req.params.id!, req.user!.organizationId!);
    if (!anomaly) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Anomaly not found." } });
      return;
    }
    ok(res, anomaly);
  }),

  acknowledge: asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const anomaly = await service.updateAnomalyStatus(req.params.id!, req.user!.organizationId!, "ACKNOWLEDGED");
    if (!anomaly) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Anomaly not found." } });
      return;
    }
    ok(res, anomaly);
  }),

  resolve: asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const anomaly = await service.updateAnomalyStatus(req.params.id!, req.user!.organizationId!, "RESOLVED");
    if (!anomaly) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Anomaly not found." } });
      return;
    }
    ok(res, anomaly);
  }),
};
