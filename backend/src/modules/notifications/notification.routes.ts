import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { notificationController } from "./notification.controller.js";

const router = Router();

router.use(requireAuth);

router.get("/", notificationController.list);
router.patch("/:id/read", notificationController.markRead);
router.patch("/:id/read-all", notificationController.markAllRead);

export default router;
