import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { tenantGuard } from "../../middleware/tenant-guard.js";
import { validate } from "../../middleware/validate.js";
import { RecommendationController } from "./recommendation.controller.js";
import { listRecommendationsSchema } from "./recommendation.schema.js";

const recommendationRouter = Router();

recommendationRouter.use(requireAuth);
// This router was the only Phase 4 router without a tenant guard, so
// `req.tenant` was undefined and the controller fell back to `req.user`.
recommendationRouter.use(tenantGuard);

recommendationRouter.get("/", validate({ query: listRecommendationsSchema }), RecommendationController.list);
recommendationRouter.get("/:id", RecommendationController.get);
recommendationRouter.patch("/:id/status", RecommendationController.updateStatus);
recommendationRouter.patch("/:id/acknowledge", RecommendationController.acknowledge);
recommendationRouter.patch("/:id/resolve", RecommendationController.resolve);
recommendationRouter.patch("/:id/dismiss", RecommendationController.dismiss);

// Deliberately not entitlement-gated. `generate` only recomputes suggestions
// from anomalies and alerts that already exist; it makes no LLM call, and no
// plan defines a `recommendations` feature key. Gating it on `aiConversations`
// charged tenants an AI quota for a non-AI action and 402'd the free plan,
// while the anomaly worker already refreshes these same rows for free as part
// of a capability that *is* gated (`anomalyDetection`).
recommendationRouter.post("/generate", RecommendationController.generate);

export default recommendationRouter;
