import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { tenantGuard } from "../../middleware/tenant-guard.js";
import { validate } from "../../middleware/validate.js";
import { requireEntitlement } from "../entitlements/entitlement.middleware.js";
import {
  createScenarioController,
  createSimulationController,
  explainScenarioController,
  getScenarioController,
  listSimulationsController,
} from "./simulation.controller.js";
import {
  createScenarioSchema,
  createSimulationSchema,
  scenarioParamsSchema,
  simulationParamsSchema,
} from "./simulation.schema.js";

export const simulationRouter = Router();

simulationRouter.use(requireAuth);
simulationRouter.use(tenantGuard);
simulationRouter.use(requireEntitlement("aiConversations"));

simulationRouter.post(
  "/simulations",
  validate({ body: createSimulationSchema }),
  createSimulationController,
);

simulationRouter.get("/simulations", listSimulationsController);

simulationRouter.post(
  "/simulations/:id/scenarios",
  validate({ params: simulationParamsSchema, body: createScenarioSchema }),
  createScenarioController,
);

simulationRouter.get(
  "/simulations/:id/scenarios/:scenarioId",
  validate({ params: scenarioParamsSchema }),
  getScenarioController,
);

simulationRouter.post(
  "/simulations/:id/scenarios/:scenarioId/explain",
  validate({ params: scenarioParamsSchema }),
  explainScenarioController,
);