import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { tenantGuard } from "../../middleware/tenant-guard.js";
import { validate } from "../../middleware/validate.js";
import { requireEntitlement } from "../entitlements/entitlement.middleware.js";
import {
  cancelRunController,
  createConversationController,
  createMessageController,
  getConversationController,
  getAgentRunController,
  getEvidenceController,
  getToolCallController,
  listAgentRunsController,
  listConversationsController,
} from "./ai.controller.js";
import {
  conversationParamsSchema,
  createConversationSchema,
  createMessageSchema,
} from "./ai.schema.js";

export const aiRouter = Router();

aiRouter.use(requireAuth);
aiRouter.use(tenantGuard);
aiRouter.use(requireEntitlement("aiConversations"));

aiRouter.post(
  "/conversations",
  validate({ body: createConversationSchema }),
  createConversationController,
);

aiRouter.get("/conversations", listConversationsController);

aiRouter.get(
  "/conversations/:id",
  validate({ params: conversationParamsSchema }),
  getConversationController,
);

aiRouter.post(
  "/conversations/:id/messages",
  validate({ params: conversationParamsSchema, body: createMessageSchema }),
  createMessageController,
);

aiRouter.post(
  "/conversations/:id/cancel",
  validate({ params: conversationParamsSchema }),
  cancelRunController,
);

// US5 Evidence & Transparency
aiRouter.get("/runs", listAgentRunsController);

aiRouter.get("/runs/:runId", getAgentRunController);

aiRouter.get("/runs/:runId/tool-calls/:toolCallId", getToolCallController);

aiRouter.get("/evidence/:messageId", getEvidenceController);