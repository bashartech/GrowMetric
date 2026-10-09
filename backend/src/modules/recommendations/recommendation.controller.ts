import { Request, Response, NextFunction } from "express";
import { RecommendationService } from "./recommendation.service.js";
import {
  listRecommendationsSchema,
  updateRecommendationStatusSchema,
} from "./recommendation.schema.js";
import { ok } from "../../lib/respond.js";
import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";
import { requestedWorkspaceId, resolveWorkspaceId } from "../../lib/workspace.js";

const recommendationService = new RecommendationService(prisma);

export class RecommendationController {
  static async generate(req: Request, res: Response, next: NextFunction) {
    try {
      const organizationId = req.user!.organizationId;
      const workspaceId = await resolveWorkspaceId(
        organizationId,
        requestedWorkspaceId(req.body?.workspaceId) ?? req.tenant?.workspaceId,
      );
      await recommendationService.generate(workspaceId, organizationId);
      ok(res, { message: "Recommendations generated" });
    } catch (error) {
      logger.error({ error }, "Failed to generate recommendations");
      next(error);
    }
  }

  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const organizationId = req.user!.organizationId;
      const queryWorkspaceId = requestedWorkspaceId(req.query.workspaceId);

      // The schema requires a UUID, so resolve the workspace before validating
      // rather than forwarding an empty or malformed query value.
      const workspaceId = await resolveWorkspaceId(
        organizationId,
        queryWorkspaceId ?? req.tenant?.workspaceId,
      );

      const input = listRecommendationsSchema.parse({
        workspaceId,
        source: req.query.source,
        severity: req.query.severity,
        status: req.query.status,
      });
      const result = await recommendationService.list(input, organizationId);
      ok(res, result);
    } catch (error) {
      logger.error({ error }, "Failed to list recommendations");
      next(error);
    }
  }

  static async get(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const organizationId = req.user!.organizationId;
      const result = await recommendationService.get(id!, organizationId);
      ok(res, result);
    } catch (error) {
      if (error instanceof Error && error.message === "Recommendation not found") {
        return res.status(404).json({
          error: { code: "NOT_FOUND", message: "Recommendation not found." },
        });
      }
      logger.error({ error }, "Failed to get recommendation");
      next(error);
    }
  }

  static async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const input = updateRecommendationStatusSchema.parse(req.body);
      const organizationId = req.user!.organizationId;
      const result = await recommendationService.updateStatus(
        id!,
        input,
        organizationId,
      );
      ok(res, result);
    } catch (error) {
      if (error instanceof Error && error.message === "Recommendation not found") {
        return res.status(404).json({
          error: { code: "NOT_FOUND", message: "Recommendation not found." },
        });
      }
      logger.error({ error }, "Failed to update recommendation status");
      next(error);
    }
  }

  static async acknowledge(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const organizationId = req.user!.organizationId;
      const result = await recommendationService.updateStatus(
        id!,
        { status: "ACKNOWLEDGED" },
        organizationId,
      );
      ok(res, result);
    } catch (error) {
      if (error instanceof Error && error.message === "Recommendation not found") {
        return res.status(404).json({
          error: { code: "NOT_FOUND", message: "Recommendation not found." },
        });
      }
      logger.error({ error }, "Failed to acknowledge recommendation");
      next(error);
    }
  }

  static async resolve(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const organizationId = req.user!.organizationId;
      const result = await recommendationService.updateStatus(
        id!,
        { status: "RESOLVED" },
        organizationId,
      );
      ok(res, result);
    } catch (error) {
      if (error instanceof Error && error.message === "Recommendation not found") {
        return res.status(404).json({
          error: { code: "NOT_FOUND", message: "Recommendation not found." },
        });
      }
      logger.error({ error }, "Failed to resolve recommendation");
      next(error);
    }
  }

  static async dismiss(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const organizationId = req.user!.organizationId;
      const result = await recommendationService.updateStatus(
        id!,
        { status: "DISMISSED" },
        organizationId,
      );
      ok(res, result);
    } catch (error) {
      if (error instanceof Error && error.message === "Recommendation not found") {
        return res.status(404).json({
          error: { code: "NOT_FOUND", message: "Recommendation not found." },
        });
      }
      logger.error({ error }, "Failed to dismiss recommendation");
      next(error);
    }
  }
}