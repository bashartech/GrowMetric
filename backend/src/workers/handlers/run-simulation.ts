import { Prisma } from "@prisma/client";
import type { Job, SimulationScenario } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { completeJob, failJob } from "../../jobs/queue.js";
import {
  insufficientAlternative,
  simulateScenario,
  SIMULATION_MODEL_VERSION,
  type SimulationInput,
} from "../../lib/simulation.js";
import { computeMetric } from "../../modules/analytics/metrics.service.js";
import { logger } from "../../lib/logger.js";
import { recordUsage } from "../../modules/entitlements/entitlement.service.js";

export interface RunSimulationPayload {
  simulationScenarioId: string;
}

/**
 * Thin wrapper for RUN_SIMULATION: claim → derive the baseline metric from the
 * dataset (never invented) → run the deterministic model → persist
 * SimulationResult rows + AgentRun → complete.
 */
export async function processRunSimulationJob(job: Job): Promise<void> {
  const payload = (job.payload ?? {}) as unknown as RunSimulationPayload;
  if (!payload.simulationScenarioId) {
    await failJob(job.id, "RUN_SIMULATION payload is missing simulationScenarioId.");
    return;
  }

  const scenario = await prisma.simulationScenario.findUnique({
    where: { id: payload.simulationScenarioId },
  });
  if (!scenario) {
    await failJob(job.id, `Simulation scenario ${payload.simulationScenarioId} not found.`);
    return;
  }

  const simulation = await prisma.simulation.findUnique({
    where: { id: scenario.simulationId },
  });
  if (!simulation) {
    await failJob(job.id, `Simulation ${scenario.simulationId} not found.`);
    return;
  }

  if (scenario.status !== "PENDING") {
    await completeJob(job.id);
    return;
  }

  await prisma.simulationScenario.update({
    where: { id: scenario.id },
    data: { status: "RUNNING" },
  });

  const agentRun = await prisma.agentRun.create({
    data: {
      organizationId: simulation.organizationId,
      workspaceId: simulation.workspaceId,
      kind: "SIMULATION",
      jobId: job.id,
      model: SIMULATION_MODEL_VERSION,
      promptVersion: SIMULATION_MODEL_VERSION,
      status: "RUNNING",
      runKey: `simulation:${scenario.id}:${job.id}`,
      simulationScenarioId: scenario.id,
      startedAt: new Date(),
      toolsUsed: [],
    },
  });

  try {
    const input = await buildSimulationInput(scenario, simulation.datasetId, simulation.organizationId, simulation.workspaceId);
    const outcome = simulateScenario(input);

    if (outcome.status === "INSUFFICIENT_DATA") {
      const alternative = insufficientAlternative(outcome.metricKey, outcome.reason);
      await prisma.$transaction([
        prisma.simulationScenario.update({
          where: { id: scenario.id },
          data: {
            status: "INSUFFICIENT_DATA",
            error: outcome.reason,
            sensitivityAlternative: alternative as unknown as Prisma.InputJsonValue,
          },
        }),
        prisma.agentRun.update({
          where: { id: agentRun.id },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
            latencyMs: 0,
            toolsUsed: ["calculate_metric"],
          },
        }),
      ]);
      await recordUsage(simulation.organizationId, "ai_runs", 1).catch(
        (error) =>
          logger.warn({ organizationId: simulation.organizationId, error }, "Usage recording for ai_runs skipped."),
      );
    } else if (outcome.status === "COMPLETED") {
      await prisma.$transaction([
        prisma.simulationResult.create({
          data: {
            simulationScenarioId: scenario.id,
            metricKey: outcome.metricKey,
            currentValue: outcome.currentValue,
            projectedValue: outcome.projectedValue,
            changePct: outcome.changePct,
            confidence: outcome.confidence,
            isEstimate: outcome.isEstimate,
            assumptionKey: null,
          },
        }),
        prisma.simulationScenario.update({
          where: { id: scenario.id },
          data: { status: "COMPLETED", confidence: outcome.confidence },
        }),
        prisma.agentRun.update({
          where: { id: agentRun.id },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
            latencyMs: 0,
            steps: 1,
            toolsUsed: ["calculate_metric", "simulate_scenario"],
          },
        }),
      ]);
      await recordUsage(simulation.organizationId, "ai_runs", 1).catch(
        (error) =>
          logger.warn({ organizationId: simulation.organizationId, error }, "Usage recording for ai_runs skipped."),
      );
    }

    logger.info(
      { scenarioId: scenario.id, status: outcome.status },
      "Simulation scenario resolved.",
    );
    await completeJob(job.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown simulation failure.";
    await prisma.simulationScenario.update({
      where: { id: scenario.id },
      data: { status: "FAILED", error: message },
    });
    await prisma.agentRun.update({
      where: { id: agentRun.id },
      data: { status: "FAILED", error: message, completedAt: new Date() },
    });
    logger.error({ scenarioId: scenario.id, error }, "Simulation job failed.");
    await failJob(job.id, message);
  }
}

async function buildSimulationInput(
  scenario: SimulationScenario,
  simulationDatasetId: string | null,
  organizationId: string,
  workspaceId: string,
): Promise<SimulationInput> {
  const stored = scenario.parameters as { metricKey?: string; datasetId?: string | null; values?: Record<string, number> };
  const metricKey = String(stored.metricKey ?? "revenue");
  const parameters = stored.values ?? {};
  const datasetId = stored.datasetId ?? simulationDatasetId;

  let currentValue: number | null = null;
  if (datasetId && isKnownMetricKind(metricKey)) {
    try {
      const metric = await computeMetric(
        {
          datasetId,
          metricKind: metricKey.toUpperCase() as ComputeMetricKey,
        },
        organizationId,
        workspaceId,
      );
      currentValue = metric.value;
    } catch {
      currentValue = null;
    }
  }

  const assumptions = (scenario.assumptions ?? {}) as Record<string, number>;
  return {
    type: scenario.type,
    metricKey,
    currentValue,
    assumptions,
    parameters: { ...(parameters ?? {}) },
  };
}

type ComputeMetricKey = "REVENUE" | "ORDERS" | "CUSTOMERS" | "EXPENSES" | "PROFIT" | "INVENTORY";

const KNOWN_METRIC_KINDS = new Set<ComputeMetricKey>([
  "REVENUE",
  "ORDERS",
  "CUSTOMERS",
  "EXPENSES",
  "PROFIT",
  "INVENTORY",
]);

function isKnownMetricKind(key: string): boolean {
  return KNOWN_METRIC_KINDS.has(key.toUpperCase() as ComputeMetricKey);
}