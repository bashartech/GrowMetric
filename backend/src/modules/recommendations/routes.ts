import { Router } from "express";
import { RecommendationController } from "./recommendation.controller.js";
import { requireAuth } from "../../middleware/auth.js";
import { tenantGuard } from "../../middleware/tenant-guard.js";
import { recommendationFilterSchema } from "./recommendation.schema.js";
import { validate } from "../../middleware/validate.js";

const router = Router();

router.use(requireAuth);
router.use(tenantGuard);

router.post("/generate", RecommendationController.generate);
router.get("/", validate({ query: recommendationFilterSchema }), RecommendationController.list);
router.get("/:id", RecommendationController.get);
router.patch("/:id/status", RecommendationController.updateStatus);
router.patch("/:id/acknowledge", RecommendationController.acknowledge);
router.patch("/:id/resolve", RecommendationController.resolve);
router.patch("/:id/dismiss", RecommendationController.dismiss);

export default router;
