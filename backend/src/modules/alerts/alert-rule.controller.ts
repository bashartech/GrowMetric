import { Request, Response, NextFunction } from "express";
import { AlertRuleService } from "./alert-rule.service.js";
import {
  createAlertRuleSchema,
  updateAlertRuleSchema,
} from "./alert-rule.schema.js";
import { ok } from "../../lib/respond.js";
import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";
import { requestedWorkspaceId, resolveWorkspaceId } from "../../lib/workspace.js";
import { paginationSchema } from "../../lib/pagination.js";

const alertRuleService = new AlertRuleService(prisma);

export class AlertRuleController {
  /**
   * POST /api/v1/ai/alert-rules
   */
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const input = createAlertRuleSchema.parse(req.body);
      const organizationId = req.user!.organizationId;
      const workspaceId = await resolveWorkspaceId(
        organizationId,
        input.workspaceId,
      );

      const result = await alertRuleService.create(
        { ...input, workspaceId },
        organizationId,
        req.user!.id,
      );
      ok(res, result, 201);
    } catch (error) {
      logger.error({ error }, "Failed to create alert rule");
      next(error);
    }
  }

  /**
   * GET /api/v1/ai/alert-rules
   *
   * The workspace defaults to the one `tenantGuard` resolved for the session,
   * so the list works whether or not the caller supplies `?workspaceId=`.
   */
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const organizationId = req.user!.organizationId;
      const workspaceId = await resolveWorkspaceId(
        organizationId,
        requestedWorkspaceId(req.query.workspaceId) ?? req.tenant?.workspaceId,
      );

      const result = await alertRuleService.list(
        workspaceId,
        organizationId,
        paginationSchema.parse(req.query),
      );
      ok(res, result);
    } catch (error) {
      logger.error({ error }, "Failed to list alert rules");
      next(error);
    }
  }

  /**
   * GET /api/v1/ai/alert-rules/:id
   */
  static async get(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const organizationId = req.user!.organizationId;
      const result = await alertRuleService.get(id!, organizationId);
      ok(res, result);
    } catch (error) {
      if (error instanceof Error && error.message === "Alert rule not found") {
        return res
          .status(404)
          .json({ error: { code: "NOT_FOUND", message: "Alert rule not found." } });
      }
      logger.error({ error }, "Failed to get alert rule");
      next(error);
    }
  }

  /**
   * PATCH /api/v1/ai/alert-rules/:id
   */
  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const input = updateAlertRuleSchema.parse(req.body);
      const organizationId = req.user!.organizationId;
      const result = await alertRuleService.update(id!, input, organizationId);
      ok(res, result);
    } catch (error) {
      if (error instanceof Error && error.message === "Alert rule not found") {
        return res
          .status(404)
          .json({ error: { code: "NOT_FOUND", message: "Alert rule not found." } });
      }
      logger.error({ error }, "Failed to update alert rule");
      next(error);
    }
  }

  /**
   * DELETE /api/v1/ai/alert-rules/:id
   */
  static async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const organizationId = req.user!.organizationId;
      await alertRuleService.remove(id!, organizationId);
      ok(res, { id, deleted: true });
    } catch (error) {
      logger.error({ error }, "Failed to delete alert rule");
      next(error);
    }
  }
}