import { prisma } from "../../src/lib/prisma.js";

export function uniqueEmail(prefix = "test"): string {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${nonce}@example.com`;
}

export async function cleanupByEmail(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return;
  // ImportJob.organizationId has a RESTRICT FK (no cascade), so delete first.
  await prisma.importJob
    .deleteMany({ where: { organizationId: user.organizationId } })
    .catch(() => undefined);
  await prisma.organization
    .delete({ where: { id: user.organizationId } })
    .catch(() => undefined);
}

export async function cleanupByEmails(emails: string[]): Promise<void> {
  for (const email of emails) {
    await cleanupByEmail(email);
  }
}

/**
 * Puts an organization on a named plan.
 *
 * Tests that exercise a metered feature (reports, alerts, anomaly detection)
 * have to opt in explicitly: `free` switches those off, so the API correctly
 * answers 402. Without this, such tests fail on entitlement rather than on the
 * behaviour they are meant to cover.
 *
 * The period window is set explicitly because `recordUsage` and the entitlement
 * gate both key usage records on `currentPeriodStart`.
 */
export async function grantPlan(
  organizationId: string,
  planKey = "pro",
): Promise<void> {
  const plan = await prisma.plan.findUnique({ where: { key: planKey } });
  if (!plan) {
    throw new Error(`Plan '${planKey}' is not seeded`);
  }

  const periodStart = new Date();
  periodStart.setUTCDate(1);
  periodStart.setUTCHours(0, 0, 0, 0);
  const periodEnd = new Date(periodStart);
  periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);

  await prisma.subscription.upsert({
    where: { organizationId },
    update: { planId: plan.id, status: "ACTIVE", currentPeriodStart: periodStart, currentPeriodEnd: periodEnd },
    create: { organizationId, planId: plan.id, status: "ACTIVE", currentPeriodStart: periodStart, currentPeriodEnd: periodEnd },
  });
}
