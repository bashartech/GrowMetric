import { computeMetric, groupBySemanticKey } from "../analytics/metrics.service.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/http-errors.js";

export const INVESTIGATION_PIPELINE_VERSION = "investigation-v1";

export const ANOMALY_SHARE_SHIFT_THRESHOLD = 30;
export const MAX_DIMENSIONS = 2;
export const MAX_GROUPS_PER_DIMENSION = 10;
export const MAX_SUPPORTING_FINDINGS = 3;
export const MAX_CORRELATION_FINDINGS = 3;
export const MIN_MATERIAL_CHANGE_PCT = 0.5;

export interface InvestigationPeriod {
  from: string;
  to: string;
}

export interface InvestigationScope {
  datasetId: string;
  organizationId: string;
  workspaceId: string;
  metricKey: string;
  metricColumnName: string;
  dateColumnId: string;
  dimensionKeys: string[];
  periodTarget: InvestigationPeriod;
  periodBaseline: InvestigationPeriod;
}

export interface DerivedChange {
  value: number | null;
  baselineValue: number | null;
  changePct: number | null;
}

export interface DerivedBreakdown {
  dimension: string;
  rows: Array<{ group: string; value: number }>;
  baseline: Array<{ group: string; value: number }>;
}

export interface DerivedAnomaly {
  dimension: string;
  group: string;
  targetShare: number;
  baselineShare: number;
  shiftPct: number;
}

export interface PipelineDerived {
  datasetId: string;
  metricKey: string;
  periodTarget: InvestigationPeriod;
  periodBaseline: InvestigationPeriod;
  comparisons: DerivedChange;
  breakdowns: DerivedBreakdown[];
  anomalies: DerivedAnomaly[];
}

export type FindingLevel = "MAIN" | "SUPPORTING" | "CORRELATION";
export type FindingKindDef = "DRIVER" | "CONTRIBUTOR" | "ANOMALY";

export interface MetricChangeOutput {
  metricKey: string;
  value: number | null;
  baselineValue: number | null;
  changePct: number | null;
  periodA: string;
  periodB: string;
}

export interface FindingDefinition {
  level: FindingLevel;
  kind: FindingKindDef;
  title: string;
  summary: string;
  metricChange: MetricChangeOutput | null;
  evidence: Record<string, unknown>;
  confidence: number;
  isCausalClaim: boolean;
}

export interface PipelineDataSource {
  resolveScope(input: {
    datasetId: string | null;
    topic: string;
    periodTarget: InvestigationPeriod | null;
    periodBaseline: InvestigationPeriod | null;
    periodPreset?: PeriodPreset | null;
    organizationId: string;
    workspaceId: string;
  }): Promise<InvestigationScope>;
  aggregate(scope: InvestigationScope, period: InvestigationPeriod): Promise<number | null>;
  breakdown(
    scope: InvestigationScope,
    period: InvestigationPeriod,
    dimensionKey: string,
  ): Promise<Array<{ group: string; value: number }>>;
}

const TOPIC_METRICS: Record<string, string> = {
  orders: "orders",
  order: "orders",
  sales: "revenue",
  revenue: "revenue",
  profit: "profit",
  profitability: "profit",
  expenses: "expenses",
  costs: "expenses",
  customers: "customers",
  inventory: "inventory",
};

const DIMENSION_KEYS = new Set([
  "region",
  "category",
  "products",
  "customers",
  "segment",
  "channel",
]);

const READY_STATUSES: Array<"READY" | "READY_WITH_WARNINGS"> = [
  "READY",
  "READY_WITH_WARNINGS",
];

export const CANONICAL_METRIC_KEYS = [
  "revenue",
  "orders",
  "profit",
  "expenses",
  "customers",
  "inventory",
] as const;
export type CanonicalMetricKey = (typeof CANONICAL_METRIC_KEYS)[number];

export const PERIOD_PRESETS = {
  LAST_3_MONTHS: 3,
  LAST_6_MONTHS: 6,
  LAST_12_MONTHS: 12,
} as const;
export type PeriodPreset = keyof typeof PERIOD_PRESETS;

export interface MetricColumnRef {
  id: string;
  name: string;
  type: string;
  semanticKey: string | null;
}

/**
 * Resolves the canonical business metric a dataset can investigate. Matches a
 * column by semantic key first, then by column name (mirroring `semanticColumn`
 * in the analytics service), so a metric that is mapped only by name - not by a
 * semantic key - still resolves. Returns the canonical key so `computeMetric`
 * accepts it; unknown topics fall back to whatever canonical metric exists.
 */
export function resolveCanonicalMetric(
  columns: MetricColumnRef[],
  topic: string,
): { column: MetricColumnRef; metricKey: CanonicalMetricKey } | null {
  const normalizedTopic = topic.trim().toLowerCase();
  const requested = TOPIC_METRICS[normalizedTopic];
  const isCanonical = (value: string | undefined): value is CanonicalMetricKey =>
    value !== undefined && (CANONICAL_METRIC_KEYS as readonly string[]).includes(value);

  const preferred = isCanonical(requested)
    ? requested
    : isCanonical(normalizedTopic)
      ? normalizedTopic
      : null;

  const matchBy = (key: CanonicalMetricKey) =>
    columns.find((column) => column.semanticKey?.toLowerCase() === key) ??
    columns.find((column) => column.name?.toLowerCase() === key);

  const ordered: CanonicalMetricKey[] = preferred
    ? [preferred, ...CANONICAL_METRIC_KEYS.filter((key) => key !== preferred)]
    : [...CANONICAL_METRIC_KEYS];

  for (const key of ordered) {
    const column = matchBy(key);
    if (column) return { column, metricKey: key };
  }
  return null;
}

export class DatabasePipelineDataSource implements PipelineDataSource {
  async resolveScope(input: {
    datasetId: string | null;
    topic: string;
    periodTarget: InvestigationPeriod | null;
    periodBaseline: InvestigationPeriod | null;
    periodPreset?: PeriodPreset | null;
    organizationId: string;
    workspaceId: string;
  }): Promise<InvestigationScope> {
    let datasetId = input.datasetId;
    if (!datasetId) {
      const candidate = await prisma.dataset.findFirst({
        where: {
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          status: { in: READY_STATUSES },
          rowCount: { gt: 0 },
        },
        orderBy: { updatedAt: "desc" },
        select: { id: true },
      });
      datasetId = candidate?.id ?? null;
    }
    if (!datasetId) {
      throw new AppError(
        "CONFLICT",
        "No analytics-ready dataset is available to investigate.",
        { ready: false },
      );
    }

    const dataset = await prisma.dataset.findFirst({
      where: { id: datasetId, organizationId: input.organizationId, workspaceId: input.workspaceId },
      select: { id: true, currentVersionId: true, status: true },
    });
    if (!dataset || !dataset.currentVersionId) {
      throw new AppError("NOT_FOUND", "Dataset not found.");
    }
    if (!READY_STATUSES.includes(dataset.status as (typeof READY_STATUSES)[number])) {
      throw new AppError(
        "CONFLICT",
        `Dataset is not analytics-ready (status: ${dataset.status}).`,
        { ready: false },
      );
    }

    const columns = await prisma.datasetColumn.findMany({
      where: { datasetId, datasetVersionId: dataset.currentVersionId },
      orderBy: { ordinalPosition: "asc" },
      select: { id: true, name: true, type: true, semanticKey: true },
    });

    const resolvedMetric = resolveCanonicalMetric(columns, input.topic);
    if (!resolvedMetric) {
      throw new AppError(
        "CONFLICT",
        "No known business metric is mapped in this dataset (revenue, orders, profit, expenses, customers, inventory).",
        { ready: true },
      );
    }
    const metricColumn = resolvedMetric.column;
    const metricKey = resolvedMetric.metricKey;

    const dateColumn =
      columns.find((column) => column.semanticKey?.toLowerCase() === "order_date") ??
      columns.find((column) => column.type === "DATE" || column.type === "TIMESTAMP") ??
      null;
    if (!dateColumn) {
      throw new AppError(
        "CONFLICT",
        "This dataset has no date column, so periods cannot be compared. Map a date column and re-import.",
        { ready: true },
      );
    }

    const dimensionKeys = Array.from(
      new Set(
        columns
          .filter((column) => {
            if (column.id === dateColumn.id || column.id === metricColumn.id) return false;
            if (column.type === "TEXT" && !column.semanticKey) return true;
            return DIMENSION_KEYS.has(column.semanticKey?.toLowerCase() ?? "");
          })
          .map((column) => column.semanticKey ?? column.name),
      ),
    ).slice(0, MAX_DIMENSIONS);

    let periodTarget = input.periodTarget;
    let periodBaseline = input.periodBaseline;
    if (!periodTarget || !periodBaseline) {
      const derived = input.periodPreset
        ? await periodsForPreset(dateColumn.id, input.periodPreset)
        : await defaultPeriods(dateColumn.id);
      periodTarget = periodTarget ?? derived.target;
      periodBaseline = periodBaseline ?? derived.baseline;
    }

    return {
      datasetId,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      metricKey,
      metricColumnName: metricColumn.name,
      dateColumnId: dateColumn.id,
      dimensionKeys,
      periodTarget,
      periodBaseline,
    };
  }

  async aggregate(scope: InvestigationScope, period: InvestigationPeriod): Promise<number | null> {
    const metric = await computeMetric(
      {
        datasetId: scope.datasetId,
        metricKind: scope.metricKey.toUpperCase() as "REVENUE",
        filters: {
          dateColumnId: scope.dateColumnId,
          dateFrom: period.from,
          dateTo: period.to,
        },
      },
      scope.organizationId,
      scope.workspaceId,
    );
    return metric.available ? metric.value : null;
  }

  async breakdown(
    scope: InvestigationScope,
    period: InvestigationPeriod,
    dimensionKey: string,
  ): Promise<Array<{ group: string; value: number }>> {
    const result = await groupBySemanticKey(
      {
        datasetId: scope.datasetId,
        metricKind: scope.metricKey.toUpperCase() as "REVENUE",
        limit: MAX_GROUPS_PER_DIMENSION,
        filters: {
          dateColumnId: scope.dateColumnId,
          dateFrom: period.from,
          dateTo: period.to,
        },
      },
      scope.organizationId,
      scope.workspaceId,
      dimensionKey,
    );
    return result.available ? result.rows : [];
  }
}

export async function defaultPeriods(dateColumnId: string): Promise<{
  target: InvestigationPeriod;
  baseline: InvestigationPeriod;
}> {
  const { min, max } = await datetimeExtrema(dateColumnId);
  if (!min || !max || min.getTime() === max.getTime()) {
    throw new AppError(
      "CONFLICT",
      "Insufficient date history in this dataset to compare periods.",
      { ready: true },
    );
  }

  const span = max.getTime() - min.getTime();
  const quarter = Math.max(1, Math.floor(span / 4));
  const targetFrom = new Date(max.getTime() - quarter);
  const targetTo = endOfDay(max);
  const baselineFrom = new Date(targetFrom.getTime() - quarter);
  const baselineTo = endOfDay(targetFrom);

  return {
    target: {
      from: new Date(Math.min(max.getTime(), targetFrom.getTime() + 1)).toISOString(),
      to: targetTo.toISOString(),
    },
    baseline: {
      from: new Date(Math.max(min.getTime(), baselineFrom.getTime() + 1)).toISOString(),
      to: baselineTo.toISOString(),
    },
  };
}

function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCHours(23, 59, 59, 999);
  return copy;
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function addMonths(date: Date, delta: number): Date {
  const copy = new Date(date);
  copy.setUTCMonth(copy.getUTCMonth() + delta);
  return copy;
}

/** Earliest and latest datetime value recorded for a dataset's date column. */
export async function datetimeExtrema(
  dateColumnId: string,
): Promise<{ min: Date | null; max: Date | null }> {
  const extrema = await prisma.$queryRawUnsafe<Array<{ min: Date | null; max: Date | null }>>(
    `SELECT MIN("value") AS min, MAX("value") AS max FROM "DatasetDatetimeValue" WHERE "columnId" = $1::uuid`,
    dateColumnId,
  );
  return { min: extrema[0]?.min ?? null, max: extrema[0]?.max ?? null };
}

/**
 * Resolves a "last N months" preset into a target window ending at the newest
 * date in the dataset, with the equal-length window immediately before it as
 * the baseline. When the dataset is too short to hold two windows it falls back
 * to splitting the available span so the comparison still runs.
 */
export async function periodsForPreset(
  dateColumnId: string,
  preset: PeriodPreset,
): Promise<{ target: InvestigationPeriod; baseline: InvestigationPeriod }> {
  const months = PERIOD_PRESETS[preset];
  const { min, max } = await datetimeExtrema(dateColumnId);
  if (!min || !max || min.getTime() === max.getTime()) {
    throw new AppError(
      "CONFLICT",
      "Insufficient date history in this dataset to compare periods.",
      { ready: true },
    );
  }
  if (addMonths(max, -2 * months).getTime() <= min.getTime()) {
    return defaultPeriods(dateColumnId);
  }

  const targetFrom = startOfDay(addMonths(max, -months));
  const targetTo = endOfDay(max);
  const baselineTo = endOfDay(new Date(targetFrom.getTime() - 1));
  const baselineFrom = startOfDay(addMonths(targetFrom, -months));

  return {
    target: {
      from: targetFrom.toISOString(),
      to: targetTo.toISOString(),
    },
    baseline: {
      from: baselineFrom.toISOString(),
      to: baselineTo.toISOString(),
    },
  };
}

/**
 * Runs the deterministic investigation pipeline in research R5 order:
 * scope → compare → break down by dimension → rank → anomalies → assemble.
 * Every figure in a finding comes from a recorded comparison (FR-008);
 * correlational signals are never labeled causal (FR-009/SC-004).
 */
export async function runInvestigation(
  input: {
    datasetId: string | null;
    topic: string;
    periodTarget: InvestigationPeriod | null;
    periodBaseline: InvestigationPeriod | null;
    periodPreset?: PeriodPreset | null;
    organizationId: string;
    workspaceId: string;
  },
  dataSource: PipelineDataSource = new DatabasePipelineDataSource(),
): Promise<FindingDefinition[]> {
  const scope = await dataSource.resolveScope(input);

  const value = await dataSource.aggregate(scope, scope.periodTarget);
  const baselineValue = await dataSource.aggregate(scope, scope.periodBaseline);
  const changePct =
    value !== null && baselineValue !== null && baselineValue !== 0
      ? ((value - baselineValue) / baselineValue) * 100
      : null;

  const breakdowns: DerivedBreakdown[] = [];
  const anomalies: DerivedAnomaly[] = [];
  for (const dimensionKey of scope.dimensionKeys) {
    const rows = await dataSource.breakdown(scope, scope.periodTarget, dimensionKey);
    const baseline = await dataSource.breakdown(scope, scope.periodBaseline, dimensionKey);
    breakdowns.push({ dimension: dimensionKey, rows, baseline });
    anomalies.push(...detectShareAnomalies(dimensionKey, rows, baseline));
  }

  return assembleFindings({
    datasetId: scope.datasetId,
    metricKey: scope.metricKey.toLowerCase(),
    periodTarget: scope.periodTarget,
    periodBaseline: scope.periodBaseline,
    comparisons: { value, baselineValue, changePct },
    breakdowns,
    anomalies: anomalies.slice(0, MAX_CORRELATION_FINDINGS),
  });
}

export function detectShareAnomalies(
  dimension: string,
  rows: Array<{ group: string; value: number }>,
  baseline: Array<{ group: string; value: number }>,
): DerivedAnomaly[] {
  const targetTotal = rows.reduce((sum, row) => sum + row.value, 0);
  const baselineTotal = baseline.reduce((sum, row) => sum + row.value, 0);
  if (targetTotal <= 0 || baselineTotal <= 0) return [];

  const baselineByGroup = new Map(baseline.map((row) => [row.group, row.value]));
  const anomalies: DerivedAnomaly[] = [];
  for (const row of rows) {
    const targetShare = row.value / targetTotal;
    const baselineValue = baselineByGroup.get(row.group) ?? 0;
    const baselineShare = baselineTotal > 0 ? baselineValue / baselineTotal : 0;
    const shiftPct =
      baselineShare > 0
        ? ((targetShare - baselineShare) / baselineShare) * 100
        : targetShare > 0.05
          ? 100
          : 0;
    if (Math.abs(shiftPct) < ANOMALY_SHARE_SHIFT_THRESHOLD) continue;
    anomalies.push({
      dimension,
      group: row.group,
      targetShare: round(targetShare * 100) ?? 0,
      baselineShare: round(baselineShare * 100) ?? 0,
      shiftPct: round(shiftPct) ?? 0,
    });
  }
  return anomalies
    .sort((a, b) => Math.abs(b.shiftPct) - Math.abs(a.shiftPct))
    .slice(0, MAX_CORRELATION_FINDINGS);
}

/** Pure assembly of MAIN/SUPPORTING/CORRELATION findings (units-exact, no invention). */
export function assembleFindings(derived: PipelineDerived): FindingDefinition[] {
  const findings: FindingDefinition[] = [];
  const metricLabel = prettyMetric(derived.metricKey);

  const mainChange: MetricChangeOutput = {
    metricKey: derived.metricKey,
    value: round(derived.comparisons.value),
    baselineValue: round(derived.comparisons.baselineValue),
    changePct: round(derived.comparisons.changePct),
    periodA: periodLabel(derived.periodTarget),
    periodB: periodLabel(derived.periodBaseline),
  };
  const evidenceBase = (calculation: string) => ({
    datasetId: derived.datasetId,
    metric: derived.metricKey,
    calculation,
    sql: "deterministic aggregation over the mapped value column for each period",
    period: `${periodLabel(derived.periodTarget)} vs ${periodLabel(derived.periodBaseline)}`,
  });

  const { value, baselineValue, changePct } = derived.comparisons;
  if (value !== null && baselineValue !== null && baselineValue !== 0 && changePct !== null) {
    const fell = changePct < 0;
    const magnitude = Math.abs(changePct);
    const flat = magnitude < MIN_MATERIAL_CHANGE_PCT;
    findings.push({
      level: "MAIN",
      kind: "DRIVER",
      title: `${metricLabel} ${flat ? "was broadly flat" : `${fell ? "fell" : "rose"} ${formatPct(magnitude)}`} in ${periodLabel(derived.periodTarget)}`,
      summary: `${metricLabel} was ${formatNumber(value)} in ${periodLabel(derived.periodTarget)} versus ${formatNumber(baselineValue)} in ${periodLabel(derived.periodBaseline)}.${
        flat
          ? " The difference is not material."
          : ` That is a ${fell ? "decrease" : "increase"} of ${formatPct(magnitude)}.`
      }`,
      metricChange: mainChange,
      evidence: evidenceBase(`SUM(${derived.metricKey}) over ${periodLabel(derived.periodTarget)} vs ${periodLabel(derived.periodBaseline)}`),
      confidence: 0.85,
      isCausalClaim: false,
    });
  } else {
    findings.push({
      level: "MAIN",
      kind: "DRIVER",
      title: `${metricLabel} comparison could not be completed for the selected periods`,
      summary:
        "The deterministic comparison did not produce a usable target and baseline value, so no change figure is reported.",
      metricChange: mainChange,
      evidence: evidenceBase(`SUM(${derived.metricKey}) over ${periodLabel(derived.periodTarget)} vs ${periodLabel(derived.periodBaseline)}`),
      confidence: 0.5,
      isCausalClaim: false,
    });
  }

  for (const breakdown of derived.breakdowns) {
    const targetByGroup = new Map(breakdown.rows.map((row) => [row.group, row.value]));
    const baselineByGroup = new Map(breakdown.baseline.map((row) => [row.group, row.value]));
    const groups = new Set([
      ...breakdown.rows.map((row) => row.group),
      ...breakdown.baseline.map((row) => row.group),
    ]);
    const deltas = Array.from(groups)
      .map((group) => ({
        group,
        value: targetByGroup.get(group) ?? 0,
        baselineValue: baselineByGroup.get(group) ?? 0,
        delta: (targetByGroup.get(group) ?? 0) - (baselineByGroup.get(group) ?? 0),
      }))
      .filter((entry) => entry.delta !== 0)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, MAX_SUPPORTING_FINDINGS);

    for (const [index, entry] of deltas.entries()) {
      findings.push({
        level: "SUPPORTING",
        kind: "CONTRIBUTOR",
        title: `${prettyDimension(breakdown.dimension)} "${entry.group}" drove a ${entry.delta < 0 ? "decrease" : "increase"} in ${metricLabel.toLowerCase()}`,
        summary: `${metricLabel} tied to "${entry.group}" was ${formatNumber(entry.value)} in ${periodLabel(derived.periodTarget)} versus ${formatNumber(entry.baselineValue)} in ${periodLabel(derived.periodBaseline)} (delta ${formatSigned(entry.delta)}).`,
        metricChange: {
          metricKey: derived.metricKey,
          value: round(entry.value),
          baselineValue: round(entry.baselineValue),
          changePct:
            entry.baselineValue !== 0
              ? round(((entry.value - entry.baselineValue) / entry.baselineValue) * 100)
              : null,
          periodA: periodLabel(derived.periodTarget),
          periodB: periodLabel(derived.periodBaseline),
        },
        evidence: {
          ...evidenceBase(`SUM(${derived.metricKey}) grouped by ${breakdown.dimension} within each period`),
          dimension: breakdown.dimension,
          rank: index + 1,
        },
        confidence: 0.7,
        isCausalClaim: false,
      });
    }
  }

  for (const anomaly of derived.anomalies) {
    findings.push({
      level: "CORRELATION",
      kind: "ANOMALY",
      title: `"${anomaly.group}" shifted from ${formatPct(anomaly.baselineShare)} to ${formatPct(anomaly.targetShare)} of ${metricLabel.toLowerCase()}`,
      summary:
        "This reflects a change in concentration over the period. Correlation is not evidence of cause; the finding is reported with a non-causal label.",
      metricChange: null,
      evidence: {
        ...evidenceBase(`share of SUM(${derived.metricKey}) by dimension`),
        dimension: anomaly.dimension,
        targetSharePct: anomaly.targetShare,
        baselineSharePct: anomaly.baselineShare,
        shiftPct: anomaly.shiftPct,
      },
      confidence: 0.5,
      isCausalClaim: false,
    });
  }

  return findings;
}

export function hasCausalClaim(findings: FindingDefinition[]): boolean {
  return findings.some((finding) => finding.isCausalClaim === true);
}

function prettyMetric(key: string): string {
  const map: Record<string, string> = {
    revenue: "Revenue",
    orders: "Orders",
    profit: "Profit",
    expenses: "Expenses",
    customers: "Customers",
    inventory: "Inventory",
    quantity: "Quantity",
  };
  return map[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

function prettyDimension(key: string): string {
  return key.charAt(0).toUpperCase() + key.replace(/_/g, " ").slice(1);
}

function periodLabel(period: InvestigationPeriod): string {
  return `${monthLabel(period.from)}-${monthLabel(period.to)}`;
}

function monthLabel(iso: string): string {
  const date = new Date(iso);
  const month =
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
      date.getUTCMonth()
    ] ?? "?";
  return `${month}${date.getUTCFullYear()}`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(round(value) ?? 0);
}

function formatPct(value: number): string {
  return `${round(value)?.toFixed(1)}%`;
}

function formatSigned(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value)}`;
}

function round(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.round(value * 1000) / 1000;
}