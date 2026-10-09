import { PrismaClient, RecommendationSeverity, RecommendationSource } from "@prisma/client";
import type {
  ListRecommendationsInput,
  UpdateRecommendationStatusInput,
} from "./recommendation.schema.js";
import { logger } from "../../lib/logger.js";
import { notFound } from "../../lib/http-errors.js";

/**
 * Reads the baseline mean out of an `AnomalyDetection.baseline` JSON blob.
 *
 * Rows written before B11.3 stored a flat `{ period, from, to, value }` with no
 * `mean`, so both shapes have to be handled: a recommendation generated from an
 * old anomaly must still render a number rather than NaN.
 */
function readBaselineMean(baseline: unknown): number {
  if (typeof baseline === 'number') return baseline;
  if (typeof baseline !== 'object' || baseline === null) return 0;
  const record = baseline as { mean?: unknown; value?: unknown };
  if (typeof record.mean === 'number') return record.mean;
  if (typeof record.value === 'number') return record.value;
  return 0;
}

/** How many trailing periods the mean was taken over, for the description text. */
function readBaselinePeriods(baseline: unknown): number {
  if (typeof baseline !== 'object' || baseline === null) return 1;
  const record = baseline as { periodCount?: unknown };
  return typeof record.periodCount === 'number' && record.periodCount > 0 ? record.periodCount : 1;
}

/**
 * Maps an investigation finding's level onto a recommendation severity.
 *
 * `confidence` is not used for the bucket: it is nullable and frequently absent,
 * and a finding that asserts causation without a confidence score should not be
 * silently downgraded. The level is what the investigation actually claims.
 */
function severityForFinding(level: string): RecommendationSeverity {
  switch (level) {
    case 'MAIN':
      return 'HIGH';
    case 'SUPPORTING':
      return 'MEDIUM';
    default:
      return 'LOW';
  }
}

/**
 * Most recommendations one scan may persist (B11.2).
 *
 * Four sources can each contribute many candidates; without a ceiling a single
 * scan over a busy workspace writes hundreds of rows that nobody reads.
 */
const RECOMMENDATION_BATCH_CAP = 50;

/**
 * Ranks recency against severity so the cap drops the least useful item.
 *
 * A severity weight multiplied by an exponential recency decay: a HIGH finding
 * from six months ago scores below a MEDIUM finding from yesterday, which is
 * what an operator wants at the top of a list they only skim.
 */
/**
 * A candidate recommendation before it is ranked and capped.
 *
 * `sourceTime` is the timestamp of whatever produced it - the anomaly's
 * `createdAt`, the finding's, the scenario's - so the batch can be ranked by
 * real recency instead of insertion order, which is all a single scan would
 * otherwise have to offer.
 */
interface RecommendationCandidate {
  row: Record<string, unknown>;
  severity: RecommendationSeverity;
  sourceTime: Date;
}

function rankScore(severity: RecommendationSeverity, createdAt: Date, now: Date): number {
  const weight = severity === 'HIGH' ? 3 : severity === 'MEDIUM' ? 2 : 1;
  const ageDays = Math.max(0, (now.getTime() - createdAt.getTime()) / 86_400_000);
  return weight * Math.exp(-ageDays / 30);
}

export class RecommendationService {
  constructor(private prisma: PrismaClient) {}

  async generate(workspaceId: string, organizationId: string): Promise<void> {
    logger.info({ organizationId, workspaceId }, 'Generating recommendations from signals');

    const anomalies = await this.prisma.anomalyDetection.findMany({
      where: { organizationId, workspaceId, status: 'OPEN' },
      include: { dataset: true },
    });

    const alerts = await this.prisma.alert.findMany({
      where: { organizationId, workspaceId, status: 'OPEN' },
      include: { rule: true },
    });

    // B11.2: findings from COMPLETED investigations. Only MAIN and SUPPORTING
    // become recommendations; CORRELATION findings are supporting detail for a
    // main finding and would duplicate it.
    const completedInvestigations = await this.prisma.investigation.findMany({
      where: { organizationId, workspaceId, status: 'COMPLETED' },
      include: { findings: true },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });

    // B11.2: projected outcomes from COMPLETED scenarios. INSUFFICIENT_DATA and
    // FAILED scenarios are excluded because there is no projection to act on.
    const completedScenarios = await this.prisma.simulationScenario.findMany({
      where: {
        status: 'COMPLETED',
        simulation: { organizationId, workspaceId },
      },
      include: { results: true, simulation: true },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });

    const anomalyMap = new Map<string, typeof anomalies[0]>();
    for (const anomaly of anomalies) {
      const key = `${anomaly.metricId ?? ''}-${anomaly.period}`;
      const existing = anomalyMap.get(key);
      if (!existing || anomaly.createdAt > existing.createdAt) {
        anomalyMap.set(key, anomaly);
      }
    }

    const recommendations: RecommendationCandidate[] = [];

    for (const anomaly of anomalyMap.values()) {
      const deviationPct = Number(anomaly.deviationPct);
      const observed = Number(anomaly.observed);
      // B11.3 changed `baseline` from a single number to an object holding the
      // mean, the spread and every contributing period. `Number(object)` is NaN,
      // so the mean has to be read explicitly or the text would say "vs
      // baseline NaN".
      const baseline = readBaselineMean(anomaly.baseline);
      const baselinePeriods = readBaselinePeriods(anomaly.baseline);
      const metricId = anomaly.metricId ?? 'UNKNOWN';
      const severity = this.calculateSeverity(deviationPct);
      recommendations.push({
        severity,
        sourceTime: anomaly.createdAt,
        row: {
          severity,
          source: 'ANOMALY' as RecommendationSource,
          category: 'METRIC_DEVIATION',
          title: `${metricId} deviation detected in ${anomaly.period}`,
          description: `Observed ${observed} vs baseline ${baseline} over ${baselinePeriods} prior period${baselinePeriods === 1 ? '' : 's'} (${Math.abs(deviationPct).toFixed(1)}% deviation)`,
          evidence: JSON.stringify({
            anomalyId: anomaly.id,
            datasetId: anomaly.datasetId ?? '',
            datasetName: anomaly.dataset?.name,
            metricId,
            period: anomaly.period,
            baseline,
            baselinePeriods,
            observed,
            deviationPct,
          }),
          suggestedAction: this.generateSuggestedAction(metricId, deviationPct),
          status: 'OPEN',
          organizationId,
          workspaceId,
        },
      });
    }

    for (const alert of alerts) {
      recommendations.push({
        severity: alert.severity,
        sourceTime: alert.createdAt,
        row: {
          severity: alert.severity,
          source: 'RULE' as RecommendationSource,
          category: 'ALERT_TRIGGERED',
          title: alert.title,
          description: alert.message,
          evidence: alert.evidence,
          suggestedAction: 'Review alert details and take appropriate action',
          status: 'OPEN',
          organizationId,
          workspaceId,
        },
      });
    }

    for (const investigation of completedInvestigations) {
      for (const finding of investigation.findings) {
        if (finding.level === 'CORRELATION') continue;
        const severity = severityForFinding(finding.level);
        recommendations.push({
          severity,
          sourceTime: finding.createdAt,
          row: {
            severity,
            source: 'INVESTIGATION' as RecommendationSource,
          category: 'INVESTIGATION_FINDING',
          title: finding.title,
          description: `${finding.summary}${finding.isCausalClaim ? ' (asserts a causal link)' : ''}`,
          // The finding's own evidence is the proof; `isCausalClaim` is carried
          // through rather than paraphrased away so a consumer can tell an
          // observed correlation from an asserted cause.
          evidence: JSON.stringify({
            investigationId: investigation.id,
            investigationTitle: investigation.title,
            findingId: finding.id,
            level: finding.level,
            kind: finding.kind,
            isCausalClaim: finding.isCausalClaim,
            confidence: finding.confidence == null ? null : Number(finding.confidence),
            findingEvidence: finding.evidence,
            metricChange: finding.metricChange,
          }),
          suggestedAction: this.suggestedActionForFinding(finding.kind),
          status: 'OPEN',
          organizationId,
          workspaceId,
          },
        });
      }
    }

    for (const scenario of completedScenarios) {
      // One recommendation per scenario, summarising its largest projected move
      // rather than one per metric: a scenario shifting eight metrics is one
      // decision for the operator, not eight.
      const results = [...scenario.results].sort(
        (a, b) => Math.abs(Number(b.changePct)) - Math.abs(Number(a.changePct)),
      );
      const largest = results[0];
      if (!largest) continue;

      const changePct = Number(largest.changePct);
      const severity = this.calculateSeverity(changePct);
      recommendations.push({
        severity,
        sourceTime: scenario.updatedAt,
        row: {
          severity,
          source: 'SIMULATION' as RecommendationSource,
        category: 'SIMULATION_OUTCOME',
        title: `${scenario.name}: ${largest.metricKey} projected to move ${changePct.toFixed(1)}%`,
        description:
          results.length > 1
            ? `Largest of ${results.length} projected metrics. Current ${Number(largest.currentValue).toFixed(2)} moves to ${Number(largest.projectedValue).toFixed(2)}.`
            : `Current ${Number(largest.currentValue).toFixed(2)} moves to ${Number(largest.projectedValue).toFixed(2)}.`,
        evidence: JSON.stringify({
          simulationId: scenario.simulation.id,
          simulationName: scenario.simulation.name,
          scenarioId: scenario.id,
          scenarioType: scenario.type,
          modelVersion: scenario.modelVersion,
          parameters: scenario.parameters,
          assumptions: scenario.assumptions,
          isEstimate: largest.isEstimate,
          confidence: largest.confidence == null ? null : Number(largest.confidence),
          projectedMetrics: results.map((result) => ({
            metricKey: result.metricKey,
            currentValue: Number(result.currentValue),
            projectedValue: Number(result.projectedValue),
            changePct: Number(result.changePct),
          })),
        }),
        suggestedAction: `Review the "${scenario.name}" scenario assumptions before acting on the projection.`,
          status: 'OPEN',
          organizationId,
          workspaceId,
        },
      });
    }

    if (recommendations.length === 0) {
      logger.info({ organizationId, workspaceId }, 'No new recommendations to generate');
      return;
    }

    // B11.2: cap the batch by severity x recency. Without a cap, four sources
    // multiplied by their inputs means a busy workspace can enqueue hundreds of
    // rows per scan, and the list endpoint then has nothing useful to show.
    const now = new Date();
    const capped = recommendations
      .map((candidate) => ({
        candidate,
        score: rankScore(candidate.severity, candidate.sourceTime, now),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, RECOMMENDATION_BATCH_CAP);

    if (recommendations.length > capped.length) {
      logger.info(
        { organizationId, workspaceId, generated: recommendations.length, kept: capped.length },
        'Recommendation batch capped by severity and recency.',
      );
    }

    await this.prisma.recommendation.createMany({
      data: capped.map((entry) => entry.candidate.row as never),
      skipDuplicates: true,
    });
    logger.info(
      { organizationId, workspaceId, count: capped.length },
      'Recommendations generated',
    );
  }

  async list(input: ListRecommendationsInput, organizationId: string) {
    const { workspaceId, source, severity, status } = input;
    const recommendations = await this.prisma.recommendation.findMany({
      where: { organizationId, workspaceId, ...(source && { source }), ...(severity && { severity }), ...(status && { status }) },
      orderBy: [{ severity: 'desc' as const }, { createdAt: 'desc' as const }],
    });
    return { recommendations };
  }

  async get(id: string, organizationId: string) {
    const recommendation = await this.prisma.recommendation.findFirst({ where: { id, organizationId } });
    if (!recommendation) throw notFound('Recommendation not found');
    return { recommendation };
  }

  async updateStatus(id: string, input: UpdateRecommendationStatusInput, organizationId: string) {
    const { status } = input;
    const recommendation = await this.prisma.recommendation.findFirst({ where: { id, organizationId } });
    if (!recommendation) throw notFound('Recommendation not found');
    const updated = await this.prisma.recommendation.update({ where: { id }, data: { status } });
    logger.info({ recommendationId: id, status }, 'Recommendation status updated');
    return { recommendation: updated };
  }

  private calculateSeverity(deviationPct: number): RecommendationSeverity {
    const absDeviation = Math.abs(deviationPct);
    if (absDeviation >= 50) return 'HIGH';
    if (absDeviation >= 25) return 'MEDIUM';
    return 'LOW';
  }

  private generateSuggestedAction(metricId: string, deviationPct: number): string {
    const direction = deviationPct > 0 ? 'increase' : 'decrease';
    const actions: Record<string, string> = {
      REVENUE: `Investigate the ${direction} in revenue. Review recent transactions and sales trends.`,
      ORDERS: `Analyze the ${direction} in order volume. Check for seasonal patterns or campaign impact.`,
      CUSTOMERS: `Examine the ${direction} in customer count. Review acquisition channels and retention.`,
      EXPENSES: `Review the ${direction} in expenses. Identify cost drivers and optimization opportunities.`,
      PROFIT: `Evaluate the ${direction} in profit. Analyze revenue vs expense trends.`,
      INVENTORY: `Monitor the ${direction} in inventory levels. Assess stock management and turnover.`,
    };
    return actions[metricId] || `Review the ${direction} in ${metricId} metrics.`;
  }

  /**
 * Action text for a finding, keyed by what the finding claims.
 *
 * `DRIVER` is the kind that asserts a cause, so it gets a verification step
 * first: telling the operator to act on an inferred driver as settled fact is
 * the failure mode this module exists to avoid. `CONTRIBUTOR` is a weaker claim
 * about the same thing.
 */
  private suggestedActionForFinding(kind: string): string {
    const actions: Record<string, string> = {
      DRIVER: 'Validate the claimed driver against raw data before acting on it.',
      CONTRIBUTOR: 'Weigh this contributor against the alternatives before acting.',
      ANOMALY: 'Cross-reference with the anomaly scan for the same metric.',
      STAT_STATIONARY: 'Confirm the series is genuinely flat before treating it as stable.',
    };
    return actions[kind] ?? 'Review the finding evidence and decide on next steps.';
  }
}
