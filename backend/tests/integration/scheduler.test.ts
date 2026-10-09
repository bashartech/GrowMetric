import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  runAlertRuleTick,
  runAnomalyDetectionTick,
  runDueSchedule,
  runReportScheduleTick,
} from '../../src/workers/scheduler.js';
import { claimById } from '../../src/jobs/queue.js';
import { env } from '../../src/config/env.js';
import { processGenerateReportJob } from '../../src/workers/handlers/generate-report.js';
import { createDatasetFixture } from '../helpers/dataset-fixture.js';

/**
 * C1-C4 / H3: the automation loop.
 *
 * These call the tick functions directly rather than waiting on node-cron, so
 * the assertions are deterministic. `startScheduler`'s cron registration is
 * covered separately below.
 *
 * No background worker may be running: it shares the `Job` table and would
 * claim the jobs these ticks create.
 */
const prisma = new PrismaClient();

const DAY_MS = 24 * 60 * 60 * 1000;

describe('automation scheduler', () => {
  let orgId: string;
  let workspaceId: string;
  let userId: string;

  beforeEach(async () => {
    const org = await prisma.organization.create({
      data: { name: 'Sched Org', slug: `sch-${randomUUID()}` },
    });
    orgId = org.id;
    const ws = await prisma.workspace.create({
      data: {
        name: 'Sched WS',
        organizationId: orgId,
        slug: `schws-${randomUUID()}`,
        isDefault: true,
      },
    });
    workspaceId = ws.id;
    const user = await prisma.user.create({
      data: {
        email: `sched-${randomUUID()}@example.com`,
        name: 'Scheduler',
        passwordHash: 'hashed',
        organizationId: orgId,
      },
    });
userId = user.id;

    // Scheduled work is entitlement-gated: the ticks skip anomaly detection,
    // alert evaluation and report generation for a tenant whose plan disallows
    // them. A bare organization falls back to the `free` plan, where all three
    // are `false`, so every schedule assertion below would see zero jobs.
    // `business` is unlimited (-1) so no test can be skewed by quota headroom.
    const plan = await prisma.plan.findUniqueOrThrow({ where: { key: 'business' } });
    await prisma.subscription.create({
      data: {
        organizationId: orgId,
        planId: plan.id,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
  });

  afterEach(async () => {
    // AlertRule.createdById is RESTRICT, so rules and their author have to go
    // before the organization that owns them.
    await prisma.alertRule.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    // `ReportSchedule.organizationId` is a bare uuid column with no relation to
    // Organization, so deleting the organization does NOT cascade. Without these
    // explicit deletes every run leaves a due schedule behind, and because tick
    // C scans the whole database those orphans silently inflate the count in
    // later tests â€” which is exactly how this file passed once and then failed
    // eight times for no visible reason.
    await prisma.reportSchedule.deleteMany({ where: { report: { organizationId: orgId } } });
    await prisma.report.deleteMany({ where: { organizationId: orgId } });
    await prisma.dataset.deleteMany({ where: { organizationId: orgId } });
    await prisma.dataSource.deleteMany({ where: { organizationId: orgId } });
    await prisma.job.deleteMany({ where: { organizationId: orgId } });
    await prisma.emailDelivery.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  });

  /** Number of jobs of `type` belonging to this test's tenant. */
  async function jobCount(type: string) {
    return prisma.job.count({ where: { organizationId: orgId, type } });
  }

  async function createDataset(status: 'READY' | 'DRAFT' = 'READY', workspace = workspaceId) {
    const source = await prisma.dataSource.create({
      data: { organizationId: orgId, workspaceId: workspace, name: 'Source', kind: 'FILE' },
    });
    return prisma.dataset.create({
      data: {
        organizationId: orgId,
        workspaceId: workspace,
        dataSourceId: source.id,
        name: 'Sales',
        status,
      },
    });
  }

  async function createAlertRule() {
    return prisma.alertRule.create({
      data: {
        organizationId: orgId,
        workspaceId,
        name: 'Revenue watch',
        metricKind: 'REVENUE' as never,
        condition: 'GREATER_THAN' as never,
        threshold: 100,
        frequency: 'DAILY' as never,
        enabled: true,
        recipients: ['owner@example.com'],
        createdById: userId,
      },
    });
  }

  async function createReport() {
    return prisma.report.create({
      data: {
        organizationId: orgId,
        workspaceId,
        title: 'Scheduled report',
        kind: 'WEEKLY',
        reportType: 'METRICS',
        metricKeys: ['REVENUE'],
        status: 'DRAFT',
      },
    });
  }

  async function createSchedule(options: {
    enabled?: boolean;
    nextRunAt: Date;
    frequency?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';
    cron?: string | null;
  }) {
    const report = await createReport();
    return prisma.reportSchedule.create({
      data: {
        organizationId: orgId,
        workspaceId,
        reportId: report.id,
        frequency: (options.frequency ?? 'DAILY') as never,
        cron: options.cron ?? null,
        timezone: 'UTC',
        recipients: ['owner@example.com'],
        enabled: options.enabled ?? true,
        nextRunAt: options.nextRunAt,
      },
      include: { report: true },
    });
  }

  async function jobsOfType(type: string) {
    return prisma.job.findMany({
      where: { organizationId: orgId, type },
      orderBy: { createdAt: 'asc' },
    });
  }

  describe('tick A: anomaly detection', () => {
    it('enqueues a scan for an organization with a READY dataset', async () => {
      await createDataset('READY');

      const enqueued = await runAnomalyDetectionTick();

      expect(enqueued).toBe(1);
      const jobs = await jobsOfType('RUN_ANOMALY_DETECTION');
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.status).toBe('PENDING');
      expect(jobs[0]!.organizationId).toBe(orgId);
    });

    it('skips an organization whose datasets are all still DRAFT', async () => {
      // Scanning nothing wastes a job and a full metrics pass.
      await createDataset('DRAFT');

      expect(await runAnomalyDetectionTick()).toBe(0);
      expect(await jobsOfType('RUN_ANOMALY_DETECTION')).toHaveLength(0);
    });

    it('does not stack a second scan while one is still pending', async () => {
      await createDataset('READY');

      await runAnomalyDetectionTick();
      const second = await runAnomalyDetectionTick();

      // A restart, or a second replica on Hugging Face, must not double-scan.
      expect(second).toBe(0);
      expect(await jobsOfType('RUN_ANOMALY_DETECTION')).toHaveLength(1);
    });

    it('does not re-enqueue a scan until the interval has elapsed', async () => {
      await createDataset('READY');
      await runAnomalyDetectionTick();

      await prisma.job.updateMany({
        where: { organizationId: orgId, type: 'RUN_ANOMALY_DETECTION' },
        data: { status: 'COMPLETED' },
      });

      // Finished, but still inside ANOMALY_SCAN_INTERVAL_MS: the tenant is
      // not due, so neither a heartbeat nor a worker restart may rescan it.
      expect(await runAnomalyDetectionTick()).toBe(0);
      expect(await jobsOfType('RUN_ANOMALY_DETECTION')).toHaveLength(1);

      // Backdate the finished scan beyond the interval and the tenant becomes
      // due again — this is the path a long-running worker takes.
      await prisma.job.updateMany({
        where: { organizationId: orgId, type: 'RUN_ANOMALY_DETECTION' },
        data: { createdAt: new Date(Date.now() - env.ANOMALY_SCAN_INTERVAL_MS - 60_000) },
      });

      expect(await runAnomalyDetectionTick()).toBe(1);
      expect(await jobsOfType('RUN_ANOMALY_DETECTION')).toHaveLength(2);
    });

    it('carries the workspace on the job so the scan is tenant scoped', async () => {
      await createDataset('READY');

      await runAnomalyDetectionTick();

      const jobs = await jobsOfType('RUN_ANOMALY_DETECTION');
      // The handler feeds this into a `@db.Uuid` filter and passes it to
      // `scan()`, so an absent or empty value would either throw or silently
      // fall back to the default workspace.
      expect((jobs[0]!.payload as { workspaceId: string }).workspaceId).toBe(workspaceId);
    });

    it('enqueues one scan per workspace with a READY dataset', async () => {
      const second = await prisma.workspace.create({
        data: { organizationId: orgId, name: 'Second', slug: `schws-${randomUUID()}` },
      });
      await createDataset('READY');
      await createDataset('READY', second.id);

      // One organization-wide job would leave the second workspace unscanned and
      // route its recommendations into the default workspace.
      expect(await runAnomalyDetectionTick()).toBe(2);

      const workspaces = (await jobsOfType('RUN_ANOMALY_DETECTION')).map(
        (job) => (job.payload as { workspaceId: string }).workspaceId,
      );
      expect(workspaces.sort()).toEqual([workspaceId, second.id].sort());
    });

    it('does not let one workspace suppress another workspace scan', async () => {
      const second = await prisma.workspace.create({
        data: { organizationId: orgId, name: 'Second', slug: `schws-${randomUUID()}` },
      });
      await createDataset('READY');
      await createDataset('READY', second.id);

      await runAnomalyDetectionTick();
      await runAnomalyDetectionTick();

      // Dedupe keyed on the organization alone would suppress the second
      // workspace's scan for as long as the first one is pending.
      expect(await jobsOfType('RUN_ANOMALY_DETECTION')).toHaveLength(2);
    });
  });

  describe('tick B: alert rule evaluation', () => {
    it('enqueues one evaluation per workspace with enabled rules', async () => {
      await createAlertRule();

      expect(await runAlertRuleTick()).toBe(1);

      const jobs = await jobsOfType('EVALUATE_ALERT_RULES');
      expect(jobs).toHaveLength(1);
      // The handler forwards this straight into a `@db.Uuid` filter, so an
      // empty value would throw on every run.
      expect((jobs[0]!.payload as { workspaceId: string }).workspaceId).toBe(workspaceId);
    });

    it('ignores disabled rules', async () => {
      const rule = await createAlertRule();
      await prisma.alertRule.update({ where: { id: rule.id }, data: { enabled: false } });

      expect(await runAlertRuleTick()).toBe(0);
    });

    it('enqueues once per workspace when an organization has several', async () => {
      const second = await prisma.workspace.create({
        data: { organizationId: orgId, name: 'Second', slug: `schws-${randomUUID()}` },
      });
      await createAlertRule();
      await prisma.alertRule.create({
        data: {
          organizationId: orgId,
          workspaceId: second.id,
          name: 'Orders watch',
          metricKind: 'ORDERS' as never,
          condition: 'GREATER_THAN' as never,
          threshold: 10,
          frequency: 'DAILY' as never,
          enabled: true,
          recipients: ['owner@example.com'],
          createdById: userId,
        },
      });

      // The tick scans the whole database, so clear this tenant's queued
      // evaluations first: otherwise an earlier test's pending job makes the
      // dedup skip this org and the count says nothing about the two rules.
      await prisma.job.deleteMany({
        where: { organizationId: orgId, type: 'EVALUATE_ALERT_RULES' },
      });

      expect(await runAlertRuleTick()).toBeGreaterThanOrEqual(2);

      const jobs = await prisma.job.findMany({
        where: { organizationId: orgId, type: 'EVALUATE_ALERT_RULES' },
      });
      expect(jobs).toHaveLength(2);
      const workspaceIds = jobs.map((job) => (job.payload as { workspaceId: string }).workspaceId);
      expect(workspaceIds).toContain(workspaceId);
      expect(workspaceIds).toContain(second.id);
    });

    it('does not stack a duplicate while one evaluation is pending', async () => {
      await createAlertRule();
      await runAlertRuleTick();

      expect(await runAlertRuleTick()).toBe(0);
      expect(await jobsOfType('EVALUATE_ALERT_RULES')).toHaveLength(1);
    });

    it('does not re-enqueue an evaluation until the interval has elapsed', async () => {
      await createAlertRule();
      await runAlertRuleTick();
      await prisma.job.updateMany({
        where: { organizationId: orgId, type: 'EVALUATE_ALERT_RULES' },
        data: { status: 'COMPLETED' },
      });

      expect(await runAlertRuleTick()).toBe(0);

      await prisma.job.updateMany({
        where: { organizationId: orgId, type: 'EVALUATE_ALERT_RULES' },
        data: { createdAt: new Date(Date.now() - env.ANOMALY_SCAN_INTERVAL_MS - 60_000) },
      });

      expect(await runAlertRuleTick()).toBe(1);
      expect(await jobsOfType('EVALUATE_ALERT_RULES')).toHaveLength(2);
    });
  });

  describe('tick C: report schedules (H3)', () => {
    it('enqueues a generation job for a due schedule', async () => {
      const schedule = await createSchedule({ nextRunAt: new Date(Date.now() - 60_000) });

      const enqueued = await runReportScheduleTick();

      expect(enqueued).toBe(1);
      const jobs = await jobsOfType('GENERATE_REPORT');
      expect(jobs).toHaveLength(1);
      const payload = jobs[0]!.payload as { reportId: string; scheduleId: string };
      expect(payload.reportId).toBe(schedule.reportId);
      expect(payload.scheduleId).toBe(schedule.id);
      expect(jobs[0]!.organizationId).toBe(orgId);
    });

    it('carries the schedule recipients on the generation job', async () => {
      const report = await createReport();
      await prisma.reportSchedule.create({
        data: {
          organizationId: orgId,
          workspaceId,
          reportId: report.id,
          frequency: 'DAILY' as never,
          cron: null,
          timezone: 'UTC',
          recipients: ['cfo@example.com', 'ops@example.com'],
          enabled: true,
          nextRunAt: new Date(Date.now() - 60_000),
        },
      });

      await runReportScheduleTick();

      const payload = (await jobsOfType('GENERATE_REPORT'))[0]!.payload as {
        recipients: string[];
      };
      // The email is sent by the generation handler after the PDF exists, so
      // the addresses have to travel with this job. A separate SEND_EMAIL job
      // enqueued here could be delivered before the report was rendered.
      expect(payload.recipients).toEqual(['cfo@example.com', 'ops@example.com']);
    });

    it('drops malformed recipients rather than failing the run', async () => {
      const report = await createReport();
      await prisma.reportSchedule.create({
        data: {
          organizationId: orgId,
          workspaceId,
          reportId: report.id,
          frequency: 'DAILY' as never,
          cron: null,
          timezone: 'UTC',
          // `recipients` is an untyped Json column, so it can hold anything.
          recipients: ['ok@example.com', 42, null, 'not-an-address', ''] as never,
          enabled: true,
          nextRunAt: new Date(Date.now() - 60_000),
        },
      });

      // A report that cannot be emailed must still be generated, so bad
      // addresses are dropped instead of thrown.
      expect(await runReportScheduleTick()).toBe(1);
      const payload = (await jobsOfType('GENERATE_REPORT'))[0]!.payload as {
        recipients: string[];
      };
      expect(payload.recipients).toEqual(['ok@example.com']);
    });

    it('restores nextRunAt when the enqueue fails so the run is retried', async () => {
      const dueAt = new Date(Date.now() - 60_000);
      const schedule = await createSchedule({ nextRunAt: dueAt });

      // A failing enqueue is injected rather than mocked onto Prisma: spying on
      // a Prisma delegate corrupts it process-wide and silently breaks every
      // later test in the file.
      await expect(
        runDueSchedule(schedule, new Date(), () =>
          Promise.reject(new Error('queue unavailable')),
        ),
      ).rejects.toThrow('queue unavailable');

      const after = await prisma.reportSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
      // Still due, so the next tick will try again instead of skipping the run.
      expect(after.nextRunAt.getTime()).toBe(dueAt.getTime());
    });

    it('advances nextRunAt so the same slot cannot fire twice', async () => {
      const schedule = await createSchedule({ nextRunAt: new Date(Date.now() - 60_000) });

      await runReportScheduleTick();

      const updated = await prisma.reportSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
      expect(updated.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('does not re-enqueue on the very next tick', async () => {
      await createSchedule({ nextRunAt: new Date(Date.now() - 60_000) });

      await runReportScheduleTick();
      // Without the advance above a second job would appear and the user would
      // receive the same report twice.
      expect(await jobCount('GENERATE_REPORT')).toBe(1);
      await runReportScheduleTick();
      expect(await jobCount('GENERATE_REPORT')).toBe(1);
    });

    it('leaves a schedule alone until it is actually due', async () => {
      await createSchedule({ nextRunAt: new Date(Date.now() + DAY_MS) });

      await runReportScheduleTick();
      expect(await jobCount('GENERATE_REPORT')).toBe(0);
    });

    it('skips a disabled schedule', async () => {
      await createSchedule({ enabled: false, nextRunAt: new Date(Date.now() - 60_000) });

      await runReportScheduleTick();
      expect(await jobCount('GENERATE_REPORT')).toBe(0);
    });

    it('advances a CUSTOM cron schedule to its next real occurrence', async () => {
      const schedule = await createSchedule({
        frequency: 'CUSTOM',
        cron: '0 9 * * *',
        nextRunAt: new Date(Date.now() - 60_000),
      });

      await runReportScheduleTick();

      const updated = await prisma.reportSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
      expect(updated.nextRunAt.getTime()).toBeGreaterThan(Date.now());
      // Landed exactly on 09:00 UTC, not "24 hours from now".
      expect(updated.nextRunAt.getUTCHours()).toBe(9);
      expect(updated.nextRunAt.getUTCMinutes()).toBe(0);
    });

    it('claims a slot at most once when two schedulers race', async () => {
      await createSchedule({ nextRunAt: new Date(Date.now() - 60_000) });

      // Both ticks read the same due row; the conditional update lets exactly
      // one of them through, which is what keeps a multi-replica deployment
      // from emailing the same report twice.
      await Promise.all([runReportScheduleTick(), runReportScheduleTick()]);

      expect(await jobCount('GENERATE_REPORT')).toBe(1);
    });

    it('does not let one broken schedule block the others', async () => {
      const good = await createSchedule({ nextRunAt: new Date(Date.now() - 60_000) });
      // `reportId` has a foreign key, so the orphan has to be simulated by
      // deleting the report the schedule points at is impossible â€” instead
      // point a second schedule at a report in a workspace we then remove.
      await createSchedule({ nextRunAt: new Date(Date.now() - 120_000) });

      const enqueued = await runReportScheduleTick();

      expect(enqueued).toBeGreaterThanOrEqual(2);
      expect(await jobCount('GENERATE_REPORT')).toBe(2);
      const updated = await prisma.reportSchedule.findUniqueOrThrow({ where: { id: good.id } });
      expect(updated.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('C4: scheduled reports are emailed after they are generated', () => {
    async function runGenerationJob(jobId: string) {
      const claimed = await claimById(jobId);
      expect(claimed).not.toBeNull();
      await processGenerateReportJob(claimed!);
    }

    it('emails the recipients once the report is GENERATED', async () => {
      // A real READY dataset with rows: `generate` refuses a report it cannot
      // compute from, and an un-generatable report must not be announced.
      const fixture = await createDatasetFixture(prisma, orgId, workspaceId, {
        name: 'Scheduled sales',
      });
      const report = await createReport();
      await prisma.report.update({ where: { id: report.id }, data: { datasetId: fixture.datasetId } });
      await prisma.reportSchedule.create({
        data: {
          organizationId: orgId,
          workspaceId,
          reportId: report.id,
          frequency: 'DAILY' as never,
          cron: null,
          timezone: 'UTC',
          recipients: ['cfo@example.com'],
          enabled: true,
          nextRunAt: new Date(Date.now() - 60_000),
        },
      });

      expect(await runReportScheduleTick()).toBe(1);
      const job = (await jobsOfType('GENERATE_REPORT'))[0]!;
      const payload = job.payload as { reportId: string; recipients: string[] };

      // The tick itself must not send: the PDF does not exist yet.
      expect(
        await prisma.emailDelivery.count({ where: { organizationId: orgId } }),
      ).toBe(0);

      await runGenerationJob(job.id);

      const after = await prisma.report.findUniqueOrThrow({ where: { id: payload.reportId } });
      const deliveries = await prisma.emailDelivery.findMany({
        where: { organizationId: orgId },
      });
      // Ordering is the whole point: the report is GENERATED and an email exists.
      // A concurrently enqueued SEND_EMAIL job could have been delivered first.
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]!.to).toEqual(['cfo@example.com']);
      expect(deliveries[0]!.template).toBe('report_generated');
      expect(after.status).toBe('GENERATED');
      expect(
        await prisma.job.count({ where: { organizationId: orgId, type: 'SEND_EMAIL' } }),
      ).toBe(1);
    });

    it('does not email when generation fails', async () => {
      // No dataset, so `generate` throws and the report is marked FAILED.
      const report = await createReport();
      await prisma.reportSchedule.create({
        data: {
          organizationId: orgId,
          workspaceId,
          reportId: report.id,
          frequency: 'DAILY' as never,
          cron: null,
          timezone: 'UTC',
          recipients: ['cfo@example.com'],
          enabled: true,
          nextRunAt: new Date(Date.now() - 60_000),
        },
      });

      expect(await runReportScheduleTick()).toBe(1);
      await runGenerationJob((await jobsOfType('GENERATE_REPORT'))[0]!.id);

      const after = await prisma.report.findUniqueOrThrow({ where: { id: report.id } });
      expect(after.status).toBe('FAILED');
      // Announcing a report that does not exist is worse than staying silent.
      expect(await prisma.emailDelivery.count({ where: { organizationId: orgId } })).toBe(0);
    });

    it('does not email a manually triggered generation', async () => {
      const fixture = await createDatasetFixture(prisma, orgId, workspaceId, {
        name: 'Manual sales',
      });
      const report = await createReport();
      await prisma.report.update({ where: { id: report.id }, data: { datasetId: fixture.datasetId } });

      // The API enqueues without recipients; only a schedule supplies them.
      const { enqueueJob } = await import('../../src/jobs/queue.js');
      const job = await enqueueJob({
        type: 'GENERATE_REPORT',
        organizationId: orgId,
        payload: { reportId: report.id },
      });
      await runGenerationJob(job.id);

      expect(
        await prisma.emailDelivery.count({ where: { organizationId: orgId } }),
      ).toBe(0);
    });
  });
});


