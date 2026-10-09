import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";
import { ANALYTICS_READY_STATUSES } from "../../lib/dataset-status.js";
import { CANONICAL_METRICS } from "../analytics/metric-catalog.js";
import { computeMetric } from "../analytics/metrics.service.js";
import { env } from "../../config/env.js";
import type { AnomalyDetection, AnomalyStatus, DatasetColumn } from "@prisma/client";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Why a (dataset, metric) pair produced no anomaly. Surfaced in the job log. */
export type SkipReason =
  | 'NO_VALUE_COLUMN'
  | 'NO_DATE_COLUMN'
  | 'NO_DATA_IN_PERIOD'
  | 'NO_BASELINE_DATA'
  | 'ZERO_BASELINE'
  | 'EVALUATION_FAILED';

export interface SkippedPair {
  datasetId: string;
  metricKind: string;
  reason: SkipReason;
  detail?: string;
}

interface ScanResult {
  anomalies: AnomalyResponse[];
  scanned: number;
  skipped: number;
  /** Per-pair skip reasons, so "found nothing" is never indistinguishable from "could not look". */
  skips: SkippedPair[];
}

export interface ScanScope {
  organizationId: string;
  workspaceId?: string;
}

/** The two windows a comparison is made over, with honest labels. */
interface PeriodWindow {
  from: Date;
  to: Date;
  /** e.g. `2026-09-02 → 2026-10-01`, from real data bounds. */
  label: string;
}

function formatPeriodLabel(from: Date, to: Date): string {
  return `${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}`;
}

/**
 * Same preference order the analytics service uses for period filtering, so the
 * scan and an on-demand report never disagree about which column is "the" date.
 */
const DATE_SEMANTIC_PRIORITY = [
  'order_date',
  'invoice_date',
  'transaction_date',
  'date',
  'created_at',
  'updated_at',
  'timestamp',
];

function resolveScanDateColumn(columns: DatasetColumn[]): DatasetColumn | null {
  const dated = columns.filter(
    (column) => column.type === 'DATE' || column.type === 'TIME' || column.type === 'TIMESTAMP',
  );
  for (const semanticKey of DATE_SEMANTIC_PRIORITY) {
    const match = dated.find((column) => column.semanticKey?.toLowerCase() === semanticKey);
    if (match) return match;
  }
  return dated[0] ?? null;
}

/**
 * The dataset's actual date range (F1).
 *
 * The scan previously compared a hardcoded 2026-07-01…2026-07-31 window and
 * labelled it "2026-08", so any dataset that did not happen to contain July 2026
 * rows silently produced zero anomalies. The window now follows the data.
 *
 * Returns null when the dataset has no date column or no dated rows, which the
 * caller reports as a skip rather than as "nothing unusual".
 */
async function datasetDateRange(
  datasetId: string,
  versionId: string,
  dateColumnId: string,
): Promise<{ min: Date; max: Date } | null> {
  const [row] = await prisma.$queryRaw<
    Array<{ min: Date | null; max: Date | null }>
  >(Prisma.sql`
    SELECT MIN(v."value") AS min, MAX(v."value") AS max
    FROM "DatasetDatetimeValue" v
    JOIN "DatasetRow" r ON r."id" = v."rowId"
    WHERE r."datasetId" = ${datasetId}::uuid
      AND r."datasetVersionId" = ${versionId}::uuid
      AND v."columnId" = ${dateColumnId}::uuid
  `);

  if (!row?.min || !row?.max) return null;
  return { min: new Date(row.min), max: new Date(row.max) };
}

/**
 * Derives the current period and its N trailing baselines from the dataset's
 * own data (B11.3).
 *
 * The current window is the most recent `periodDays` ending at the latest dated
 * row. Baselines are the `baselinePeriods` chunks of real data immediately
 * before it — not fixed calendar offsets — because a dataset imported monthly
 * has no rows in "the 30 days before the last row", and requiring them would
 * mean no dataset could ever be scanned.
 *
 * The baseline is a *mean* over those periods, not the single preceding one:
 * one odd week otherwise either hides a real trend or invents one. Each
 * period's value is kept so the stored evidence can be audited.
 */
function deriveWindows(
  range: { min: Date; max: Date },
  periodDays: number,
  baselinePeriods: number,
): { current: PeriodWindow; baselines: PeriodWindow[] } | null {
  const spanMs = periodDays * DAY_MS;
  // The current window ends at the last row, inclusive of that whole day.
  const currentTo = new Date(range.max.getTime() + DAY_MS);
  const currentFrom = new Date(currentTo.getTime() - spanMs);

  // Walk back in `spanMs` steps so every window is anchored to actual data.
  const totalSpan = range.max.getTime() - range.min.getTime();
  const available = Math.floor(totalSpan / spanMs);
  // Data covers less than one period: no comparison possible.
  if (available < 1) return null;

  // A dataset with only two periods of history still gets a comparison; it just
  // compares against one baseline instead of the configured N.
  const count = Math.min(baselinePeriods, available);

  const baselines: PeriodWindow[] = [];
  for (let index = 1; index <= count; index += 1) {
    const to = new Date(range.max.getTime() - index * spanMs);
    const from = new Date(to.getTime() - spanMs);
    baselines.push({
      from,
      to,
      label: formatPeriodLabel(from, to),
      // Ordered oldest-first so the stored evidence reads chronologically.
    });
  }
  baselines.reverse();

  return {
    current: { from: currentFrom, to: currentTo, label: formatPeriodLabel(currentFrom, currentTo) },
    baselines,
  };
}

/**
 * Mean and spread of the baseline periods.
 *
 * `spreadPct` is the mean absolute deviation from the mean as a percentage of
 * it, so an operator can tell a genuine shift from a baseline that was itself
 * volatile. Returns `null` when the mean is 0, where a relative spread is
 * undefined.
 */
function summarizeBaseline(values: number[]): { mean: number; spreadPct: number | null } {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean === 0) return { mean, spreadPct: null };
  const averageAbsoluteDeviation =
    values.reduce((sum, value) => sum + Math.abs(value - mean), 0) / values.length;
  return { mean, spreadPct: (averageAbsoluteDeviation / Math.abs(mean)) * 100 };
}

/**
 * Scan one tenant's READY datasets for anomalous metric movement.
 *
 * The scope is mandatory. `scan()` used to take no arguments and read every
 * dataset in the database, so the per-organization job the scheduler enqueues
 * scanned every tenant and wrote `AnomalyDetection` rows for all of them —
 * a cross-tenant data leak as well as duplicate anomalies.
 *
 * Fixes applied: F1 (data-derived periods), F2 (`ANOMALY_DEVIATION_THRESHOLD`
 * instead of a literal 30), F3 (explicit skip reasons, no `{ not: "" }` hack).
 */
export async function scan(scope: ScanScope): Promise<ScanResult> {
  const anomalies: AnomalyResponse[] = [];
  const skips: SkippedPair[] = [];
  let scanned = 0;
  const threshold = env.ANOMALY_DEVIATION_THRESHOLD;
  const periodDays = env.ANOMALY_PERIOD_DAYS;
  const baselinePeriods = env.ANOMALY_BASELINE_PERIODS;

  const datasets = await prisma.dataset.findMany({
    // Scoped to the tenant, and joined from Organization rather than filtered on
    // `organizationId: { not: "" }`: rows written before the email tenant fix
    // carry an empty-string organizationId, and filtering on that column makes
    // Postgres fail casting them.
where: {
      // `READY_WITH_WARNINGS` is analysable and is accepted by
      // `metrics.service.ts` for the actual metric computation below. Filtering
      // it out here meant a table with cosmetic warnings was never scanned for
      // anomalies at all.
      status: { in: ANALYTICS_READY_STATUSES },
      organization: { id: scope.organizationId },
      ...(scope.workspaceId === undefined ? {} : { workspaceId: scope.workspaceId }),
    },
    select: {
      id: true,
      organizationId: true,
      workspaceId: true,
      currentVersionId: true,
    },
  });

  for (const dataset of datasets) {
    const versionId = dataset.currentVersionId;
    if (!versionId) {
      for (const metricDef of CANONICAL_METRICS) {
        skips.push({
          datasetId: dataset.id,
          metricKind: metricDef.kind,
          reason: 'NO_DATA_IN_PERIOD',
          detail: 'Dataset has no current version.',
        });
      }
      continue;
    }

    // Resolved once per dataset: every metric needs the same date column, and a
    // dataset without one can never yield a period comparison.
    const columns = await prisma.datasetColumn.findMany({
      where: { datasetId: dataset.id, datasetVersionId: versionId },
      orderBy: { ordinalPosition: 'asc' },
    });
    const dateColumn = resolveScanDateColumn(columns);
    const dateColumnId = dateColumn?.id;

    for (const metricDef of CANONICAL_METRICS) {
      const metricKind = metricDef.kind as
        | 'REVENUE'
        | 'ORDERS'
        | 'CUSTOMERS'
        | 'EXPENSES'
        | 'PROFIT'
        | 'INVENTORY';

      try {
        // The metric column and the date column are resolved once per dataset,
        // not once per metric: all six canonical metrics need the same date
        // column, and a dataset without one can never produce an anomaly.
        if (!dateColumnId) {
          skips.push({
            datasetId: dataset.id,
            metricKind,
            reason: 'NO_DATE_COLUMN',
            detail:
              'This dataset has no DATE, TIME, or TIMESTAMP column, so no period can be compared.',
          });
          continue;
        }

        const range = await datasetDateRange(dataset.id, versionId, dateColumnId);
        if (!range) {
          skips.push({
            datasetId: dataset.id,
            metricKind,
            reason: 'NO_DATA_IN_PERIOD',
            detail: 'No dated rows, so no period can be derived from this dataset.',
          });
          continue;
        }

const windows = deriveWindows(range, periodDays, baselinePeriods);
        if (!windows) {
          skips.push({
            datasetId: dataset.id,
            metricKind,
            reason: 'NO_BASELINE_DATA',
            detail: `Data starts ${range.min.toISOString().slice(0, 10)}, which does not cover a ${periodDays}-day baseline before the current period.`,
          });
          continue;
        }

        const result = await computeMetric(
          {
            datasetId: dataset.id,
            metricKind,
            filters: {
              dateColumnId,
              dateFrom: windows.current.from.toISOString(),
              dateTo: windows.current.to.toISOString(),
            },
          },
          dataset.organizationId,
          dataset.workspaceId,
        );

        // Every baseline period is resolved in one parallel pass; each needs its
        // own aggregate, so a single call over the whole span cannot produce
        // them.
        const baselineResults = await Promise.all(
          windows.baselines.map((window) =>
            computeMetric(
              {
                datasetId: dataset.id,
                metricKind,
                filters: {
                  dateColumnId,
                  dateFrom: window.from.toISOString(),
                  dateTo: window.to.toISOString(),
                },
              },
              dataset.organizationId,
              dataset.workspaceId,
            ),
          ),
        );

        const currentValue = result.value;

        if (!result.available) {
          skips.push({
            datasetId: dataset.id,
            metricKind,
            reason: 'NO_VALUE_COLUMN',
            detail: `No ${metricDef.kind.toLowerCase()} column is mapped in this dataset.`,
          });
          continue;
        }

        if (currentValue == null) {
          skips.push({
            datasetId: dataset.id,
            metricKind,
            reason: 'NO_DATA_IN_PERIOD',
            detail: `No rows in ${windows.current.label}.`,
          });
          continue;
        }

        // A period with no rows still contributes nothing rather than being
        // treated as zero, so a gap cannot quietly pull the mean down.
        const baselineValues = baselineResults
          .map((baseline) => baseline.value)
          .filter((value): value is number => value != null);

        if (baselineValues.length === 0) {
          skips.push({
            datasetId: dataset.id,
            metricKind,
            reason: 'NO_BASELINE_DATA',
            detail: `No rows in the ${baselineValues.length === 0 ? windows.baselines.map((w) => w.label).join(', ') : 'baseline window'}.`,
          });
          continue;
        }

        const { mean: previousValue, spreadPct } = summarizeBaseline(baselineValues);

        if (previousValue === 0) {
          // A percentage change from zero is undefined; reporting a 100% drop
          // or a 100% rise would be invented precision.
          skips.push({
            datasetId: dataset.id,
            metricKind,
            reason: 'ZERO_BASELINE',
            detail: `Baseline mean is 0 and current is ${currentValue}; no percentage change is defined.`,
          });
          continue;
        }

        const deviationPct = ((currentValue - previousValue) / Math.abs(previousValue)) * 100;

        if (Math.abs(deviationPct) >= threshold) {
          const anomaly = await prisma.anomalyDetection.create({
            data: {
              organizationId: dataset.organizationId,
              workspaceId: dataset.workspaceId,
              datasetId: dataset.id,
              metricId: metricDef.kind,
              kind: currentValue > previousValue ? 'SPIKE' : 'DROP',
// Real data-derived labels rather than the hardcoded "2026-08".
              period: windows.current.label,
              // B11.3: every baseline period is persisted, plus the mean the
              // deviation was actually measured against and how volatile the
              // baseline was, so the evidence can be audited after the fact.
              baseline: {
                mean: previousValue,
                spreadPct,
                periodCount: windows.baselines.length,
                periods: windows.baselines.map((window, index) => ({
                  period: window.label,
                  from: window.from.toISOString(),
                  to: window.to.toISOString(),
                  value: baselineResults[index]?.value ?? null,
                })),
              },
              observed: {
                period: windows.current.label,
                from: windows.current.from.toISOString(),
                to: windows.current.to.toISOString(),
                value: currentValue,
              },
              deviationPct: Math.abs(deviationPct),
              status: 'OPEN' satisfies AnomalyStatus,
            },
          });
          anomalies.push(present(anomaly));
        }
        scanned++;
      } catch (error) {
        skips.push({
          datasetId: dataset.id,
          metricKind,
          reason: 'EVALUATION_FAILED',
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  logger.info(
    {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      anomalies: anomalies.length,
      scanned,
      skipped: skips.length,
threshold,
      periodDays,
      baselinePeriods,
      // Grouped so a reason is visible without dumping every pair.
      skipReasons: skips.reduce<Record<string, number>>((acc, skip) => {
        acc[skip.reason] = (acc[skip.reason] ?? 0) + 1;
        return acc;
      }, {}),
    },
    'Anomaly scan complete.',
  );
  return { anomalies, scanned, skipped: skips.length, skips };
}

/**
 * `deviationPct` is a Prisma `Decimal`, which `JSON.stringify` turns into the
 * string `"99.9"`. The frontend types it as a number, so every anomaly that
 * leaves the API is normalized here rather than at each call site.
 */
export type AnomalyResponse = Omit<AnomalyDetection, 'deviationPct'> & {
  deviationPct: number;
};

function present(anomaly: AnomalyDetection): AnomalyResponse {
  return {
    ...anomaly,
    deviationPct: Number(anomaly.deviationPct),
  };
}

export async function listAnomalies(
  organizationId: string,
  workspaceId: string,
  input: { status?: string; metricKind?: string; page: number; limit: number },
): Promise<{ anomalies: AnomalyResponse[]; total: number }> {
  const where: Record<string, unknown> = {
    organizationId,
    workspaceId,
  };
  if (input.status) where.status = input.status as AnomalyStatus;
  if (input.metricKind) where.metricId = input.metricKind;

  const [anomalies, total] = await Promise.all([
    prisma.anomalyDetection.findMany({
      where,
      skip: (input.page - 1) * input.limit,
      take: input.limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.anomalyDetection.count({ where }),
  ]);

  return { anomalies: anomalies.map(present), total };
}

export async function getAnomaly(id: string, organizationId: string): Promise<AnomalyResponse | null> {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    return null;
  }
  const anomaly = await prisma.anomalyDetection.findFirst({
    where: { id, organizationId },
  });
  return anomaly ? present(anomaly) : null;
}

export async function updateAnomalyStatus(
  id: string,
  organizationId: string,
  status: AnomalyStatus,
): Promise<AnomalyResponse | null> {
  const anomaly = await prisma.anomalyDetection.update({
    where: { id, organizationId },
    data: { status },
  });
  return present(anomaly);
}
