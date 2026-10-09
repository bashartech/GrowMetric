import { asyncHandler } from "../../lib/async-handler.js";
import { ok } from "../../lib/respond.js";
import * as service from "./simulation.service.js";
import type { CreateScenarioInput, CreateSimulationInput } from "./simulation.schema.js";

export const createSimulationController = asyncHandler(async (req, res) => {
  const body = req.body as CreateSimulationInput;
  const result = await service.createSimulation({
    name: body.name,
    datasetId: body.datasetId,
    organizationId: req.user!.organizationId,
    workspaceId: req.user!.workspaceId,
    createdById: req.user!.id,
  });
  ok(res, result, 201);
});

export const listSimulationsController = asyncHandler(async (req, res) => {
  const result = await service.listSimulations(
    req.user!.organizationId,
    req.user!.workspaceId,
  );
  ok(res, result);
});

export const createScenarioController = asyncHandler(async (req, res) => {
  const body = req.body as CreateScenarioInput;
  const result = await service.createScenario({
    simulationId: req.params.id as string,
    name: body.name,
    type: body.type,
    parameters: body.parameters,
    datasetId: body.datasetId,
    organizationId: req.user!.organizationId,
    workspaceId: req.user!.workspaceId,
  });
  ok(res, result, 202);
});

export const getScenarioController = asyncHandler(async (req, res) => {
  const result = await service.getScenario(
    req.params.id as string,
    req.params.scenarioId as string,
    req.user!.organizationId,
    req.user!.workspaceId,
  );
  ok(res, result);
});

export const explainScenarioController = asyncHandler(async (req, res) => {
  const result = await service.explainScenario(
    req.params.id as string,
    req.params.scenarioId as string,
    req.user!.organizationId,
    req.user!.workspaceId,
  );
  ok(res, result);
});