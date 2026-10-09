import { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { ok } from "../../lib/respond.js";
import { ReportService } from "./report.service.js";
import { createReportSchema } from "./report.schema.js";
import { prisma } from "../../lib/prisma.js";
import { requestedWorkspaceId, resolveWorkspaceId } from "../../lib/workspace.js";
import { paginationSchema } from "../../lib/pagination.js";

const reportService = new ReportService(prisma);

export const reportController = {
  create: asyncHandler(async (req: Request, res: Response) => {
    const input = createReportSchema.parse(req.body);
    const organizationId = req.user!.organizationId;
    const workspaceId = await resolveWorkspaceId(organizationId, input.workspaceId);
    const result = await reportService.create({ ...input, workspaceId }, organizationId);
    ok(res, result);
  }),
  /**
   * `?workspaceId=` is optional: when it is absent or does not belong to the
   * caller's organization the tenant's default workspace is used instead of
   * falling back to an empty (and therefore invalid) UUID.
   */
  list: asyncHandler(async (req: Request, res: Response) => {
    const organizationId = req.user!.organizationId;
    const workspaceId = await resolveWorkspaceId(
      organizationId,
      requestedWorkspaceId(req.query.workspaceId) ?? req.tenant?.workspaceId,
    );
    const result = await reportService.list(
      workspaceId,
      organizationId,
      paginationSchema.parse(req.query),
    );
    ok(res, result);
  }),
  get: asyncHandler(async (req: Request, res: Response) => {
    const result = await reportService.get(req.params.id!, req.user!.organizationId);
    ok(res, result);
  }),
  /**
   * POST /api/v1/ai/reports/:id/generate
   *
   * Queues the render and returns `202 Accepted` (contract reports.md:58).
   * Generation is a background job, so the caller polls the report until
   * `status` leaves `DRAFT`.
   */
  generate: asyncHandler(async (req: Request, res: Response) => {
    const result = await reportService.queueGeneration(
      req.params.id!,
      req.user!.organizationId,
    );
    ok(res, { ...result, status: 'QUEUED' }, 202);
  }),
  /**
   * GET /api/v1/ai/reports/:id/pdf
   *
   * Streams the stored PDF as an attachment. It is served from the API rather
   * than a public URL so a report can never leak across tenants, and so the
   * caller's auth cookie is verified on every download.
   */
  download: asyncHandler(async (req: Request, res: Response) => {
    const { report, bytes } = await reportService.getPdf(
      req.params.id!,
      req.user!.organizationId,
    );

    const fileName = `${report.title.replace(/[^\w.-]+/g, "-") || "report"}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(bytes.length));
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.send(bytes);
  }),
  remove: asyncHandler(async (req: Request, res: Response) => {
    const result = await reportService.delete(req.params.id!, req.user!.organizationId);
    ok(res, result);
  }),
};