import { asyncHandler } from "../../lib/async-handler.js";
import { ok } from "../../lib/respond.js";
import type { UsageInput } from "./entitlement.schema.js";
import * as service from "./entitlement.service.js";

export const getEntitlementsController = asyncHandler(async (req, res) => {
  const entitlements = await service.getEntitlements(req.tenant!.organizationId);
  ok(res, entitlements);
});

export const getUsageController = asyncHandler(async (req, res) => {
  const metric =
    typeof req.query.metric === "string" && req.query.metric.length > 0
      ? req.query.metric
      : undefined;

  const usage = await service.getUsage(req.tenant!.organizationId, metric);
  ok(res, usage);
});

export const postUsageController = asyncHandler(async (req, res) => {
  const { metric, amount } = req.body as UsageInput;
  const usage = await service.recordUsage(
    req.tenant!.organizationId,
    metric,
    amount,
  );
  ok(res, usage);
});
