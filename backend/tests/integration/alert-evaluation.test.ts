import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AlertRuleService } from '../../src/modules/alerts/alert-rule.service.js';
import { prisma as appPrisma } from '../../src/lib/prisma.js';
import { createDatasetFixture, destroyOrganization, daysAgo } from '../helpers/dataset-fixture.js';

vi.mock('../../src/lib/redis.js', () => ({
  signalQueuedJob: vi.fn(async () => undefined),
  consumeAiSignal: vi.fn(async () => null),
  isRedisEnabled: vi.fn(() => false),
  closeRedis: vi.fn(async () => undefined),
}));

// Never touch a real mail transport from a test.
vi.mock('../../src/lib/email/email.provider.js', () => {
  const send = vi.fn(async () => ({ accepted: true, messageId: 'test' }));
  return { emailProvider: { sendEmail: send } };
});

const prisma = new PrismaClient();

/**
 * E1: alert rules were evaluated against a hardcoded 150000, so a rule could
 * never be right. E2: CHANGES_BY compared a value to itself. E3/E5: the job
 * payload did not match the SEND_EMAIL contract, so no email was ever sent.
 * E4: sendEmail wrote a placeholder organizationId into a uuid column.
 */
describe('Alert rules evaluate real data (E1-E5)', () => {
  let orgId: string;
  let workspaceId: string;
  let userId: string;
  let datasetId: string;
  let service: AlertRuleService;

  beforeEach(async () => {
    const org = await prisma.organization.create({
      data: { name: 'Alert Org', slug: `aorg-${randomUUID()}` },
    });
    orgId = org.id;
    const ws = await prisma.workspace.create({
      data: { name: 'Alert WS', organizationId: orgId, slug: `aws-${randomUUID()}` },
    });
    workspaceId = ws.id;
    const user = await prisma.user.create({
      data: {
        email: `a-${randomUUID()}@example.com`,
        name: 'Alert Owner',
        passwordHash: 'hashed',
        organizationId: orgId,
      },
    });
    userId = user.id;

    // Last 7 days: 100. The 7 days before that: 200.
    // => REVENUE total 300, weekly change -50%.
    const fixture = await createDatasetFixture(prisma, orgId, workspaceId, {
      withDateColumn: true,
      rows: [
        { revenue: 100, at: daysAgo(2) },
        { revenue: 200, at: daysAgo(9) },
      ],
    });
    datasetId = fixture.datasetId;

    service = new AlertRuleService(appPrisma as unknown as PrismaClient);
  });

  afterEach(async () => {
    // AlertRule.createdById is RESTRICT, so referencing rows must go first.
    await destroyOrganization(prisma, orgId);
  });

  async function createRule(overrides: Record<string, unknown> = {}) {
    return prisma.alertRule.create({
      data: {
        organizationId: orgId,
        workspaceId,
        name: 'Revenue guard',
        metricKind: 'REVENUE',
        datasetId,
        condition: 'GREATER_THAN',
        threshold: 250,
        frequency: 'WEEKLY',
        recipients: ['owner@example.com'],
        enabled: true,
        createdById: userId,
        ...overrides,
      },
    });
  }

  it('does not fire when the real metric is below the threshold', async () => {
    // The old hardcoded value was 150000, which is far above 1000 and would
    // have created a bogus alert here.
    const rule = await createRule({ threshold: 1000 });

    await service.evaluateAll(orgId, workspaceId);

    expect(await prisma.alert.count({ where: { ruleId: rule.id } })).toBe(0);
  });

  it('fires and records the real observed value as an object', async () => {
    const rule = await createRule({ threshold: 250 });

    await service.evaluateAll(orgId, workspaceId);

    const alert = await prisma.alert.findFirstOrThrow({ where: { ruleId: rule.id } });
    expect(alert.message).toContain('300');

    // `evidence` is a Json column: an object, not a JSON string.
    expect(typeof alert.evidence).toBe('object');
    const evidence = alert.evidence as Record<string, unknown>;
    expect(evidence.observed).toBe(300);
    expect(evidence.datasetId).toBe(datasetId);
    expect(evidence.metricKind).toBe('REVENUE');
  });

  it('falls back to the latest analysable dataset when the rule has none', async () => {
    const rule = await createRule({ datasetId: null, threshold: 250 });

    await service.evaluateAll(orgId, workspaceId);

    const alert = await prisma.alert.findFirstOrThrow({ where: { ruleId: rule.id } });
    expect((alert.evidence as Record<string, unknown>).datasetId).toBe(datasetId);
  });

  it('evaluates CHANGES_BY against the previous window, not against itself', async () => {
    // Weekly revenue fell 50% (200 -> 100), so a 40% rule must fire.
    const rule = await createRule({ condition: 'CHANGES_BY', threshold: 40, frequency: 'WEEKLY' });

    await service.evaluateAll(orgId, workspaceId);

    const alert = await prisma.alert.findFirstOrThrow({ where: { ruleId: rule.id } });
    const evidence = alert.evidence as Record<string, unknown>;
    expect(evidence.changePct).toBe(-50);
    expect(evidence.previousValue).toBe(200);
    expect(evidence.observed).toBe(-50);
    expect(alert.severity).toBe('CRITICAL');
  });

  it('does not fire CHANGES_BY below the threshold', async () => {
    const rule = await createRule({ condition: 'CHANGES_BY', threshold: 90 });

    await service.evaluateAll(orgId, workspaceId);

    expect(await prisma.alert.count({ where: { ruleId: rule.id } })).toBe(0);
  });

  it('sends an alert email through the real EmailDelivery + SEND_EMAIL contract', async () => {
    const rule = await createRule({ threshold: 250 });

    await service.evaluateAll(orgId, workspaceId);

    const alert = await prisma.alert.findFirstOrThrow({ where: { ruleId: rule.id } });

    // E5/E3: an EmailDelivery exists, owned by the real organization (E4).
    const delivery = await prisma.emailDelivery.findFirstOrThrow({
      where: { organizationId: orgId },
    });
    expect(delivery.template).toBe('alert_fired');
    expect(delivery.to).toEqual(['owner@example.com']);
    expect(delivery.jobId).toBeTruthy();

    // The job payload matches what the SEND_EMAIL worker reads. `payload` is a
    // Json column, so it arrives already parsed.
    const job = await prisma.job.findFirstOrThrow({
      where: { id: delivery.jobId as string },
    });
    const payload =
      typeof job.payload === 'string' ? JSON.parse(job.payload) : (job.payload as Record<string, unknown>);
    expect(payload.emailDeliveryId).toBe(delivery.id);
    expect(payload.to).toEqual(['owner@example.com']);
    expect(typeof payload.subject).toBe('string');
    expect(typeof payload.html).toBe('string');
    expect(payload).not.toHaveProperty('templateName');
    expect(job.organizationId).toBe(orgId);
    expect(alert.id).toBeTruthy();
  });

  it('suppresses a duplicate alert inside the dedup window', async () => {
    await createRule({ threshold: 250 });

    await service.evaluateAll(orgId, workspaceId);
    await service.evaluateAll(orgId, workspaceId);

    expect(await prisma.alert.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it('stamps lastTriggeredAt when a rule fires', async () => {
    const rule = await createRule({ threshold: 250 });
    expect(rule.lastTriggeredAt).toBeNull();

    await service.evaluateAll(orgId, workspaceId);

    const updated = await prisma.alertRule.findUniqueOrThrow({ where: { id: rule.id } });
    expect(updated.lastTriggeredAt).not.toBeNull();
  });

  it('creates no alert when the workspace has no analysable dataset', async () => {
    await prisma.dataset.update({ where: { id: datasetId }, data: { currentVersionId: null } });
    const rule = await createRule({ datasetId: null });

    await service.evaluateAll(orgId, workspaceId);

    expect(await prisma.alert.count({ where: { ruleId: rule.id } })).toBe(0);
    expect(await prisma.emailDelivery.count({ where: { organizationId: orgId } })).toBe(0);
  });
});
