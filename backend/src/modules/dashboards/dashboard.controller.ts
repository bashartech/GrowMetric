import { asyncHandler } from "../../lib/async-handler.js";
import { ok } from "../../lib/respond.js";
import * as service from "./dashboard.service.js";
import type {
  DashboardNameInput,
  DashboardPreviewInput,
  UpdateWidgetInput,
  WidgetInput,
} from "./dashboard.schema.js";

export const listDashboardsController = asyncHandler(async (req, res) => {
  const dashboards = await service.listDashboards(
    req.user!.organizationId,
    req.user!.workspaceId,
  );
  ok(res, { dashboards });
});

export const getDashboardController = asyncHandler(async (req, res) => {
  const dashboard = await service.getDashboard(
    req.params.id!,
    req.user!.organizationId,
    req.user!.workspaceId,
  );
  ok(res, dashboard);
});

export const createDashboardController = asyncHandler(async (req, res) => {
  const dashboard = await service.createDashboard(
    req.user!.organizationId,
    req.user!.workspaceId,
    req.body as DashboardNameInput,
  );
  ok(res, dashboard, 201);
});

export const updateDashboardController = asyncHandler(async (req, res) => {
  const dashboard = await service.updateDashboard(
    req.params.id!,
    req.user!.organizationId,
    req.user!.workspaceId,
    req.body as DashboardNameInput,
  );
  ok(res, dashboard);
});

export const addWidgetController = asyncHandler(async (req, res) => {
  const widget = await service.addWidget(
    req.params.id!,
    req.user!.organizationId,
    req.user!.workspaceId,
    req.body as WidgetInput,
  );
  ok(res, widget, 201);
});

export const updateWidgetController = asyncHandler(async (req, res) => {
  const widget = await service.updateWidget(
    req.params.id!,
    req.params.widgetId!,
    req.user!.organizationId,
    req.user!.workspaceId,
    req.body as UpdateWidgetInput,
  );
  ok(res, widget);
});

export const deleteWidgetController = asyncHandler(async (req, res) => {
  const result = await service.deleteWidget(
    req.params.id!,
    req.params.widgetId!,
    req.user!.organizationId,
    req.user!.workspaceId,
  );
  ok(res, result);
});

export const previewDashboardController = asyncHandler(async (req, res) => {
  const body = (req.body ?? {}) as DashboardPreviewInput;
  const result = await service.previewDashboard(
    req.params.id!,
    req.user!.organizationId,
    req.user!.workspaceId,
    body.filters,
  );
  ok(res, result);
});