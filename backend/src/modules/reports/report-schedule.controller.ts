import { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { ok } from "../../lib/respond.js";
import { ReportService } from "./report.service.js";
import { createReportScheduleSchema, updateReportScheduleSchema } from "./report.schema.js";
import { prisma } from "../../lib/prisma.js";
import { requestedWorkspaceId, resolveWorkspaceId } from "../../lib/workspace.js";
import { paginationSchema } from "../../lib/pagination.js";

const reportScheduleService = new ReportService(prisma);

export const reportScheduleController = {
  create: asyncHandler(async (req: Request, res: Response) => {
    const input = createReportScheduleSchema.parse(req.body);
    const organizationId = req.user!.organizationId;
    const workspaceId = await resolveWorkspaceId(organizationId, input.workspaceId);
    const result = await reportScheduleService.createSchedule(
      { ...input, workspaceId },
      organizationId,
    );
    ok(res, result);
  }),
  /**
   * `?workspaceId=` is optional; the tenant's default workspace is used when it
   * is absent or does not belong to the caller's organization.
   */
  list: asyncHandler(async (req: Request, res: Response) => {
    const organizationId = req.user!.organizationId;
    const workspaceId = await resolveWorkspaceId(
      organizationId,
      requestedWorkspaceId(req.query.workspaceId) ?? req.tenant?.workspaceId,
    );
    const result = await reportScheduleService.listSchedules(
      workspaceId,
      organizationId,
      paginationSchema.parse(req.query),
    );
    ok(res, result);
  }),
  get: asyncHandler(async (req: Request, res: Response) => {
    const result = await reportScheduleService.getSchedule(
      req.params.id!,
      req.user!.organizationId,
    );
    ok(res, result);
  }),
  update: asyncHandler(async (req: Request, res: Response) => {
    // A partial update must not require reportId/workspaceId (D5).
    const input = updateReportScheduleSchema.parse(req.body);
    const result = await reportScheduleService.updateSchedule(
      req.params.id!,
      input,
      req.user!.organizationId,
    );
    ok(res, result);
  }),
  remove: asyncHandler(async (req: Request, res: Response) => {
    const result = await reportScheduleService.deleteSchedule(
      req.params.id!,
      req.user!.organizationId,
    );
    ok(res, result);
  }),
};