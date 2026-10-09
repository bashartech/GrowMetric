import { asyncHandler } from "../../lib/async-handler.js";
import { ok } from "../../lib/respond.js";
import * as service from "./investigation.service.js";
import type { CreateInvestigationInput } from "./investigation.schema.js";

export const createInvestigationController = asyncHandler(async (req, res) => {
  const body = req.body as CreateInvestigationInput;
  const result = await service.createInvestigation({
    title: body.title,
    question: body.question,
    topic: body.topic,
    datasetId: body.datasetId,
    periodPreset: body.periodPreset,
    periodTarget: body.periodTarget,
    periodBaseline: body.periodBaseline,
    organizationId: req.user!.organizationId,
    workspaceId: req.user!.workspaceId,
    createdById: req.user!.id,
  });
  ok(res, result, 202);
});

export const listInvestigationsController = asyncHandler(async (req, res) => {
  const result = await service.listInvestigations(
    req.user!.organizationId,
    req.user!.workspaceId,
  );
  ok(res, result);
});

export const getInvestigationController = asyncHandler(async (req, res) => {
  const result = await service.getInvestigation(
    req.params.id as string,
    req.user!.organizationId,
    req.user!.workspaceId,
  );
  ok(res, result);
});