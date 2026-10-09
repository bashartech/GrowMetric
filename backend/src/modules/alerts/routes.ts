import { Router } from "express";
import { AlertRuleController } from "./alert-rule.controller.js";
import { AlertController } from "./alert.controller.js";
import { requireAuth } from "../../middleware/auth.js";
import { tenantGuard } from "../../middleware/tenant-guard.js";
import { requireEntitlement } from "../entitlements/entitlement.middleware.js";

const router = Router();

router.use(requireAuth);
router.use(tenantGuard);

// Reading existing alerts is never gated; arming a rule that generates them is.
router.get("/alerts", AlertController.list);
router.get("/alerts/:id", AlertController.get);
router.patch("/alerts/:id/status", AlertController.updateStatus);

router.get("/alert-rules", AlertRuleController.list);
router.get("/alert-rules/:id", AlertRuleController.get);

router.post("/alert-rules", requireEntitlement("alerts"), AlertRuleController.create);
router.patch("/alert-rules/:id", requireEntitlement("alerts"), AlertRuleController.update);
router.delete("/alert-rules/:id", requireEntitlement("alerts"), AlertRuleController.remove);

export default router;
