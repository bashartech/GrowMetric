import type { DatasetColumn } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/http-errors.js";
import { logger } from "../../lib/logger.js";
import { CANONICAL_METRICS } from "./metric-catalog.js";
import {
  buildAggregateQuery,
  buildGroupByQuery,
  type AggregateFunction,
  type FilterPredicates,
} from "../../lib/analytics-sql.js";
import { buildWideProjection, SQL_TOOL_MAX_LIMIT } from "../../lib/agent/sql-tool.js";
import type {
  ComparePeriodsInput,
  GroupByInput,
  MetricFilters,
  MetricsQueryInput,
} from "./metrics.schema.js";

interface AnalyticsContext {
  datasetId: string;
  versionId: string;
  columns: DatasetColumn[];
}

type AnalyticsLoadResult =
  | { ok: true; context: AnalyticsContext }
  | { ok: false; error: AppError };

async function loadAnalyticsContextResult(
  datasetId: string,
  organizationId: string,
  workspaceId: string,
): Promise<AnalyticsLoadResult> {
  const dataset = await prisma.dataset.findFirst({
    where: { id: datasetId, organizationId, workspaceId },
  });
  if (!dataset) {
    return { ok: false, error: new AppError("NOT_FOUND", "Dataset not found") };
  }
  if (!dataset.currentVersionId) {
    return {
      ok: false,
      error: new AppError("CONFLICT", "Dataset has no current version to analyze"),
    };
  }
  if (
    dataset.status !== "READY" &&
    dataset.status !== "READY_WITH_WARNINGS"
  ) {
    return {
      ok: false,
      error: new AppError(
        "CONFLICT",
        `Dataset is not ready for analysis (status: ${dataset.status})`,
      ),
    };
  }
  const columns = await prisma.datasetColumn.findMany({
    where: { datasetId, datasetVersionId: dataset.currentVersionId },
    orderBy: { ordinalPosition: "asc" },
  });
  return {
    ok: true,
    context: { datasetId, versionId: dataset.currentVersionId, columns },
  };
}

async function loadAnalyticsContext(
  datasetId: string,
  organizationId: string,
  workspaceId: string,
): Promise<AnalyticsContext> {
  const result = await loadAnalyticsContextResult(
    datasetId,
    organizationId,
    workspaceId,
  );
  if (!result.ok) throw result.error;
  return result.context;
}

/**
 * Finds a column by semantic key, falling back to the column name. Callers
 * refer to dimensions by either, so both must resolve.
 */
function semanticColumn(columns: DatasetColumn[], semanticKey: string) {
  const needle = semanticKey.toLowerCase();
  return (
    columns.find((column) => column.semanticKey?.toLowerCase() === needle) ??
    columns.find((column) => column.name?.toLowerCase() === needle)
  );
}

const DATE_SEMANTIC_PRIORITY = [
  "order_date",
  "invoice_date",
  "transaction_date",
  "date",
  "created_at",
  "updated_at",
  "timestamp",
];

function isDateType(type: DatasetColumn["type"]): boolean {
  return type === "DATE" || type === "TIME" || type === "TIMESTAMP";
}

/**
 * Resolves the date column used for period filtering. When an explicit column
 * id is given it wins; otherwise the semantic keys above are preferred, then
 * any DATE/TIME/TIMESTAMP column. Never falls back to an unfiltered aggregate.
 */
function resolveDateColumn(
  columns: DatasetColumn[],
  explicitColumnId?: string,
): DatasetColumn | null {
  if (explicitColumnId) {
    return columns.find((column) => column.id === explicitColumnId) ?? null;
  }
  for (const key of DATE_SEMANTIC_PRIORITY) {
    const column = semanticColumn(columns, key);
    if (column && isDateType(column.type)) return column;
  }
  return columns.find((column) => isDateType(column.type)) ?? null;
}

function resolveFilters(
  columns: DatasetColumn[],
  filters?: MetricFilters,
): FilterPredicates {
  if (!filters) return {};
  const dimensions = filters.dimensions ?? {};
  const textColumnIds: Record<string, string> = {};
  for (const key of Object.keys(dimensions)) {
    const column = semanticColumn(columns, key);
    // A dimension that matches no column would be dropped from the WHERE clause
    // and silently return the unfiltered total. That is worse than an error:
    // the report would state a confident, wrong number.
    if (!column) {
      throw new AppError(
        "VALIDATION_ERROR",
        `Unknown filter dimension "${key}". Available columns: ${columns
          .map((c) => c.name)
          .join(", ")}`,
      );
    }
    textColumnIds[key] = column.id;
  }

  const dateFrom = filters.dateFrom ? new Date(filters.dateFrom) : undefined;
  const dateTo = filters.dateTo ? new Date(filters.dateTo) : undefined;

  let dateColumnId: string | undefined;
  if (dateFrom || dateTo) {
    // A date range with no column to apply it to is dropped by buildFilterJoins,
    // which returns an all-time aggregate for every range without error. Resolve
    // the column here so a range is never silently ignored.
    const dateColumn = resolveDateColumn(columns, filters.dateColumnId);
    if (!dateColumn) {
      throw new AppError(
        "VALIDATION_ERROR",
        filters.dateColumnId
          ? `Unknown filter date column "${filters.dateColumnId}". The dataset may have been re-imported, which replaces its columns. Available columns: ${columns
              .map((c) => c.name)
              .join(", ")}`
          : "This dataset has no DATE, TIME, or TIMESTAMP column, so it cannot be filtered by date. Re-import the data with a date column, or clear the date range.",
      );
    }
    dateColumnId = dateColumn.id;
  }

  return {
    dateColumnId,
    dateFrom,
    dateTo,
    dimensions,
    textColumnIds,
  };
}

async function aggregate(
  context: AnalyticsContext,
  valueColumnId: string,
  valueColumnType: DatasetColumn["type"],
  aggregation: AggregateFunction,
  filters: FilterPredicates,
): Promise<number> {
  const query = buildAggregateQuery({
    datasetId: context.datasetId,
    versionId: context.versionId,
    columnId: valueColumnId,
    columnType: valueColumnType,
    aggregation,
    filters,
  });
  const rows = (await prisma.$queryRawUnsafe(
    query.sql,
    ...(query.params as unknown[]),
  )) as Array<{ result: unknown }>;
  return Number(rows[0]?.result ?? 0);
}

export async function computeMetric(
  input: MetricsQueryInput,
  organizationId: string,
  workspaceId: string,
) {
  const context = await loadAnalyticsContext(
    input.datasetId,
    organizationId,
    workspaceId,
  );
  const definition = CANONICAL_METRICS.find(
    (metric) => metric.kind === input.metricKind,
  );
  if (!definition) {
    throw new AppError("VALIDATION_ERROR", `Unknown metric kind ${input.metricKind}`);
  }

  const semanticKey = input.metricKind.toLowerCase();
  const valueColumn = semanticColumn(context.columns, semanticKey);
  if (!valueColumn) {
    return {
      metricKind: input.metricKind,
      value: null,
      unit: definition.unit,
      available: false,
    };
  }

  const filters = resolveFilters(context.columns, input.filters);
  const value = await aggregate(
    context,
    valueColumn.id,
    valueColumn.type,
    definition.aggregation,
    filters,
  );

  logger.info(
    { datasetId: context.datasetId, metricKind: input.metricKind, value, unit: definition.unit },
    "Metric computed.",
  );

  return {
    metricKind: input.metricKind,
    value,
    unit: definition.unit,
    available: true,
  };
}

export async function comparePeriods(
  input: ComparePeriodsInput,
  organizationId: string,
  workspaceId: string,
) {
  const context = await loadAnalyticsContext(
    input.datasetId,
    organizationId,
    workspaceId,
  );
  const definition = CANONICAL_METRICS.find(
    (metric) => metric.kind === input.metricKind,
  );
  if (!definition) {
    throw new AppError("VALIDATION_ERROR", `Unknown metric kind ${input.metricKind}`);
  }

  const semanticKey = input.metricKind.toLowerCase();
  const valueColumn = semanticColumn(context.columns, semanticKey);
  if (!valueColumn) {
    return {
      metricKind: input.metricKind,
      value: null,
      previousValue: null,
      change: null,
      changePct: null,
      changeAvailable: false,
      available: false,
      error: `No ${semanticKey} column mapped in this dataset.`,
      unit: definition.unit,
    };
  }

  const dateColumn = resolveDateColumn(context.columns, input.dateColumnId);
  if (!dateColumn) {
    return {
      metricKind: input.metricKind,
      value: null,
      previousValue: null,
      change: null,
      changePct: null,
      changeAvailable: false,
      available: false,
      error:
        "This dataset has no DATE, TIME, or TIMESTAMP column, so periods cannot be compared. Replace the metric with the dataset total or state that period filtering is unavailable.",
      unit: definition.unit,
    };
  }

  const baseFilters = resolveFilters(context.columns, input.filters);
  const periodFrom = new Date(input.periodFrom);
  const periodTo = new Date(input.periodTo);
  const periodLength = periodTo.getTime() - periodFrom.getTime();
  const previousFrom = new Date(periodFrom.getTime() - periodLength);
  const previousTo = new Date(periodFrom.getTime());

  const value = await aggregate(
    context,
    valueColumn.id,
    valueColumn.type,
    definition.aggregation,
    {
      ...baseFilters,
      dateColumnId: dateColumn.id,
      dateFrom: periodFrom,
      dateTo: periodTo,
    },
  );
  const previousValue = await aggregate(
    context,
    valueColumn.id,
    valueColumn.type,
    definition.aggregation,
    {
      ...baseFilters,
      dateColumnId: dateColumn.id,
      dateFrom: previousFrom,
      dateTo: previousTo,
    },
  );

  const changeAvailable = previousValue !== 0;
  const change = changeAvailable ? value - previousValue : null;
  const changePct =
    changeAvailable && previousValue !== 0
      ? ((value - previousValue) / previousValue) * 100
      : null;

  logger.info(
    {
      datasetId: context.datasetId,
      metricKind: input.metricKind,
      dateColumn: dateColumn.name,
      value,
      previousValue,
      change,
      changePct,
      unit: definition.unit,
    },
    "Period comparison computed.",
  );

  return {
    metricKind: input.metricKind,
    value,
    previousValue,
    change,
    changePct,
    changeAvailable,
    available: true,
    unit: definition.unit,
    // Exposed so callers that derive their own windows (anomaly detection)
    // can read the real range instead of repeating date-column resolution.
    dateColumnId: dateColumn.id,
    dateColumnName: dateColumn.name,
  };
}

export async function groupByMetric(
  input: GroupByInput,
  organizationId: string,
  workspaceId: string,
) {
  const context = await loadAnalyticsContext(
    input.datasetId,
    organizationId,
    workspaceId,
  );
  const definition = CANONICAL_METRICS.find(
    (metric) => metric.kind === input.metricKind,
  );
  if (!definition) {
    throw new AppError("VALIDATION_ERROR", `Unknown metric kind ${input.metricKind}`);
  }

  const semanticKey = input.metricKind.toLowerCase();
  const valueColumn = semanticColumn(context.columns, semanticKey);
  const groupByColumn =
    context.columns.find((column) => column.id === input.groupByColumnId) ?? null;

  if (!valueColumn || !groupByColumn) {
    return {
      metricKind: input.metricKind,
      available: false,
      rows: [],
      total: 0,
    };
  }

  const filters = resolveFilters(context.columns, input.filters);
  const query = buildGroupByQuery({
    datasetId: context.datasetId,
    versionId: context.versionId,
    valueColumnId: valueColumn.id,
    valueColumnType: valueColumn.type,
    groupByColumnId: groupByColumn.id,
    groupByType: groupByColumn.type,
    aggregation: definition.aggregation,
    limit: input.limit,
    filters,
  });
  const rows = (await prisma.$queryRawUnsafe(
    query.sql,
    ...(query.params as unknown[]),
  )) as Array<{ group: string | null; value: unknown }>;

  const normalized = rows.map((row) => ({
    group: row.group ?? "(empty)",
    value: Number(row.value ?? 0),
  }));

  logger.info(
    {
      datasetId: context.datasetId,
      metricKind: input.metricKind,
      groups: normalized.length,
      total: normalized.reduce((sum, row) => sum + row.value, 0),
    },
    "Group-by metric computed.",
  );

  return {
    metricKind: input.metricKind,
    available: true,
    rows: normalized,
    total: normalized.reduce((sum, row) => sum + row.value, 0),
  };
}

export async function groupBySemanticKey(
  input: Omit<GroupByInput, "groupByColumnId">,
  organizationId: string,
  workspaceId: string,
  groupBySemanticKey: string,
) {
  const context = await loadAnalyticsContext(
    input.datasetId,
    organizationId,
    workspaceId,
  );
  const groupByColumn = semanticColumn(context.columns, groupBySemanticKey);
  if (!groupByColumn) {
    return {
      metricKind: input.metricKind,
      available: false,
      rows: [],
      total: 0,
    };
  }
  return groupByMetric(
    { ...input, groupByColumnId: groupByColumn.id },
    organizationId,
    workspaceId,
  );
}

export interface SearchDatasetArgs {
  datasetId: string;
  column: string;
  value: string;
  match?: "exact" | "contains";
  limit?: number;
}

/**
 * Searches the wide projection of one dataset for rows where the named column
 * (original name or semantic key) equals or contains the given value. The
 * searched column is text-cast so a single parameter works across every column
 * type; the value is always bound, never interpolated.
 */
export async function searchDatasetRows(
  input: SearchDatasetArgs,
  organizationId: string,
  workspaceId: string,
): Promise<{ available: boolean; rows: Array<Record<string, unknown>>; error?: string }> {
  const result = await loadAnalyticsContextResult(input.datasetId, organizationId, workspaceId);
  if (!result.ok) return { available: false, rows: [], error: result.error.message };

  const { versionId, columns } = result.context;
  const column = columns.find(
    (candidate) =>
      candidate.name === input.column || candidate.semanticKey === input.column,
  );
  if (!column) {
    return {
      available: false,
      rows: [],
      error: `Column "${input.column}" is not in the schema. Check the names returned by get_dataset_schema.`,
    };
  }

  const projectedName = column.name.replace(/"/g, "");
  const limit = Math.min(Math.trunc(input.limit ?? 10), SQL_TOOL_MAX_LIMIT);
  const contains = input.match === "contains";
  const operator = contains ? "ILIKE" : "=";
  const boundValue = contains ? `%${input.value}%` : input.value;
  const searchPlaceholder = columns.length + 3;
  const projection = buildWideProjection(versionId, columns);
  const sql = `SELECT * FROM (\n${projection}\n) AS dataset
  WHERE CAST("${projectedName}" AS text) ${operator} $${searchPlaceholder}
  LIMIT ${limit}`;

  const params: unknown[] = [result.context.datasetId, versionId, ...columns.map((c) => c.id), boundValue];
  const rows = (await prisma.$queryRawUnsafe(sql, ...params)) as Array<Record<string, unknown>>;
  return { available: true, rows };
}

export async function listAnalyticsColumns(
  datasetId: string,
  organizationId: string,
  workspaceId: string,
): Promise<DatasetColumn[] | null> {
  const result = await loadAnalyticsContextResult(
    datasetId,
    organizationId,
    workspaceId,
  );
  return result.ok ? result.context.columns : null;
}

export async function countRowsInDataset(
  datasetId: string,
  organizationId: string,
  workspaceId: string,
  filters?: MetricFilters,
): Promise<number> {
  const result = await loadAnalyticsContextResult(
    datasetId,
    organizationId,
    workspaceId,
  );
  if (!result.ok || result.context.columns.length === 0) return 0;
  const column = result.context.columns[0] as DatasetColumn;
  const predicates = resolveFilters(result.context.columns, filters);
  return aggregate(result.context, column.id, column.type, "COUNT", predicates);
}

export async function sumColumnInDataset(
  datasetId: string,
  organizationId: string,
  workspaceId: string,
  columnId: string,
  columnType: DatasetColumn["type"],
  filters?: MetricFilters,
): Promise<number> {
  const result = await loadAnalyticsContextResult(
    datasetId,
    organizationId,
    workspaceId,
  );
  if (!result.ok) return 0;
  const predicates = resolveFilters(result.context.columns, filters);
  return aggregate(result.context, columnId, columnType, "SUM", predicates);
}

export interface GroupByColumnsInput {
  datasetId: string;
  valueColumnId: string;
  valueColumnType: DatasetColumn["type"];
  groupByColumnId: string;
  groupByType: DatasetColumn["type"];
  aggregation: AggregateFunction;
  limit: number;
  filters?: MetricFilters;
  orderBy?: "value" | "group" | "group_desc";
}

export async function groupByColumns(
  input: GroupByColumnsInput,
  organizationId: string,
  workspaceId: string,
) {
  const result = await loadAnalyticsContextResult(
    input.datasetId,
    organizationId,
    workspaceId,
  );
  if (!result.ok) {
    return { available: false, rows: [], total: 0 };
  }

  const context = result.context;
  const filters = resolveFilters(context.columns, input.filters);
  const query = buildGroupByQuery({
    datasetId: context.datasetId,
    versionId: context.versionId,
    valueColumnId: input.valueColumnId,
    valueColumnType: input.valueColumnType,
    groupByColumnId: input.groupByColumnId,
    groupByType: input.groupByType,
    aggregation: input.aggregation,
    limit: input.limit,
    filters,
    orderBy: input.orderBy,
  });
  const rows = (await prisma.$queryRawUnsafe(
    query.sql,
    ...(query.params as unknown[]),
  )) as Array<{ group: string | null; value: unknown }>;

  const normalized = rows.map((row) => ({
    group: row.group ?? "(empty)",
    value: Number(row.value ?? 0),
  }));

  logger.info(
    {
      datasetId: context.datasetId,
      groups: normalized.length,
      total: normalized.reduce((sum, row) => sum + row.value, 0),
    },
    "Group-by column metric computed.",
  );

  return {
    available: true,
    rows: normalized,
    total: normalized.reduce((sum, row) => sum + row.value, 0),
  };
}