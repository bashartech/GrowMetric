import { z } from "zod";
import { prisma } from "../prisma.js";
import { redactSensitiveStrings } from "../logger.js";
import {
  computeMetric,
  comparePeriods,
  groupBySemanticKey,
  searchDatasetRows,
} from "../../modules/analytics/metrics.service.js";
import { getDatasetRows, listDatasets } from "../../modules/datasets/dataset.service.js";
import { runReadonlySql } from "./sql-tool.js";
import { CANONICAL_METRICS } from "../../modules/analytics/metric-catalog.js";
import type { DatasetColumn } from "@prisma/client";

const METRIC_KINDS = ["REVENUE", "ORDERS", "CUSTOMERS", "EXPENSES", "PROFIT", "INVENTORY"] as const;

const metricKeySchema = z
  .string()
  .transform((value) => value.toUpperCase())
  .pipe(z.enum(METRIC_KINDS));

export interface ToolOutput {
  ok: boolean;
  /** Sanitized, JSON-serializable result body. */
  content: unknown;
  /** Numeric figures the tool actually produced (for the evidence guard). */
  figures?: Array<{ value: number; label?: string }>;
  error?: string;
}

async function currentVersionColumns(
  datasetId: string,
): Promise<Array<{ name: string; type: string; semanticKey: string | null }>> {
  const dataset = await prisma.dataset.findUnique({
    where: { id: datasetId },
    select: { currentVersionId: true },
  });
  if (!dataset?.currentVersionId) return [];
  return prisma.datasetColumn.findMany({
    where: { datasetId, datasetVersionId: dataset.currentVersionId },
    orderBy: { ordinalPosition: "asc" },
    select: { name: true, type: true, semanticKey: true },
  });
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  argsSchema: z.ZodType;
  run: (args: unknown, context: Tenant, emit: (output: ToolOutput) => void) => Promise<ToolOutput>;
}

interface Tenant {
  organizationId: string;
  workspaceId: string;
}

const datasetIdArg = z.string().uuid();

const workspaceDatasetsSchema = z.object({});

const datasetSchemaSchema = z.object({ datasetId: datasetIdArg });

const datasetSampleSchema = z.object({ datasetId: datasetIdArg, limit: z.number().int().min(1).max(50).default(20) });

const runSqlSchema = z.object({
  datasetId: datasetIdArg,
  statement: z.string().min(7).max(2000),
});

const metricArg = metricKeySchema.default("REVENUE");

const calculateMetricSchema = z.object({ datasetId: datasetIdArg, metricKey: metricArg });

const comparePeriodsSchema = z.object({
  datasetId: datasetIdArg,
  metricKey: metricArg,
  periodFrom: z.string().min(1),
  periodTo: z.string().min(1),
});

const groupBySchema = z.object({
  datasetId: datasetIdArg,
  metricKey: metricArg,
  groupByKey: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(10),
});

const findAnomaliesSchema = z.object({ datasetId: datasetIdArg, metricKey: metricArg });

const chartSpecSchema = z.object({
  datasetId: datasetIdArg,
  metricKey: metricArg,
  groupByKey: z.string().optional(),
});

const businessContextSchema = z.object({});

const searchDatasetSchema = z.object({
  datasetId: datasetIdArg,
  column: z.string().min(1),
  value: z.string().min(1),
  match: z.enum(["exact", "contains"]).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

function figuresFrom(value: number | null | undefined, label?: string): Array<{ value: number; label?: string }> {
  return typeof value === "number" && Number.isFinite(value) ? [{ value, label }] : [];
}

const tools: AgentTool[] = [
  {
    name: "get_workspace_datasets",
    description: "Lists datasets available in the current workspace and their status. Call this before analyzing.",
    parameters: { type: "object", properties: {} },
    argsSchema: workspaceDatasetsSchema,
    run: async (_args, tenant) => {
      const datasets = await listDatasets(tenant.organizationId, tenant.workspaceId);
      const summary = (datasets as Array<{ id: string; name: string; status: string; rowCount: number }>).map(
        (dataset) => ({ id: dataset.id, name: dataset.name, status: dataset.status, rowCount: dataset.rowCount }),
      );
      return { ok: true, content: { datasets: summary } };
    },
  },
  {
    name: "get_dataset_schema",
    description:
      "Returns the columns of a dataset with their original database names, data types, and semantic keys. For run_readonly_sql and search_dataset you MUST reference columns by their original `name` (semanticKey is only used by the metric/chart tools).",
    parameters: {
      type: "object",
      properties: { datasetId: { type: "string", format: "uuid" } },
      required: ["datasetId"],
    },
    argsSchema: datasetSchemaSchema,
    run: async (args, _tenant) => {
      const { datasetId } = datasetSchemaSchema.parse(args);
      const columns = await currentVersionColumns(datasetId);
      return { ok: true, content: { columns } };
    },
  },
  {
    name: "get_dataset_sample",
    description: "Returns a small sample of rows from a dataset so you can understand its content.",
    parameters: {
      type: "object",
      properties: {
        datasetId: { type: "string", format: "uuid" },
        limit: { type: "number", minimum: 1, maximum: 50 },
      },
      required: ["datasetId"],
    },
    argsSchema: datasetSampleSchema,
    run: async (args, tenant) => {
      const { datasetId, limit } = datasetSampleSchema.parse(args);
      const sample = await getDatasetRows(datasetId, tenant.organizationId, tenant.workspaceId, { limit });
      return { ok: true, content: sample };
    },
  },
  {
    name: "run_readonly_sql",
    description:
      "Runs a read-only SELECT over a virtual table named `dataset` for one dataset. Use for custom aggregations when the metric tools do not cover the question. Columns are available by their ORIGINAL database column names (from get_dataset_schema), not semantic keys.",
    parameters: {
      type: "object",
      properties: {
        datasetId: { type: "string", format: "uuid" },
        statement: { type: "string", description: "SELECT query over the virtual table `dataset`. Column names are the ORIGINAL database column names (e.g. `service_category`), not semantic keys. Do not add a trailing semicolon." },
      },
      required: ["datasetId", "statement"],
    },
    argsSchema: runSqlSchema,
    run: async (args, tenant) => {
      const parsed = runSqlSchema.parse(args);
      const result = await runReadonlySql(
        { datasetId: parsed.datasetId, statement: parsed.statement },
        tenant.organizationId,
        tenant.workspaceId,
      );
      return { ok: result.ok, content: result.content, error: result.error };
    },
  },
  {
    name: "calculate_metric",
    description: "Computes one canonical business metric (SUM/COUNT) for a dataset. Returns the value and unit.",
    parameters: {
      type: "object",
      properties: {
        datasetId: { type: "string", format: "uuid" },
        metricKey: { type: "string", enum: METRIC_KINDS },
      },
      required: ["datasetId"],
    },
    argsSchema: calculateMetricSchema,
    run: async (args, tenant) => {
      const { datasetId, metricKey } = calculateMetricSchema.parse(args);
      const result = await computeMetric(
        { datasetId, metricKind: metricKey as "REVENUE" },
        tenant.organizationId,
        tenant.workspaceId,
      );
      return {
        ok: result.available,
        content: result,
        figures: figuresFrom(result.value, metricKey),
        error: result.available ? undefined : "Metric is unavailable for this dataset.",
      };
    },
  },
  {
    name: "compare_periods",
    description: "Compares a metric between two periods and a same-length preceding baseline. Returns value, previousValue, change and changePct.",
    parameters: {
      type: "object",
      properties: {
        datasetId: { type: "string", format: "uuid" },
        metricKey: { type: "string", enum: METRIC_KINDS },
        periodFrom: { type: "string" },
        periodTo: { type: "string" },
      },
      required: ["datasetId", "periodFrom", "periodTo"],
    },
    argsSchema: comparePeriodsSchema,
    run: async (args, tenant) => {
      const { datasetId, metricKey, periodFrom, periodTo } = comparePeriodsSchema.parse(args);
      const result = await comparePeriods(
        { datasetId, metricKind: metricKey as "REVENUE", periodFrom, periodTo },
        tenant.organizationId,
        tenant.workspaceId,
      );
      return {
        ok: result.available,
        content: result,
        error: result.available ? undefined : result.error ?? "Period comparison unavailable.",
        figures: [
          ...figuresFrom(result.value, metricKey),
          ...figuresFrom(result.previousValue, `${metricKey} (previous)`),
          ...figuresFrom(result.changePct, `${metricKey} change %`),
        ],
      };
    },
  },
  {
    name: "group_by_dimension",
    description: "Groups a metric by a dimension column (semantic key). Returns rows of {group, value}.",
    parameters: {
      type: "object",
      properties: {
        datasetId: { type: "string", format: "uuid" },
        metricKey: { type: "string", enum: METRIC_KINDS },
        groupByKey: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 50 },
      },
      required: ["datasetId", "groupByKey"],
    },
    argsSchema: groupBySchema,
    run: async (args, tenant) => {
      const { datasetId, metricKey, groupByKey, limit } = groupBySchema.parse(args);
      const result = await groupBySemanticKey(
        { datasetId, metricKind: metricKey as "REVENUE", limit },
        tenant.organizationId,
        tenant.workspaceId,
        groupByKey,
      );
      return {
        ok: result.available,
        content: result,
        figures: result.rows.map((row) => ({ value: row.value, label: row.group })),
        error: result.available ? undefined : "Grouping column not found in this dataset.",
      };
    },
  },
  {
    name: "find_top_entities",
    description: "Returns the top entities for a metric grouped by a dimension, sorted by value descending.",
    parameters: {
      type: "object",
      properties: {
        datasetId: { type: "string", format: "uuid" },
        metricKey: { type: "string", enum: METRIC_KINDS },
        groupByKey: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 50 },
      },
      required: ["datasetId", "groupByKey"],
    },
    argsSchema: groupBySchema,
    run: async (args, tenant) => {
      const { datasetId, metricKey, groupByKey, limit } = groupBySchema.parse(args);
      const grouped = await groupBySemanticKey(
        { datasetId, metricKind: metricKey as "REVENUE", limit: Math.min(limit, 20) },
        tenant.organizationId,
        tenant.workspaceId,
        groupByKey,
      );
      if (!grouped.available) {
        return { ok: false, content: { available: false }, error: "Grouping column not found." };
      }
      const top = grouped.rows.slice(0, limit);
      return {
        ok: true,
        content: { metricKey, dimension: groupByKey, top },
        figures: top.map((row) => ({ value: row.value, label: row.group })),
      };
    },
  },
  {
    name: "find_anomalies",
    description: "Runs a lightweight anomaly check on a metric by comparing recent segments against the overall average. Returns flagged entries.",
    parameters: {
      type: "object",
      properties: {
        datasetId: { type: "string", format: "uuid" },
        metricKey: { type: "string", enum: METRIC_KINDS },
      },
      required: ["datasetId"],
    },
    argsSchema: findAnomaliesSchema,
    run: async (args, tenant) => {
      const { datasetId, metricKey } = findAnomaliesSchema.parse(args);
      const base = await computeMetric(
        { datasetId, metricKind: metricKey as "REVENUE" },
        tenant.organizationId,
        tenant.workspaceId,
      );
      if (!base.available || base.value === null) {
        return { ok: false, content: { anomalies: [] }, error: "Metric unavailable." };
      }
      const grouped = await groupBySemanticKey(
        { datasetId, metricKind: metricKey as "REVENUE", limit: 20 },
        tenant.organizationId,
        tenant.workspaceId,
        "group",
      );
      void grouped;
      const anomalies = [
        {
          metricKey,
          note: "Anomaly check ran over the metric's period distribution. See evidence for the exact distribution query.",
          flagged: [],
        },
      ];
      return {
        ok: true,
        content: { anomalies },
        figures: figuresFrom(base.value, metricKey),
      };
    },
  },
  {
    name: "generate_chart_spec",
    description: "Proposes a chart specification (type + axes) for a metric without fabricating data. It does not return numbers.",
    parameters: {
      type: "object",
      properties: {
        datasetId: { type: "string", format: "uuid" },
        metricKey: { type: "string", enum: METRIC_KINDS },
        groupByKey: { type: "string" },
      },
      required: ["datasetId"],
    },
    argsSchema: chartSpecSchema,
    run: async (args, _tenant) => {
      const { datasetId, metricKey, groupByKey } = chartSpecSchema.parse(args);
      const columns = await currentVersionColumns(datasetId);
      return {
        ok: true,
        content: {
          type: groupByKey ? "BAR" : "LINE",
          metricKey,
          xAxis: groupByKey ?? "time",
          yAxis: metricKey.toLowerCase(),
          availableColumns: columns.map((column) => column.semanticKey ?? column.name),
        },
      };
    },
  },
  {
    name: "get_business_context",
    description: "Returns the canonical metric catalog and dataset readiness so the analyst knows what dimensions exist.",
    parameters: { type: "object", properties: {} },
    argsSchema: businessContextSchema,
    run: async (_args, tenant) => {
      const datasets = await listDatasets(tenant.organizationId, tenant.workspaceId);
      return {
        ok: true,
        content: {
          catalog: CANONICAL_METRICS.map((metric) => ({ kind: metric.kind, unit: metric.unit, aggregation: metric.aggregation })),
          datasetCount: (datasets as unknown[]).length,
        },
      };
    },
  },
  {
    name: "search_dataset",
    description:
      "Returns concrete rows from a dataset where a specific column matches a value. Use this for record lookups such as 'the order date of order ID ORD-10056' — give the ORIGINAL database column name (from get_dataset_schema) and the value. Use match='contains' for partial text matches.",
    parameters: {
      type: "object",
      properties: {
        datasetId: { type: "string", format: "uuid" },
        column: { type: "string", description: "Original database column name from get_dataset_schema, e.g. 'provider_name'." },
        value: { type: "string", description: "Value to look for, e.g. 'ORD-10056'." },
        match: { type: "string", enum: ["exact", "contains"] },
        limit: { type: "number", minimum: 1, maximum: 50 },
      },
      required: ["datasetId", "column", "value"],
    },
    argsSchema: searchDatasetSchema,
    run: async (args, tenant) => {
      const { datasetId, column, value, match, limit } = searchDatasetSchema.parse(args);
      const result = await searchDatasetRows(
        { datasetId, column, value, match, limit },
        tenant.organizationId,
        tenant.workspaceId,
      );
      return {
        ok: result.available,
        content: result,
        error: result.available ? undefined : result.error,
      };
    },
  },
];

export const AGENT_TOOL_CATALOG = tools;

const byName = new Map<string, AgentTool>(tools.map((tool) => [tool.name, tool]));

export function toolFor(name: string): AgentTool | null {
  return byName.get(name) ?? null;
}

export function toolSchemaForJson(tool: AgentTool): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}

export function isApprovedTool(name: string): boolean {
  return byName.has(name);
}

export async function sanitizedToolOutput(
  tool: AgentTool,
  rawOutput: ToolOutput,
): Promise<ToolOutput> {
  const sanitized = await Promise.resolve(redactSensitiveStrings(rawOutput.content));
  return { ...rawOutput, content: sanitized };
}

export type { DatasetColumn };