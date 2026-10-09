import { asyncHandler } from "../../lib/async-handler.js";
import { ok } from "../../lib/respond.js";
import * as service from "./metrics.service.js";
import { CANONICAL_METRICS } from "./metric-catalog.js";
import type {
  ComparePeriodsInput,
  GroupByInput,
  MetricsQueryInput,
} from "./metrics.schema.js";

/**
 * The canonical metric catalog, so the report builder and alert-rule form offer
 * the real metrics instead of a hardcoded list in the browser that can drift
 * from the backend.
 */
export const metricCatalogController = asyncHandler(async (_req, res) => {
  ok(res, { metrics: CANONICAL_METRICS });
});

export const metricsController = asyncHandler(async (req, res) => {
  const input = req.body as MetricsQueryInput;
  const result = await service.computeMetric(
    input,
    req.user!.organizationId,
    req.user!.workspaceId,
  );
  ok(res, result);
});

export const comparePeriodsController = asyncHandler(async (req, res) => {
  const input = req.body as ComparePeriodsInput;
  const result = await service.comparePeriods(
    input,
    req.user!.organizationId,
    req.user!.workspaceId,
  );
  ok(res, result);
});

export const groupByController = asyncHandler(async (req, res) => {
  const input = req.body as GroupByInput;
  const result = await service.groupByMetric(
    input,
    req.user!.organizationId,
    req.user!.workspaceId,
  );
  ok(res, result);
});