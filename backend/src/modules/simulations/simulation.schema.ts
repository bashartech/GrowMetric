import { z } from "zod";

export const SIMULATION_TYPES = [
  "PRICE_CHANGE",
  "MARKETING_SPEND",
  "EXPENSE_REDUCTION",
  "INVENTORY_CHANGE",
  "CUSTOM",
] as const;

export const createSimulationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  datasetId: z.string().uuid().optional(),
});

export const simulationParamsSchema = z.object({
  id: z.string().uuid(),
});

export const scenarioParamsSchema = z.object({
  id: z.string().uuid(),
  scenarioId: z.string().uuid(),
});

export const createScenarioSchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.enum(SIMULATION_TYPES),
  parameters: z.record(z.string(), z.number()).default({}),
  datasetId: z.string().uuid().optional(),
});

export type CreateSimulationInput = z.infer<typeof createSimulationSchema>;
export type CreateScenarioInput = z.infer<typeof createScenarioSchema>;