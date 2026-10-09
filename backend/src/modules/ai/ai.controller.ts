import { asyncHandler } from "../../lib/async-handler.js";
import { ok } from "../../lib/respond.js";
import * as service from "./ai.service.js";
import type { CreateMessageInput } from "./ai.schema.js";

export const createConversationController = asyncHandler(async (req, res) => {
  const result = await service.createConversation({
    title: (req.body as { title?: string } | undefined)?.title,
    organizationId: req.user!.organizationId,
    workspaceId: req.user!.workspaceId,
    createdById: req.user!.id,
  });
  ok(res, result, 201);
});

export const listConversationsController = asyncHandler(async (req, res) => {
  const result = await service.listConversations(
    req.user!.organizationId,
    req.user!.workspaceId,
  );
  ok(res, result);
});

export const getConversationController = asyncHandler(async (req, res) => {
  const result = await service.getConversation(
    req.params.id as string,
    req.user!.organizationId,
    req.user!.workspaceId,
  );
  ok(res, result);
});

export const createMessageController = asyncHandler(async (req, res) => {
  const result = await service.createMessage({
    conversationId: req.params.id as string,
    content: (req.body as CreateMessageInput).content,
    organizationId: req.user!.organizationId,
    workspaceId: req.user!.workspaceId,
    userId: req.user!.id,
  });
  ok(res, result, 202);
});

export const cancelRunController = asyncHandler(async (req, res) => {
  const result = await service.cancelRun(
    req.params.id as string,
    req.user!.organizationId,
    req.user!.workspaceId,
  );
  ok(res, result);
});

// US5 Evidence & Transparency

export const listAgentRunsController = asyncHandler(async (req, res) => {
  const result = await service.listAgentRuns(
    req.user!.organizationId,
    req.user!.workspaceId,
    {
      kind: req.query.kind as string | undefined,
      status: req.query.status as string | undefined,
      model: req.query.model as string | undefined,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      perPage: req.query.perPage ? Number(req.query.perPage) : undefined,
    },
  );
  ok(res, result);
});

export const getAgentRunController = asyncHandler(async (req, res) => {
  const result = await service.getAgentRun(
    req.params.runId as string,
    req.user!.organizationId,
    req.user!.workspaceId,
  );
  ok(res, result);
});

export const getToolCallController = asyncHandler(async (req, res) => {
  const result = await service.getToolCall(
    req.params.runId as string,
    req.params.toolCallId as string,
    req.user!.organizationId,
    req.user!.workspaceId,
  );
  ok(res, result);
});

export const getEvidenceController = asyncHandler(async (req, res) => {
  const result = await service.getEvidence(
    req.params.messageId as string,
    req.user!.organizationId,
    req.user!.workspaceId,
  );
  ok(res, result);
});