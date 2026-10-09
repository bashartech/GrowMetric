import type { Dashboard, DashboardWidget, DatasetColumn, WidgetType } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/http-errors.js";
import { CANONICAL_METRICS } from "../analytics/metric-catalog.js";
import {
  computeMetric,
  countRowsInDataset,
  groupByColumns,
  listAnalyticsColumns,
  sumColumnInDataset,
} from "../analytics/metrics.service.js";
import type { MetricFilters } from "../analytics/metrics.schema.js";
import type {
  DashboardNameInput,
  UpdateWidgetInput,
  WidgetInput,
} from "./dashboard.schema.js";

const DEFAULT_WIDGETS: Array<{
  type: WidgetType;
  config: { title?: string; metricKind?: string; groupBy?: string };
  position: { x: number; y: number; w: number; h: number };
}> = [
  {
    type: "KPI",
    config: { title: "Revenue", metricKind: "REVENUE" },
    position: { x: 0, y: 0, w: 1, h: 1 },
  },
  {
    type: "KPI",
    config: { title: "Orders", metricKind: "ORDERS" },
    position: { x: 1, y: 0, w: 1, h: 1 },
  },
  {
    type: "KPI",
    config: { title: "Customers", metricKind: "CUSTOMERS" },
    position: { x: 2, y: 0, w: 1, h: 1 },
  },
  {
    type: "LINE",
    config: { title: "Revenue over time", metricKind: "REVENUE", groupBy: "order_date" },
    position: { x: 0, y: 1, w: 2, h: 1 },
  },
  {
    type: "BAR",
    config: { title: "Revenue by region", metricKind: "REVENUE", groupBy: "region" },
    position: { x: 2, y: 1, w: 1, h: 1 },
  },
  {
    type: "PIE",
    config: { title: "Orders by product", metricKind: "ORDERS", groupBy: "products" },
    position: { x: 0, y: 2, w: 1, h: 1 },
  },
  {
    type: "TABLE",
    config: { title: "Orders by category", metricKind: "ORDERS", groupBy: "category" },
    position: { x: 1, y: 2, w: 1, h: 1 },
  },
];

export async function ensureDefaultDashboard(
  organizationId: string,
  workspaceId: string,
  datasetId?: string,
): Promise<Dashboard> {
  const existing = await prisma.dashboard.findFirst({
    where: { organizationId, workspaceId },
  });
  if (existing) return existing;

  return prisma.dashboard.create({
    data: {
      organizationId,
      workspaceId,
      name: "Business Dashboard",
      widgets: {
        create: DEFAULT_WIDGETS.map((widget) => ({
          type: widget.type,
          datasetId: datasetId ?? null,
          config: widget.config as object,
          position: widget.position as object,
        })),
      },
    },
  });
}

export async function listDashboards(
  organizationId: string,
  workspaceId: string,
) {
  const dashboards = await prisma.dashboard.findMany({
    where: { organizationId, workspaceId },
    include: {
      widgets: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });
  return dashboards.map(serializeDashboard);
}

function serializeDashboard(dashboard: Dashboard & { widgets: DashboardWidget[] }) {
  return {
    id: dashboard.id,
    name: dashboard.name,
    layout: dashboard.layout,
    updatedAt: dashboard.updatedAt.toISOString(),
    createdAt: dashboard.createdAt.toISOString(),
    widgets: dashboard.widgets.map((widget) => ({
      id: widget.id,
      type: widget.type,
      datasetId: widget.datasetId,
      config: widget.config,
      position: widget.position,
    })),
  };
}

async function getOwnedDashboard(
  id: string,
  organizationId: string,
  workspaceId: string,
) {
  const dashboard = await prisma.dashboard.findFirst({
    where: { id, organizationId, workspaceId },
    include: { widgets: { orderBy: { createdAt: "asc" } } },
  });
  if (!dashboard) {
    throw new AppError("NOT_FOUND", "Dashboard not found");
  }
  return dashboard;
}

export async function getDashboard(
  id: string,
  organizationId: string,
  workspaceId: string,
) {
  return serializeDashboard(await getOwnedDashboard(id, organizationId, workspaceId));
}

export async function createDashboard(
  organizationId: string,
  workspaceId: string,
  input: DashboardNameInput,
) {
  const dashboard = await prisma.dashboard.create({
    data: {
      organizationId,
      workspaceId,
      name: input.name ?? "Business Dashboard",
      layout: input.layout as Prisma.InputJsonValue | undefined,
    },
    include: { widgets: true },
  });
  return serializeDashboard(dashboard);
}

export async function updateDashboard(
  id: string,
  organizationId: string,
  workspaceId: string,
  input: DashboardNameInput,
) {
  const existing = await getOwnedDashboard(id, organizationId, workspaceId);
  const updated = await prisma.dashboard.update({
    where: { id: existing.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.layout !== undefined ? { layout: input.layout as Prisma.InputJsonValue } : {}),
    },
    include: { widgets: true },
  });
  return serializeDashboard(updated);
}

export async function addWidget(
  id: string,
  organizationId: string,
  workspaceId: string,
  input: WidgetInput,
) {
  const existing = await getOwnedDashboard(id, organizationId, workspaceId);
  const widget = await prisma.dashboardWidget.create({
    data: {
      dashboardId: existing.id,
      type: input.type,
      datasetId: input.datasetId ?? null,
      config: input.config as Prisma.InputJsonValue | undefined,
      position: input.position as Prisma.InputJsonValue | undefined,
    },
  });
  return widget;
}

export async function updateWidget(
  dashboardId: string,
  widgetId: string,
  organizationId: string,
  workspaceId: string,
  input: UpdateWidgetInput,
) {
  const dashboard = await getOwnedDashboard(dashboardId, organizationId, workspaceId);
  const widget = await prisma.dashboardWidget.findFirst({
    where: { id: widgetId, dashboardId: dashboard.id },
  });
  if (!widget) {
    throw new AppError("NOT_FOUND", "Widget not found");
  }
  return prisma.dashboardWidget.update({
    where: { id: widget.id },
    data: {
      ...(input.config !== undefined ? { config: input.config as Prisma.InputJsonValue } : {}),
      ...(input.position !== undefined ? { position: input.position as Prisma.InputJsonValue } : {}),
    },
  });
}

export async function deleteWidget(
  dashboardId: string,
  widgetId: string,
  organizationId: string,
  workspaceId: string,
) {
  const dashboard = await getOwnedDashboard(dashboardId, organizationId, workspaceId);
  const widget = await prisma.dashboardWidget.findFirst({
    where: { id: widgetId, dashboardId: dashboard.id },
  });
  if (!widget) {
    throw new AppError("NOT_FOUND", "Widget not found");
  }
  await prisma.dashboardWidget.delete({ where: { id: widget.id } });
  return { deleted: true };
}

/** Row budgets per widget shape: a trend line needs depth; legend-style
 * breakdowns (bar/pie/table) stay scannable near the top groups. */
const GROUP_LIMIT_LINE = 40;
const GROUP_LIMIT_BREAKDOWN = 15;
/** Points behind each KPI sparkline (latest buckets, chronological). */
const SPARK_POINTS = 12;

async function computeWidgetData(
  widget: DashboardWidget,
  filters: MetricFilters | undefined,
  organizationId: string,
  workspaceId: string,
) {
  const config = (widget.config ?? {}) as {
    title?: string;
    metricKind?: string;
    groupBy?: string;
  };
  const title = config.title ?? "";
  const metricKind = config.metricKind as WidgetMetricKind | undefined;

  if (!widget.datasetId || !metricKind) {
    return { id: widget.id, type: widget.type, title, data: { available: false } };
  }

  try {
    const columns = await listAnalyticsColumns(
      widget.datasetId,
      organizationId,
      workspaceId,
    );
    if (columns === null || columns.length === 0) {
      return { id: widget.id, type: widget.type, title, data: { available: false } };
    }

    if (widget.type === "KPI") {
      const data = await computeKpiData(
        widget.datasetId,
        metricKind,
        columns,
        filters,
        organizationId,
        workspaceId,
      );
      const spark = await computeKpiSpark(
        widget.datasetId,
        metricKind,
        columns,
        filters,
        organizationId,
        workspaceId,
      );
      return {
        id: widget.id,
        type: widget.type,
        title,
        data: spark ? { ...data, spark } : data,
      };
    }

    if (!config.groupBy) {
      return { id: widget.id, type: widget.type, title, data: { available: false } };
    }

    const resolved = resolveWidgetColumns(
      columns,
      metricKind,
      config.groupBy,
      widget.type,
    );
    if (!resolved.valueColumn || !resolved.groupByColumn) {
      return { id: widget.id, type: widget.type, title, data: { available: false } };
    }

    const aggregation = metricDefinition(metricKind)?.aggregation ?? "COUNT";
    // Time series need far more points than a legend-style breakdown, and must
    // come back chronologically (group_desc keeps the latest N, reversed below).
    const isTimeSeries = widget.type === "LINE";
    const result = await groupByColumns(
      {
        datasetId: widget.datasetId,
        valueColumnId: resolved.valueColumn.id,
        valueColumnType: resolved.valueColumn.type,
        groupByColumnId: resolved.groupByColumn.id,
        groupByType: resolved.groupByColumn.type,
        aggregation,
        limit: isTimeSeries ? GROUP_LIMIT_LINE : GROUP_LIMIT_BREAKDOWN,
        filters,
        orderBy: isTimeSeries ? "group_desc" : "value",
      },
      organizationId,
      workspaceId,
    );
    const rows =
      isTimeSeries && result.available
        ? [...result.rows].reverse()
        : result.rows;
    return {
      id: widget.id,
      type: widget.type,
      title,
      data: { metricKind, ...result, rows },
    };
  } catch {
    return { id: widget.id, type: widget.type, title, data: { available: false } };
  }
}

type WidgetMetricKind =
  | "REVENUE"
  | "ORDERS"
  | "CUSTOMERS"
  | "EXPENSES"
  | "PROFIT"
  | "INVENTORY";

const COUNTED_METRIC_KINDS = new Set<WidgetMetricKind>(["ORDERS", "CUSTOMERS"]);

const NUMERIC_COLUMN_TYPES = new Set<DatasetColumn["type"]>([
  "INTEGER",
  "DECIMAL",
]);
const DATE_COLUMN_TYPES = new Set<DatasetColumn["type"]>([
  "DATE",
  "TIME",
  "TIMESTAMP",
]);

const metricDefinition = (kind: WidgetMetricKind) =>
  CANONICAL_METRICS.find((metric) => metric.kind === kind);

const semanticColumn = (columns: DatasetColumn[], semanticKey: string) =>
  columns.find(
    (column) => column.semanticKey?.toLowerCase() === semanticKey.toLowerCase(),
  );

const firstNumericColumn = (columns: DatasetColumn[]): DatasetColumn | null =>
  columns.find((column) => NUMERIC_COLUMN_TYPES.has(column.type)) ?? null;

const firstDateColumn = (columns: DatasetColumn[]): DatasetColumn | null =>
  columns.find((column) => DATE_COLUMN_TYPES.has(column.type)) ?? null;

const firstTextColumn = (columns: DatasetColumn[]): DatasetColumn | null =>
  columns.find((column) => column.type === "TEXT") ?? null;

interface ResolvedWidgetColumns {
  valueColumn: DatasetColumn | null;
  groupByColumn: DatasetColumn | null;
}

function resolveValueColumn(
  columns: DatasetColumn[],
  metricKind: WidgetMetricKind,
): DatasetColumn | null {
  const definition = metricDefinition(metricKind);
  const usesSum = definition?.aggregation === "SUM";
  const semantic = semanticColumn(columns, metricKind.toLowerCase());

  if (semantic && (!usesSum || NUMERIC_COLUMN_TYPES.has(semantic.type))) {
    return semantic;
  }
  if (usesSum) {
    return firstNumericColumn(columns);
  }
  return firstNumericColumn(columns) ?? semantic ?? null;
}

function resolveWidgetColumns(
  columns: DatasetColumn[],
  metricKind: WidgetMetricKind,
  groupBySemanticKey: string,
  widgetType: WidgetType,
): ResolvedWidgetColumns {
  const valueColumn = resolveValueColumn(columns, metricKind);

  const groupByColumn =
    semanticColumn(columns, groupBySemanticKey) ??
    (widgetType === "LINE" ? firstDateColumn(columns) : firstTextColumn(columns));

  return { valueColumn, groupByColumn };
}

/**
 * Shifts a selected date window back by its own length so the KPI can be
 * compared against the immediately preceding period of equal size. Returns
 * undefined when no explicit window was selected (all-time totals have no
 * meaningful predecessor).
 */
function previousPeriodFilters(
  filters: MetricFilters | undefined,
): MetricFilters | undefined {
  if (!filters?.dateFrom || !filters?.dateTo) return undefined;
  const from = new Date(filters.dateFrom);
  const to = new Date(filters.dateTo);
  const length = to.getTime() - from.getTime();
  if (!Number.isFinite(length) || length <= 0) return undefined;
  return {
    ...filters,
    dateFrom: new Date(from.getTime() - length).toISOString(),
    dateTo: from.toISOString(),
  };
}

async function computeKpiData(
  datasetId: string,
  metricKind: WidgetMetricKind,
  columns: DatasetColumn[],
  filters: MetricFilters | undefined,
  organizationId: string,
  workspaceId: string,
) {
  const definition = metricDefinition(metricKind);
  const unit = definition?.unit ?? "";
  const usesSum = definition?.aggregation === "SUM";
  const semantic = semanticColumn(columns, metricKind.toLowerCase());
  const semanticIsUsable =
    semantic !== undefined && (!usesSum || NUMERIC_COLUMN_TYPES.has(semantic.type));
  const numericFallback = firstNumericColumn(columns);

  const valueFor = async (windowFilters: MetricFilters | undefined): Promise<number | null> => {
    if (semanticIsUsable) {
      const result = await computeMetric(
        { datasetId, metricKind, filters: windowFilters },
        organizationId,
        workspaceId,
      );
      return result.available ? result.value : null;
    }

    if (COUNTED_METRIC_KINDS.has(metricKind)) {
      return await countRowsInDataset(
        datasetId,
        organizationId,
        workspaceId,
        windowFilters,
      );
    }

    if (numericFallback) {
      return await sumColumnInDataset(
        datasetId,
        organizationId,
        workspaceId,
        numericFallback.id,
        numericFallback.type,
        windowFilters,
      );
    }

    return null;
  };

  const value = await valueFor(filters);
  if (value === null) {
    return { metricKind, value: null, unit, available: false };
  }

  const previousFilters = previousPeriodFilters(filters);
  if (previousFilters) {
    const previousValue = await valueFor(previousFilters);
    if (previousValue !== null) {
      const changeAvailable = previousValue !== 0;
      const change = changeAvailable ? value - previousValue : null;
      const changePct = changeAvailable
        ? ((value - previousValue) / previousValue) * 100
        : null;
      return {
        metricKind,
        value,
        unit,
        available: true,
        previousValue,
        change,
        changePct,
        changeAvailable,
      };
    }
  }

  return { metricKind, value, unit, available: true };
}

/**
 * Latest few buckets of the KPI's own metric over time, for the stat-card
 * sparkline. Best effort: any failure (no date column, unqueryable metric)
 * simply yields no sparkline instead of failing the preview.
 */
async function computeKpiSpark(
  datasetId: string,
  metricKind: WidgetMetricKind,
  columns: DatasetColumn[],
  filters: MetricFilters | undefined,
  organizationId: string,
  workspaceId: string,
): Promise<number[] | undefined> {
  try {
    const dateColumn =
      (filters?.dateColumnId
        ? columns.find((column) => column.id === filters.dateColumnId)
        : undefined) ?? firstDateColumn(columns);
    if (!dateColumn) return undefined;

    const valueColumn = resolveValueColumn(columns, metricKind);
    if (!valueColumn) return undefined;

    const result = await groupByColumns(
      {
        datasetId,
        valueColumnId: valueColumn.id,
        valueColumnType: valueColumn.type,
        groupByColumnId: dateColumn.id,
        groupByType: dateColumn.type,
        aggregation: metricDefinition(metricKind)?.aggregation ?? "COUNT",
        limit: SPARK_POINTS,
        filters,
        orderBy: "group_desc",
      },
      organizationId,
      workspaceId,
    );
    if (!result.available || result.rows.length < 2) return undefined;
    return result.rows.map((row) => row.value).reverse();
  } catch {
    return undefined;
  }
}

export async function previewDashboard(
  id: string,
  organizationId: string,
  workspaceId: string,
  filters?: MetricFilters,
) {
  const dashboard = await getOwnedDashboard(id, organizationId, workspaceId);

  // Widgets are independent; computing them concurrently keeps preview latency
  // at the cost of the slowest widget instead of the sum of all of them. Order
  // is preserved (map keeps index), and computeWidgetData never rejects.
  const widgets = await Promise.all(
    dashboard.widgets.map((widget) =>
      computeWidgetData(widget, filters, organizationId, workspaceId),
    ),
  );

  return {
    id: dashboard.id,
    name: dashboard.name,
    widgets,
  };
}