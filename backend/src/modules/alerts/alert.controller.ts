import { Request, Response, NextFunction } from "express";
import { AlertService } from "./alert.service.js";
import { updateAlertStatusSchema } from "./alert-rule.schema.js";
import { ok } from "../../lib/respond.js";
import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";
import { requestedWorkspaceId, resolveWorkspaceId } from "../../lib/workspace.js";
import { paginationSchema } from "../../lib/pagination.js";

const alertService = new AlertService(prisma);

export class AlertController {
  /**
   * GET /api/v1/ai/alerts
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
      const status =
        typeof req.query.status === "string" ? req.query.status : undefined;

      const result = await alertService.list(
        workspaceId,
        organizationId,
        status,
        paginationSchema.parse(req.query),
      );
      ok(res, result);
    } catch (error) {
      logger.error({ error }, "Failed to list alerts");
      next(error);
    }
  }

  /**
   * GET /api/v1/ai/alerts/:id
   */
  static async get(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const organizationId = req.user!.organizationId;

      const result = await alertService.get(id!, organizationId);
      ok(res, result);
    } catch (error) {
      if (error instanceof Error && error.message === "Alert not found") {
        return res
          .status(404)
          .json({ error: { code: "NOT_FOUND", message: "Alert not found." } });
      }
      logger.error({ error }, "Failed to get alert");
      next(error);
    }
  }

  /**
   * PATCH /api/v1/ai/alerts/:id/status
   */
  static async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const input = updateAlertStatusSchema.parse(req.body);
      const organizationId = req.user!.organizationId;

      const result = await alertService.updateStatus(id!, input, organizationId);
      ok(res, result);
    } catch (error) {
      if (error instanceof Error && error.message === "Alert not found") {
        return res
          .status(404)
          .json({ error: { code: "NOT_FOUND", message: "Alert not found." } });
      }
      logger.error({ error }, "Failed to update alert status");
      next(error);
    }
  }
}