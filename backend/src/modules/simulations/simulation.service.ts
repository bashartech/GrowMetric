import { Prisma } from "@prisma/client";
import type { DatasetStatus, SimulationScenario, SimulationType } from "@prisma/client";
import { AppError, notFound } from "../../lib/http-errors.js";
import { prisma } from "../../lib/prisma.js";
import { enqueueJob } from "../../jobs/queue.js";
import { record } from "../audit/audit.service.js";
import { recordUsage } from "../entitlements/entitlement.service.js";
import {
  buildExplanation,
  requiredParametersFor,
  SIMULATION_MODEL_VERSION,
  type InsufficientAlternative,
} from "../../lib/simulation.js";

const READY_STATUSES: DatasetStatus[] = ["READY", "READY_WITH_WARNINGS"];

export const SIMULATION_DISCLAIMER = "Projection — estimate, not a guarantee.";

const OPTIONAL_ASSUMPTIONS: Record<SimulationType, string[]> = {
  PRICE_CHANGE: ["elasticity"],
  MARKETING_SPEND: [],
  EXPENSE_REDUCTION: [],
  INVENTORY_CHANGE: [],
  CUSTOM: ["pctChange"],
};

export interface CreateSimulationInput {
  name: string;
  datasetId?: string;
  organizationId: string;
  workspaceId: string;
  createdById: string;
}

export interface CreateScenarioInput {
  simulationId: string;
  name: string;
  type: SimulationType;
  parameters: Record<string, number>;
  datasetId?: string;
  organizationId: string;
  workspaceId: string;
}

export interface SimulationListItemDTO {
  id: string;
  name: string;
  datasetId: string | null;
  status: string;
  scenarioCount: number;
  latestScenarioStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScenarioAssumptionDTO {
  key: string;
  value: number;
  source: "user";
}

export interface ScenarioResultDTO {
  metricKey: string;
  currentValue: number;
  projectedValue: number;
  changePct: number;
  confidence: number | null;
  isEstimate: boolean;
}

export interface ScenarioDetailDTO {
  id: string;
  simulationId: string;
  name: string;
  type: string;
  status: string;
  parameters: Record<string, number>;
  assumptions: ScenarioAssumptionDTO[];
  confidence: number | null;
  results: ScenarioResultDTO[];
  disclaimer: string;
  isEstimate: boolean;
  sensitivityAlternative: InsufficientAlternative | null;
  modelVersion: string;
  error: string | null;
  explanation: {
    agentRunId: string;
    status: string;
    content: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

async function audit(
  organizationId: string,
  workspaceId: string,
  action: string,
  resourceId: string,
  reason: string,
): Promise<void> {
  await record({
    organizationId,
    workspaceId,
    action,
    resourceType: "simulation",
    resourceId,
    metadata: { reason },
  }).catch(() => undefined);
}

/** Resolves and validates a dataset (owned + analytics-ready) for a study/scenario. Returns null when none given. */
async function resolveReadyDataset(
  input: { datasetId?: string | null; organizationId: string; workspaceId: string },
): Promise<string | null> {
  const datasetId = input.datasetId ?? null;
  if (!datasetId) return null;

  const dataset = await prisma.dataset.findFirst({
    where: { id: datasetId, organizationId: input.organizationId, workspaceId: input.workspaceId },
    select: { id: true, currentVersionId: true, status: true },
  });
  if (!dataset || !dataset.currentVersionId) {
    throw notFound("Dataset not found");
  }
  if (!READY_STATUSES.includes(dataset.status)) {
    throw new AppError(
      "CONFLICT",
      `Dataset is not analytics-ready (status: ${dataset.status}).`,
      { ready: false },
    );
  }
  return dataset.id;
}

function validateScenarioParameters(type: SimulationType, parameters: Record<string, number>): void {
  const required = requiredParametersFor(type);
  const missing = required.filter((key) => !Number.isFinite(parameters[key]));
  if (missing.length > 0) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Scenario type ${type} requires numeric parameter(s): ${missing.join(", ")}.`,
      { missing },
    );
  }
}

function assumptionsFor(
  type: SimulationType,
  parameters: Record<string, number>,
): Record<string, number> {
  const assumptions: Record<string, number> = {};
  for (const key of OPTIONAL_ASSUMPTIONS[type]) {
    const value = parameters[key];
    if (value !== undefined && Number.isFinite(value)) assumptions[key] = value;
  }
  return assumptions;
}

export async function createSimulation(input: CreateSimulationInput) {
  const datasetId = await resolveReadyDataset(input);

  const simulation = await prisma.simulation.create({
    data: {
      name: input.name,
      datasetId,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      createdById: input.createdById,
    },
    select: { id: true, name: true, datasetId: true, status: true, createdAt: true },
  });

  await audit(
    input.organizationId,
    input.workspaceId,
    "AI_SIMULATION_CREATE",
    simulation.id,
    "study-created",
  );

  return {
    id: simulation.id,
    name: simulation.name,
    datasetId: simulation.datasetId,
    status: simulation.status,
    createdAt: simulation.createdAt.toISOString(),
  };
}

export async function listSimulations(
  organizationId: string,
  workspaceId: string,
): Promise<{ items: SimulationListItemDTO[]; meta: { page: number; perPage: number; total: number } }> {
  const [rows, total] = await prisma.$transaction([
    prisma.simulation.findMany({
      where: { organizationId, workspaceId },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { scenarios: true } },
        scenarios: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } },
      },
      take: 100,
    }),
    prisma.simulation.count({ where: { organizationId, workspaceId } }),
  ]);

  const items: SimulationListItemDTO[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    datasetId: row.datasetId,
    status: row.status,
    scenarioCount: row._count.scenarios,
    latestScenarioStatus: row.scenarios[0]?.status ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));

  return { items, meta: { page: 1, perPage: 20, total } };
}

export async function createScenario(input: CreateScenarioInput) {
  const simulation = await prisma.simulation.findFirst({
    where: { id: input.simulationId, organizationId: input.organizationId, workspaceId: input.workspaceId },
    select: { id: true, datasetId: true },
  });
  if (!simulation) {
    await audit(input.organizationId, input.workspaceId, "AI_SIMULATION_SCENARIO_CREATE", input.simulationId, "foreign-or-unknown");
    throw notFound("Simulation not found");
  }

  validateScenarioParameters(input.type, input.parameters);

  const datasetId = await resolveReadyDataset({
    datasetId: input.datasetId ?? simulation.datasetId,
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
  });

  const storedParameters = {
    metricKey: "revenue",
    datasetId,
    values: { ...input.parameters },
  };

  const scenario = await prisma.simulationScenario.create({
    data: {
      simulationId: simulation.id,
      name: input.name,
      type: input.type,
      parameters: storedParameters as Prisma.InputJsonValue,
      assumptions: assumptionsFor(input.type, input.parameters) as Prisma.InputJsonValue,
      modelVersion: SIMULATION_MODEL_VERSION,
    },
    select: { id: true, simulationId: true, name: true, type: true, status: true, assumptions: true },
  });

  await recordUsage(input.organizationId, "ai_runs", 1).catch(() => undefined);

  const job = await enqueueJob({
    type: "RUN_SIMULATION",
    organizationId: input.organizationId,
    payload: { simulationScenarioId: scenario.id },
  });

  const assumptionEntries = Object.entries(
    (scenario.assumptions as Record<string, number> | null) ?? {},
  ).map(([key, value]) => ({ key, value, source: "user" as const }));

  return {
    id: scenario.id,
    simulationId: scenario.simulationId,
    name: scenario.name,
    type: scenario.type,
    status: "RUNNING",
    jobId: job.id,
    assumptions: assumptionEntries,
  };
}

async function findScenario(
  simulationId: string,
  scenarioId: string,
  organizationId: string,
  workspaceId: string,
): Promise<SimulationScenario & { simulation: { id: string; name: string } }> {
  const scenario = await prisma.simulationScenario.findFirst({
    where: {
      id: scenarioId,
      simulation: { id: simulationId, organizationId, workspaceId },
    },
    include: { simulation: { select: { id: true, name: true } } },
  });
  if (!scenario) {
    await audit(organizationId, workspaceId, "AI_SIMULATION_SCENARIO_READ", scenarioId, "foreign-or-unknown");
    throw notFound("Scenario not found");
  }
  return scenario;
}

export async function getScenario(
  simulationId: string,
  scenarioId: string,
  organizationId: string,
  workspaceId: string,
): Promise<ScenarioDetailDTO> {
  const scenario = await findScenario(simulationId, scenarioId, organizationId, workspaceId);

  const [results, runs] = await prisma.$transaction([
    prisma.simulationResult.findMany({
      where: { simulationScenarioId: scenario.id },
      orderBy: { createdAt: "asc" },
    }),
    prisma.agentRun.findMany({
      where: { simulationScenarioId: scenario.id, kind: "SIMULATION" },
      orderBy: { createdAt: "desc" },
      take: 2,
    }),
  ]);

  const completed = scenario.status === "COMPLETED" && results.length > 0;
  const resultRows: ScenarioResultDTO[] = results.map((row) => ({
    metricKey: row.metricKey,
    currentValue: Number(row.currentValue),
    projectedValue: Number(row.projectedValue),
    changePct: Number(row.changePct),
    confidence: row.confidence === null ? null : Number(row.confidence),
    isEstimate: row.isEstimate,
  }));
  const confidence = scenario.confidence === null ? null : Number(scenario.confidence);

  const assumptionEntries: ScenarioAssumptionDTO[] = Object.entries(
    (scenario.assumptions as Record<string, number> | null) ?? {},
  ).map(([key, value]) => ({ key, value, source: "user" as const }));

  const sensitivityAlternative = (scenario.sensitivityAlternative as
    | InsufficientAlternative
    | null
    | string) ?? null;
  const parsedAlternative =
    typeof sensitivityAlternative === "string"
      ? null
      : sensitivityAlternative;

  let explanation: ScenarioDetailDTO["explanation"] = null;
  const explainRun = runs.find((run) => run.runKey.startsWith("simulation-explain:"));
  if (explainRun) {
    const content = completed
      ? buildExplanation(
          { name: scenario.name, type: scenario.type, modelVersion: scenario.modelVersion },
          {
            metricKey: resultRows[0]!.metricKey,
            currentValue: resultRows[0]!.currentValue,
            projectedValue: resultRows[0]!.projectedValue,
            changePct: resultRows[0]!.changePct,
            confidence: resultRows[0]!.confidence ?? 0,
          },
          assumptionEntries,
        )
      : "An explanation is only available once the scenario has produced a projection. This scenario ended without recorded results, so there is nothing to tie figures to.";
    explanation = {
      agentRunId: explainRun.id,
      status: explainRun.status,
      content,
    };
  }

  return {
    id: scenario.id,
    simulationId: scenario.simulation.id,
    name: scenario.name,
    type: scenario.type,
    status: scenario.status,
    parameters: ((scenario.parameters as { values?: Record<string, number> }).values ?? {}) as Record<string, number>,
    assumptions: assumptionEntries,
    confidence,
    results: resultRows,
    disclaimer: SIMULATION_DISCLAIMER,
    isEstimate: completed,
    sensitivityAlternative: parsedAlternative,
    modelVersion: scenario.modelVersion,
    error: scenario.error,
    explanation,
    createdAt: scenario.createdAt.toISOString(),
    updatedAt: scenario.updatedAt.toISOString(),
  };
}

export async function explainScenario(
  simulationId: string,
  scenarioId: string,
  organizationId: string,
  workspaceId: string,
): Promise<{ agentRunId: string; status: string }> {
  const scenario = await findScenario(simulationId, scenarioId, organizationId, workspaceId);

  const explainRun = await prisma.agentRun.create({
    data: {
      organizationId,
      workspaceId,
      kind: "SIMULATION",
      model: SIMULATION_MODEL_VERSION,
      promptVersion: SIMULATION_MODEL_VERSION,
      status: "COMPLETED",
      runKey: `simulation-explain:${scenario.id}:${Date.now()}`,
      simulationScenarioId: scenario.id,
      startedAt: new Date(),
      completedAt: new Date(),
      steps: 1,
      toolsUsed: ["simulate_scenario"],
    },
    select: { id: true, status: true },
  });

  return { agentRunId: explainRun.id, status: explainRun.status };
}