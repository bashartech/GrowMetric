import { PrismaClient, AlertCondition, AlertSeverity, AlertRuleFrequency } from "@prisma/client";
import type { CreateAlertRuleInput, UpdateAlertRuleInput } from "./alert-rule.schema.js";
import { logger } from "../../lib/logger.js";
import { ANALYTICS_READY_STATUSES } from "../../lib/dataset-status.js";
import { notFound } from "../../lib/http-errors.js";
import { env } from "../../config/env.js";
import { computeMetric, comparePeriods } from "../analytics/metrics.service.js";
import type { MetricKind } from "../analytics/metrics.schema.js";
import { sendEmail } from "../../lib/email/email.service.js";
import { findPage, type PaginationInput } from "../../lib/pagination.js";

interface MetricObservation {
  available: boolean;
  /** The value the condition is applied to: the metric, or the % change. */
  observed: number | null;
  previousValue: number | null;
  changePct: number | null;
  period: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The window a rule looks at. Without a date column the metric total is used
 * as-is, so the window is only meaningful for CHANGES_BY comparisons.
 */
function windowFor(frequency: AlertRuleFrequency): {
  periodFrom: Date;
  periodTo: Date;
  period: string;
} {
  const days = frequency === 'DAILY' ? 1 : frequency === 'WEEKLY' ? 7 : 30;
  const periodTo = new Date();
  return {
    periodFrom: new Date(periodTo.getTime() - days * DAY_MS),
    periodTo,
    period: `last ${days} day${days === 1 ? '' : 's'}`,
  };
}

export class AlertRuleService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Create a new alert rule
   */
  async create(input: CreateAlertRuleInput, organizationId: string, createdById: string) {
    const rule = await this.prisma.alertRule.create({ 
      data: {
        name: input.name,
        metricKind: input.metricKind,
        datasetId: input.datasetId ?? null,
        condition: input.condition,
        threshold: input.threshold,
        frequency: input.frequency,
        recipients: input.recipients,
        organizationId,
        workspaceId: input.workspaceId,
        enabled: true,
        createdById,
      },
    });
    logger.info({ ruleId: rule.id }, 'Alert rule created');
    return { rule };
  }

  /**
   * List all alert rules for a workspace
   */
  /**
   * Paginated alert-rule list (Batch 10). Rules are far fewer than alerts, but
   * the endpoint was still unbounded and shared the same response shape.
   */
  async list(workspaceId: string, organizationId: string, paging: PaginationInput) {
    const where = { organizationId, workspaceId };
    const { items, meta } = await findPage(
      () =>
        this.prisma.alertRule.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (paging.page - 1) * paging.limit,
          take: paging.limit,
        }),
      () => this.prisma.alertRule.count({ where }),
      paging.page,
      paging.limit,
    );

    return { rules: items, meta };
  }

  /**
   * Get a single alert rule
   */
  async get(id: string, organizationId: string) {
    const rule = await this.prisma.alertRule.findFirst({
      where: { id, organizationId },
    });

    if (!rule) {
      throw notFound('Alert rule not found');
    }

    return { rule };
  }

  /**
   * Update an alert rule
   */
  async update(id: string, input: UpdateAlertRuleInput, organizationId: string) {
    const existing = await this.prisma.alertRule.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw notFound('Alert rule not found');
    }

    const rule = await this.prisma.alertRule.update({
      where: { id },
      data: input,
    });

    logger.info({ ruleId: id }, 'Alert rule updated');
    return { rule };
  }

  /**
   * Delete an alert rule.
   *
   * Alerts already raised are deliberately kept: an alert is a historical
   * record of something that happened. `Alert.ruleId` is `ON DELETE SET NULL`,
   * so those alerts survive with their rule reference cleared rather than
   * cascading the delete. `AlertRule` is only referenced by `Alert`, so this
   * delete cannot fail on a foreign key from anywhere else.
   */
  async remove(id: string, organizationId: string) {
    const existing = await this.prisma.alertRule.findFirst({
      where: { id, organizationId },
      select: { id: true },
    });

    if (!existing) {
      throw notFound('Alert rule not found');
    }

    await this.prisma.alertRule.delete({ where: { id } });
    logger.info({ ruleId: id, organizationId }, 'Alert rule deleted');
    return { id };
  }

  /**
   * Evaluate all enabled alert rules
   * Called by the scheduled job
   */
  async evaluateAll(organizationId: string, workspaceId: string): Promise<void> {
    const rules = await this.prisma.alertRule.findMany({
      where: {
        organizationId,
        workspaceId,
        enabled: true,
      },
    });

    logger.info({ ruleCount: rules.length }, 'Evaluating alert rules');

    for (const rule of rules) {
      try {
        await this.evaluateRule(rule.id, organizationId);
      } catch (error) {
        logger.error({ ruleId: rule.id, error }, 'Failed to evaluate alert rule');
      }
    }
  }

  /**
   * Evaluate a single rule against real dataset data.
   */
  private async evaluateRule(ruleId: string, organizationId: string): Promise<void> {
    const rule = await this.prisma.alertRule.findFirst({
      where: { id: ruleId, organizationId },
    });

    if (!rule || !rule.enabled) {
      return;
    }

    const datasetId = await this.resolveDatasetId(rule);
    if (!datasetId) {
      logger.warn(
        { ruleId, workspaceId: rule.workspaceId },
        'Skipping alert rule: no analysable dataset in workspace',
      );
      return;
    }

    const observation = await this.observe(rule, datasetId);
    if (!observation || !observation.available || observation.observed === null) {
      logger.debug({ ruleId, datasetId }, 'No metric value available');
      return;
    }

    const threshold = Number(rule.threshold);
    if (!this.evaluateCondition(observation, rule.condition, threshold)) {
      return;
    }

    // Check for duplicate alert within dedup window
    const dedupWindowMs = env.ALERT_DEDUP_WINDOW_MS || 3600000; // 1 hour default
    const dedupCutoff = new Date(Date.now() - dedupWindowMs);

    const existingAlert = await this.prisma.alert.findFirst({
      where: {
        ruleId: rule.id,
        status: 'OPEN',
        createdAt: { gte: dedupCutoff },
      },
    });

    if (existingAlert) {
      logger.debug({ ruleId, alertId: existingAlert.id }, 'Duplicate alert suppressed');
      return;
    }

    // Create alert
    const severity = this.determineSeverity(observation, rule.condition, threshold);
    const observed = observation.observed;
    const label = this.getConditionLabel(rule.condition);

    const alert = await this.prisma.alert.create({
      data: {
        ruleId: rule.id,
        title: `${rule.name}: ${rule.metricKind} ${label} ${rule.threshold}`,
        severity,
        message: `Alert triggered: ${rule.metricKind} is ${observed}, threshold was ${rule.threshold}`,
        // `evidence` is a Json column: an object, not a JSON string (D2).
        evidence: {
          ruleId: rule.id,
          ruleName: rule.name,
          metricKind: rule.metricKind,
          datasetId,
          condition: rule.condition,
          threshold: rule.threshold,
          observed,
          previousValue: observation.previousValue,
          changePct: observation.changePct,
          period: observation.period,
          evaluatedAt: new Date().toISOString(),
        },
        status: 'OPEN',
        organizationId: rule.organizationId,
        workspaceId: rule.workspaceId,
      },
    });

    await this.prisma.alertRule.update({
      where: { id: rule.id },
      data: { lastTriggeredAt: new Date() },
    });

    logger.info({ alertId: alert.id, ruleId }, 'Alert created');

    // E3/E5: the previous payload was written directly to Job and no email was
    // ever sent, because the worker's SEND_EMAIL contract is
    // { emailDeliveryId, to, subject, html }. Route through sendEmail instead.
    const recipients = this.parseRecipients(rule.recipients);
    if (recipients.length === 0) {
      logger.warn({ ruleId, alertId: alert.id }, 'Alert has no recipients; email skipped');
      return;
    }

    await sendEmail({
      to: recipients,
      subject: `Alert: ${rule.name} triggered`,
      template: 'alert_fired',
      templateVars: {
        ruleName: rule.name,
        message: `${rule.metricKind} ${label} ${rule.threshold} (observed ${observed})`,
        metricKind: rule.metricKind,
        currentValue: String(observed),
        threshold: String(rule.threshold),
        period: observation.period,
      },
      organizationId: rule.organizationId,
    });
  }

  /**
   * Use the rule's dataset when set, otherwise the workspace's latest
   * analysable dataset (E1). A rule could not be evaluated before this because
   * it had no dataset to read from.
   *
   * `READY_WITH_WARNINGS` counts as analysable, matching what
   * `metrics.service.ts` already accepts for analysis. Filtering on `READY`
   * alone made rules skip with "no analysable dataset in workspace" even though
   * the workspace held a perfectly readable table.
   */
  private async resolveDatasetId(rule: { datasetId: string | null; workspaceId: string }): Promise<string | null> {
    if (rule.datasetId) {
      return rule.datasetId;
    }

    const dataset = await this.prisma.dataset.findFirst({
      where: {
          workspaceId: rule.workspaceId,
          status: { in: ANALYTICS_READY_STATUSES },
        },
      orderBy: { createdAt: 'desc' },
      select: { id: true, currentVersionId: true },
    });

    if (!dataset?.currentVersionId) {
      return null;
    }
    return dataset.id;
  }

  private parseRecipients(recipients: unknown): string[] {
    if (Array.isArray(recipients)) {
      return recipients.filter((r): r is string => typeof r === 'string' && r.includes('@'));
    }
    if (typeof recipients === 'string') {
      return recipients.split(',').map((r) => r.trim()).filter((r) => r.includes('@'));
    }
    return [];
  }

  /**
   * Read the metric for the rule's window. CHANGES_BY needs a comparison
   * against the preceding window, so it uses comparePeriods (E2); every other
   * condition needs only the current value.
   */
  private async observe(
    rule: { metricKind: string; frequency: AlertRuleFrequency; workspaceId: string; organizationId: string; condition: AlertCondition },
    datasetId: string,
  ): Promise<MetricObservation> {
    const { periodFrom, periodTo, period } = windowFor(rule.frequency);
    // Stored rules may name a metric that predates the catalog. computeMetric
    // rejects unknown kinds with VALIDATION_ERROR, which evaluateAll logs and
    // moves on from, so an unknown kind never silently passes.
    const metricKind = rule.metricKind as MetricKind;

    if (rule.condition === 'CHANGES_BY') {
      const comparison = await comparePeriods(
        {
          datasetId,
          metricKind,
          periodFrom: periodFrom.toISOString(),
          periodTo: periodTo.toISOString(),
        },
        rule.organizationId,
        rule.workspaceId,
      );

      if (!comparison.available || comparison.value === null) {
        return { available: false, observed: null, previousValue: null, changePct: null, period };
      }
      return {
        available: true,
        // The observed value of a CHANGES_BY rule is the percentage change.
        observed: comparison.changePct ?? 0,
        previousValue: comparison.previousValue,
        changePct: comparison.changePct,
        period,
      };
    }

    const result = await computeMetric(
      { datasetId, metricKind },
      rule.organizationId,
      rule.workspaceId,
    );

    if (!result.available || result.value === null) {
      return { available: false, observed: null, previousValue: null, changePct: null, period };
    }
    return {
      available: true,
      observed: result.value,
      previousValue: null,
      changePct: null,
      period,
    };
  }

  /**
   * Evaluate condition logic against a real observation.
   */
  private evaluateCondition(
    observation: MetricObservation,
    condition: AlertCondition,
    threshold: number,
  ): boolean {
    const value = observation.observed as number;

    switch (condition) {
      case 'GREATER_THAN':
        return value > threshold;
      case 'LESS_THAN':
        return value < threshold;
      case 'EQUAL_TO':
        // An aggregate is a float, so strict equality would make this condition
        // unreachable. Compare within a small relative tolerance instead.
        if (threshold === 0) return Math.abs(value) < 0.0001;
        return Math.abs(value - threshold) <= Math.abs(threshold) * 0.005;
      case 'CHANGES_BY':
        // Threshold is the percentage magnitude, so a large rise and a large
        // fall both fire.
        return observation.changePct !== null && Math.abs(observation.changePct) >= Math.abs(threshold);
      default:
        return false;
    }
  }

  /**
   * Determine alert severity based on how far the observation is past the
   * threshold.
   */
  private determineSeverity(
    observation: MetricObservation,
    condition: AlertCondition,
    threshold: number,
  ): AlertSeverity {
    const value = observation.observed as number;

    // A relative deviation is meaningless at a zero threshold, and CHANGES_BY is
    // already expressed as a percentage.
    if (condition === 'CHANGES_BY' || threshold === 0) {
      const magnitude = Math.abs(value);
      if (magnitude >= 50) return 'CRITICAL';
      if (magnitude >= 25) return 'HIGH';
      if (magnitude >= 10) return 'MEDIUM';
      return 'LOW';
    }

    const deviation = (Math.abs(value - threshold) / Math.abs(threshold)) * 100;
    if (deviation >= 50) return 'CRITICAL';
    if (deviation >= 25) return 'HIGH';
    if (deviation >= 10) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Get human-readable condition label
   */
  private getConditionLabel(condition: AlertCondition): string {
    const labels = {
      GREATER_THAN: 'exceeds',
      LESS_THAN: 'falls below',
      EQUAL_TO: 'equals',
      CHANGES_BY: 'changes by',
    };
    return labels[condition] || condition;
  }
}
