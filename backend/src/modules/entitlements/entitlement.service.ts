import type { Prisma } from "@prisma/client";
import { AppError, entitlementRequired } from "../../lib/http-errors.js";
import { prisma } from "../../lib/prisma.js";

export const DEFAULT_PLAN_KEY = "free";

export type FeatureLimits = Record<string, number | boolean>;

const METRIC_FEATURE_MAP: Record<string, string> = {
  ai_conversations: "aiConversations",
  ai_runs: "aiRuns",
  ai_investigations: "aiInvestigations",
  simulations: "simulations",
  reports: "reports",
  anomaly_detection: "anomalyDetection",
  alerts: "alerts",
  data_sources: "dataSources",
  datasets: "datasets",
  imports: "imports",
};

export function resolveFeatureKey(metric: string): string {
  return METRIC_FEATURE_MAP[metric] ?? metric;
}

/**
 * Inverse of `resolveFeatureKey`: the usage metric a plan feature is metered
 * against. Feature keys that nothing meters (`simulations`, `aiConversations`
 * when no run is recorded against it) fall back to the feature key itself,
 * which simply reads as zero usage.
 */
export function resolveMetricForFeature(featureKey: string): string {
  const entry = Object.entries(METRIC_FEATURE_MAP).find(([, key]) => key === featureKey);
  return entry?.[0] ?? featureKey;
}

export interface LimitEvaluation {
  allowed: boolean;
  limit: number | boolean | null;
}

export function evaluateUsageLimit(
  featureLimits: FeatureLimits,
  metric: string,
  currentAmount: number,
  amount: number,
): LimitEvaluation {
  const featureKey = resolveFeatureKey(metric);
  const limit = featureLimits[featureKey];

  if (limit === undefined || limit === null) {
    return { allowed: true, limit: null };
  }

  if (typeof limit === "boolean") {
    return { allowed: limit, limit };
  }

  if (limit < 0) {
    return { allowed: true, limit };
  }

  return { allowed: currentAmount + amount <= limit, limit };
}

function toFeatureLimits(value: Prisma.JsonValue): FeatureLimits {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as FeatureLimits;
}

/**
 * Whether a feature is switched on at all, ignoring quota.
 *
 * Scheduled work has no request to hang an entitlement check on, so this is the
 * only way to stop a free tenant from accruing anomaly scans and alert
 * evaluations every hour. `false` and `0` mean off; `true` and negatives mean
 * unlimited; an absent key means the plan says nothing, which is treated as
 * allowed so a feature nothing meters is never blocked by accident.
 */
export interface FeatureAvailability {
  allowed: boolean;
  reason: "ok" | "not-entitled" | "quota-exhausted";
  limit: number | boolean | null;
  used: number;
}

/**
 * Quota-aware entitlement check for code paths that have no HTTP response to
 * reject - the job worker and the scheduler.
 *
 * `isFeatureEnabled` only reads the plan's feature flag, so a `pro` tenant at
 * its 100-report ceiling still had every scheduled report generated. Background
 * work cannot return a 402, so callers must ask first and skip explicitly.
 */
export async function checkFeatureAvailability(
  organizationId: string,
  featureKey: string,
  amount = 1,
): Promise<FeatureAvailability> {
  const { features } = await getEntitlements(organizationId);
  const value = features[featureKey];

  if (value === undefined || value === null) {
    return { allowed: true, reason: "ok", limit: null, used: 0 };
  }
  if (value === false) {
    return { allowed: false, reason: "not-entitled", limit: false, used: 0 };
  }
  if (value === true) {
    return { allowed: true, reason: "ok", limit: true, used: 0 };
  }
  // Negative limits are unlimited by convention in the plan seed.
  if (value < 0) {
    return { allowed: true, reason: "ok", limit: value, used: 0 };
  }

  const measured = await currentPeriodUsage(organizationId, resolveMetricForFeature(featureKey));
  // No subscription means no current period to bill against, so usage is
  // unknown rather than zero. Mirror the route gate and defer to the plan
  // feature flag instead of failing closed on a missing subscription.
  if (measured === null) {
    return { allowed: true, reason: "ok", limit: value, used: 0 };
  }

  const withinLimit = measured + amount <= value;
  return {
    allowed: withinLimit,
    reason: withinLimit ? "ok" : "quota-exhausted",
    limit: value,
    used: measured,
  };
}

/**
 * Resolves the organization's current-period usage for a metered metric.
 *
 * Returns `null` when the organization has no subscription. Entitlements fall
 * back to the default plan in that case, so a missing subscription must not
 * read as "no usage" on a paid plan - it is reported as unknown and callers
 * defer to the plan feature flag alone.
 */
export async function currentPeriodUsage(
  organizationId: string,
  metric: string,
): Promise<number | null> {
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId },
    select: { currentPeriodStart: true },
  });
  if (!subscription) return null;

  const record = await prisma.usageRecord.findUnique({
    where: {
      organizationId_metric_periodStart: {
        organizationId,
        metric,
        periodStart: subscription.currentPeriodStart,
      },
    },
    select: { amount: true },
  });
  return record?.amount ?? 0;
}

export async function isFeatureEnabled(
  organizationId: string,
  featureKey: string,
): Promise<boolean> {
  const { features } = await getEntitlements(organizationId);
  const value = features[featureKey];
  if (value === undefined || value === null) return true;
  if (typeof value === "boolean") return value;
  return value !== 0;
}

export async function getEntitlements(organizationId: string) {  const subscription = await prisma.subscription.findUnique({
    where: { organizationId },
    include: { plan: true },
  });

  const plan =
    subscription?.plan ??
    (await prisma.plan.findUnique({ where: { key: DEFAULT_PLAN_KEY } }));

  if (!plan) {
    throw new AppError(
      "INTERNAL_ERROR",
      "The default plan is not configured.",
    );
  }

  return {
    plan: { key: plan.key, name: plan.name },
    features: toFeatureLimits(plan.featureLimits),
    subscription: subscription
      ? {
          status: subscription.status,
          currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
        }
      : null,
  };
}

async function currentPeriod(organizationId: string) {
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId },
  });

  if (!subscription) {
    throw new AppError("NOT_FOUND", "No subscription found for this organization");
  }

  return subscription;
}

export async function getUsage(organizationId: string, metric?: string) {
  const subscription = await currentPeriod(organizationId);

  if (metric) {
    const record = await prisma.usageRecord.findUnique({
      where: {
        organizationId_metric_periodStart: {
          organizationId,
          metric,
          periodStart: subscription.currentPeriodStart,
        },
      },
    });

    return {
      metric,
      periodStart: subscription.currentPeriodStart.toISOString(),
      periodEnd: subscription.currentPeriodEnd.toISOString(),
      amount: record?.amount ?? 0,
    };
  }

  const records = await prisma.usageRecord.findMany({
    where: {
      organizationId,
      periodStart: subscription.currentPeriodStart,
    },
    orderBy: { metric: "asc" },
  });

  return {
    periodStart: subscription.currentPeriodStart.toISOString(),
    periodEnd: subscription.currentPeriodEnd.toISOString(),
    items: records.map((record) => ({
      metric: record.metric,
      amount: record.amount,
    })),
  };
}

export async function recordUsage(
  organizationId: string,
  metric: string,
  amount: number,
) {
  const subscription = await currentPeriod(organizationId);

  const existing = await prisma.usageRecord.findUnique({
    where: {
      organizationId_metric_periodStart: {
        organizationId,
        metric,
        periodStart: subscription.currentPeriodStart,
      },
    },
  });

  const plan = subscription.planId
    ? await prisma.plan.findUnique({ where: { id: subscription.planId } })
    : null;

  const evaluation = evaluateUsageLimit(
    toFeatureLimits(plan?.featureLimits ?? null),
    metric,
    existing?.amount ?? 0,
    amount,
  );

  if (!evaluation.allowed) {
    throw entitlementRequired(
      "Your plan limit for this capability has been reached.",
      { metric, limit: evaluation.limit, currentAmount: existing?.amount ?? 0 },
    );
  }

  const record = await prisma.usageRecord.upsert({
    where: {
      organizationId_metric_periodStart: {
        organizationId,
        metric,
        periodStart: subscription.currentPeriodStart,
      },
    },
    update: { amount: { increment: amount } },
    create: {
      organizationId,
      metric,
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
      amount,
    },
  });

  return { metric: record.metric, amount: record.amount };
}
