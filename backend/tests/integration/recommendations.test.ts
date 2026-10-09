import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from "../../src/app.js";
import { signAccessToken } from "../../src/lib/tokens.js";
import { ACCESS_COOKIE } from "../../src/lib/cookies.js";
const app = createApp();

const prisma = new PrismaClient();

describe('Recommendations Integration', () => {
  let orgId: string;
  let workspaceId: string;
  let datasetId: string;
  let userId: string;
  let authToken: string;

  beforeEach(async () => {
    // Setup test organization, workspace, user
    // The slug is unique per run so leftover rows from an interrupted run
    // cannot make the next one fail on the unique constraint.
    const org = await prisma.organization.create({
      data: {
        name: 'Test Org',
        slug: `test-org-${randomUUID()}`,
      },
    });
    orgId = org.id;

    const workspace = await prisma.workspace.create({
      data: { name: 'Test Workspace', organizationId: orgId, slug: 'test-workspace' },
    });
    workspaceId = workspace.id;

    const user = await prisma.user.create({
      data: {
        email: 'test@example.com',
        name: 'Test User',
        passwordHash: 'hashed',
        organizationId: orgId,
      },
    });
    userId = user.id;

    // A real signed access token, delivered the way `requireAuth` reads it:
    // as the access-token cookie, not an Authorization header.
    const accessToken = await signAccessToken({
      sub: userId,
      email: user.email,
      org: orgId,
      ws: workspaceId,
    });
    authToken = accessToken;

    // Create a real DataSource to own the dataset. The fixture used to pass a
    // literal 'ds-source-1' into a @db.Uuid column, which made every test in
    // this file fail during setup before reaching the API under test.
    const dataSource = await prisma.dataSource.create({
      data: {
        name: 'Test Source',
        kind: 'EXTERNAL_DB',
        organizationId: orgId,
        workspaceId: workspaceId,
      },
    });

    // Create test dataset
    const dataset = await prisma.dataset.create({
      data: {
        name: 'Test Dataset',
        status: 'READY',
        organizationId: orgId,
        workspaceId: workspaceId,
        dataSourceId: dataSource.id,
      },
    });
    datasetId = dataset.id;
  });

  afterEach(async () => {
    // Recommendation/AnomalyDetection/Alert are plain `organizationId` columns
    // with no cascade from Organization, so they are removed explicitly.
    // Everything else (users, workspaces, data sources, datasets) cascades from
    // the org, which avoids the ordering bugs the row-by-row teardown had.
    await prisma.recommendation.deleteMany({ where: { organizationId: orgId } });
    await prisma.anomalyDetection.deleteMany({ where: { organizationId: orgId } });
    await prisma.alert.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  });

  describe('RUN_ANOMALY_DETECTION Ã¢â€ â€™ recommendations surface', () => {
    it('should show new recommendation items after anomaly detection runs', async () => {
      // Create an anomaly
      await prisma.anomalyDetection.create({
        data: {
          datasetId,
          metricId: 'REVENUE',
          kind: 'SPIKE',
          period: '2024-Q1',
          baseline: 100000,
          observed: 200000,
          deviationPct: 100.0,
          status: 'OPEN',
          organizationId: orgId,
          workspaceId: workspaceId,
        },
      });

      // Trigger recommendation generation (simulating worker)
      // In real implementation, this would be called by the anomaly worker
      const response = await request(app)
        .post('/api/v1/ai/recommendations/generate')
        .set('Cookie', `${ACCESS_COOKIE}=${authToken}`)
        .send({ workspaceId });

      expect(response.status).toBe(200);

      // Check recommendations list
      const listResponse = await request(app)
        .get('/api/v1/ai/recommendations')
        .set('Cookie', `${ACCESS_COOKIE}=${authToken}`)
        .query({ workspaceId });

      expect(listResponse.status).toBe(200);
      expect(listResponse.body.data.recommendations).toHaveLength(1);
      expect(listResponse.body.data.recommendations[0]).toMatchObject({
        severity: 'HIGH',
        source: 'ANOMALY',
        status: 'OPEN',
      });
    });

    it('should update status when recommendation is acknowledged', async () => {
      // Create a recommendation
      const rec = await prisma.recommendation.create({
        data: {
          severity: 'HIGH',
          source: 'ANOMALY',
          category: 'METRIC_DEVIATION',
          title: 'Revenue spike detected',
          description: 'Revenue increased 100%',
          evidence: JSON.stringify({ metricKind: 'REVENUE' }),
          status: 'OPEN',
          organizationId: orgId,
          workspaceId: workspaceId,
        },
      });

      // Acknowledge it
      const response = await request(app)
        .patch(`/api/v1/ai/recommendations/${rec.id}/status`)
        .set('Cookie', `${ACCESS_COOKIE}=${authToken}`)
        .send({ status: 'ACKNOWLEDGED' });

      expect(response.status).toBe(200);
      expect(response.body.data.recommendation.status).toBe('ACKNOWLEDGED');

      // Verify in database
      const updated = await prisma.recommendation.findUnique({
        where: { id: rec.id },
      });
      expect(updated?.status).toBe('ACKNOWLEDGED');
    });
  });

  describe('filtering', () => {
    it('should filter by severity and source', async () => {
      // Create recommendations with different attributes
      await prisma.recommendation.createMany({
        data: [
          {
            severity: 'HIGH',
            source: 'ANOMALY',
            category: 'METRIC_DEVIATION',
            title: 'High anomaly',
            description: 'Test',
            evidence: '{}',
            status: 'OPEN',
            organizationId: orgId,
            workspaceId: workspaceId,
          },
          {
            severity: 'LOW',
            source: 'RULE',
            category: 'ALERT_TRIGGERED',
            title: 'Low alert',
            description: 'Test',
            evidence: '{}',
            status: 'OPEN',
            organizationId: orgId,
            workspaceId: workspaceId,
          },
          {
            severity: 'HIGH',
            source: 'RULE',
            category: 'ALERT_TRIGGERED',
            title: 'High alert',
            description: 'Test',
            evidence: '{}',
            status: 'OPEN',
            organizationId: orgId,
            workspaceId: workspaceId,
          },
        ],
      });

      // Filter by source=ANOMALY
      const sourceFilter = await request(app)
        .get('/api/v1/ai/recommendations')
        .set('Cookie', `${ACCESS_COOKIE}=${authToken}`)
        .query({ workspaceId, source: 'ANOMALY' });

      expect(sourceFilter.body.data.recommendations).toHaveLength(1);
      expect(sourceFilter.body.data.recommendations[0].source).toBe('ANOMALY');

      // Filter by severity=HIGH
      const severityFilter = await request(app)
        .get('/api/v1/ai/recommendations')
        .set('Cookie', `${ACCESS_COOKIE}=${authToken}`)
        .query({ workspaceId, severity: 'HIGH' });

      expect(severityFilter.body.data.recommendations).toHaveLength(2);
      severityFilter.body.data.recommendations.forEach((rec: any) => {
        expect(rec.severity).toBe('HIGH');
      });
    });
  });

  describe('tenant isolation', () => {
    it('should deny access to recommendations from other organizations', async () => {
      // Create another org with a recommendation
      const otherOrg = await prisma.organization.create({
        data: { name: 'Other Org', slug: `other-org-${randomUUID()}` },
      });
      const otherWorkspace = await prisma.workspace.create({
        data: {
          name: 'Other Workspace',
          organizationId: otherOrg.id,
          slug: `other-workspace-${randomUUID()}`,
        },
      });
      const otherRec = await prisma.recommendation.create({
        data: {
          severity: 'HIGH',
          source: 'ANOMALY',
          category: 'METRIC_DEVIATION',
          title: 'Other org recommendation',
          description: 'Test',
          evidence: '{}',
          status: 'OPEN',
          organizationId: otherOrg.id,
          workspaceId: otherWorkspace.id,
        },
      });

      // Try to access it with our auth token
      const response = await request(app)
        .get(`/api/v1/ai/recommendations/${otherRec.id}`)
        .set('Cookie', `${ACCESS_COOKIE}=${authToken}`);

      expect(response.status).toBe(404);

      // Cleanup: Recommendation does not cascade from Organization.
      await prisma.recommendation.delete({ where: { id: otherRec.id } });
      await prisma.organization.delete({ where: { id: otherOrg.id } });
    });
  });

  /**
   * B11.2: recommendations previously drew on only two of the five
   * `RecommendationSource` values. Investigation findings and simulation
   * outcomes never became recommendations, so the enum promised three sources
   * the product never produced.
   */
  describe('B11.2 recommendation sources', () => {
    async function generateAndList() {
      const response = await request(app)
        .post('/api/v1/ai/recommendations/generate')
        .set('Cookie', `${ACCESS_COOKIE}=${authToken}`)
        .send({ workspaceId });
      expect(response.status).toBe(200);

      const list = await request(app)
        .get('/api/v1/ai/recommendations')
        .set('Cookie', `${ACCESS_COOKIE}=${authToken}`)
        .query({ workspaceId });
      expect(list.status).toBe(200);
      return list.body.data.recommendations as Array<{
        source: string;
        severity: string;
        category: string;
        description: string;
        evidence: string;
      }>;
    }

    it('turns a completed investigation finding into a recommendation', async () => {
      const investigation = await prisma.investigation.create({
        data: {
          organizationId: orgId,
          workspaceId: workspaceId,
          title: 'Revenue drop',
          question: 'Why did revenue fall?',
          topic: 'REVENUE',
          status: 'COMPLETED',
          datasetId,
          createdById: userId,
          findings: {
            create: [
              {
                level: 'MAIN',
                kind: 'DRIVER',
                title: 'Discounting drove the fall',
                summary: 'Deep discounts in Q2 coincided with the revenue decline.',
                evidence: { rows: 42 },
                confidence: 0.8,
                isCausalClaim: true,
              },
              {
                level: 'CORRELATION',
                kind: 'CONTRIBUTOR',
                title: 'Ad spend also fell',
                summary: 'Marketing spend moved with revenue.',
                evidence: { rows: 3 },
              },
            ],
          },
        },
      });

      const recommendations = await generateAndList();

      const fromInvestigation = recommendations.filter(
        (r) => r.source === 'INVESTIGATION',
      );
      // CORRELATION is supporting detail for the MAIN finding, so it must not
      // become a recommendation of its own and duplicate it.
      expect(fromInvestigation).toHaveLength(1);
      expect(fromInvestigation[0]).toMatchObject({
        category: 'INVESTIGATION_FINDING',
        severity: 'HIGH',
      });
      expect(fromInvestigation[0]!.description).toContain('causal link');

      // `isCausalClaim` is carried into the evidence rather than paraphrased
      // away, so a consumer can tell an asserted cause from an observation.
      const evidence = JSON.parse(fromInvestigation[0]!.evidence) as {
        isCausalClaim: boolean;
        findingId: string;
        confidence: number | null;
      };
      expect(evidence.isCausalClaim).toBe(true);
      expect(evidence.confidence).toBe(0.8);
      expect(evidence.findingId).toBeTruthy();

      await prisma.investigation.delete({ where: { id: investigation.id } });
    });

    it('ignores findings from an investigation that has not completed', async () => {
      await prisma.investigation.create({
        data: {
          organizationId: orgId,
          workspaceId: workspaceId,
          title: 'Still running',
          question: 'q',
          topic: 'REVENUE',
          status: 'RUNNING',
          datasetId,
          createdById: userId,
          findings: {
            create: [
              {
                level: 'MAIN',
                kind: 'DRIVER',
                title: 'Provisional driver',
                summary: 'Not finished yet.',
                evidence: {},
              },
            ],
          },
        },
      });

      const recommendations = await generateAndList();
      expect(recommendations.filter((r) => r.source === 'INVESTIGATION')).toHaveLength(0);
    });

    it('turns a completed simulation scenario into a recommendation', async () => {
      const simulation = await prisma.simulation.create({
        data: {
          organizationId: orgId,
          workspaceId: workspaceId,
          datasetId,
          name: 'Price sensitivity',
          createdById: userId,
          scenarios: {
            create: {
              type: 'PRICE_CHANGE',
              name: '10% price cut',
              parameters: { priceChangePct: -10 },
              assumptions: { elasticity: 1.2 },
              modelVersion: 'v1',
              status: 'COMPLETED',
              results: {
                create: [
                  {
                    metricKey: 'REVENUE',
                    currentValue: 100000,
                    projectedValue: 78000,
                    changePct: -22,
                    isEstimate: true,
                  },
                  {
                    metricKey: 'ORDERS',
                    currentValue: 400,
                    projectedValue: 470,
                    changePct: 17.5,
                    isEstimate: true,
                  },
                ],
              },
            },
          },
        },
      });

      const recommendations = await generateAndList();

      const fromSimulation = recommendations.filter((r) => r.source === 'SIMULATION');
      // One per scenario, not one per metric: a scenario moving two metrics is
      // one decision, and two rows would read as two separate problems.
      expect(fromSimulation).toHaveLength(1);
      expect(fromSimulation[0]!.category).toBe('SIMULATION_OUTCOME');
      // The largest absolute move (-22% revenue) leads the title, not the
      // alphabetically-first metric.
      expect(fromSimulation[0]!.description).toContain('Largest of 2 projected metrics');

      const evidence = JSON.parse(fromSimulation[0]!.evidence) as {
        projectedMetrics: Array<{ metricKey: string; changePct: number }>;
        modelVersion: string;
        isEstimate: boolean;
      };
      expect(evidence.projectedMetrics[0]).toMatchObject({
        metricKey: 'REVENUE',
        changePct: -22,
      });
      expect(evidence.modelVersion).toBe('v1');
      expect(evidence.isEstimate).toBe(true);

      await prisma.simulation.delete({ where: { id: simulation.id } });
    });

    it('ignores a scenario with no results to report', async () => {
      const simulation = await prisma.simulation.create({
        data: {
          organizationId: orgId,
          workspaceId: workspaceId,
          datasetId,
          name: 'Insufficient',
          createdById: userId,
          scenarios: {
            create: {
              type: 'PRICE_CHANGE',
              name: 'No data',
              parameters: {},
              assumptions: {},
              modelVersion: 'v1',
              status: 'INSUFFICIENT_DATA',
            },
          },
        },
      });

      const recommendations = await generateAndList();
      expect(recommendations.filter((r) => r.source === 'SIMULATION')).toHaveLength(0);

      await prisma.simulation.delete({ where: { id: simulation.id } });
    });

    it('reads a pre-B11.3 flat baseline without rendering NaN', async () => {
      // Rows written before the baseline shape changed stored `{ value }` with
      // no `mean`. A recommendation generated from one must still show a number.
      await prisma.anomalyDetection.create({
        data: {
          datasetId,
          metricId: 'REVENUE',
          kind: 'SPIKE',
          period: '2024-Q1',
          baseline: { period: '2024-Q4', value: 100000 },
          observed: 150000,
          deviationPct: 50,
          status: 'OPEN',
          organizationId: orgId,
          workspaceId: workspaceId,
        },
      });

      const recommendations = await generateAndList();
      const fromAnomaly = recommendations.find((r) => r.source === 'ANOMALY');
      expect(fromAnomaly).toBeDefined();
      expect(fromAnomaly!.description).not.toContain('NaN');
      expect(fromAnomaly!.description).toContain('100000');
    });

    it('never persists more than the batch cap', async () => {
      // More candidates than the cap allows, so the ceiling is exercised rather
      // than assumed.
      for (let index = 0; index < 60; index += 1) {
        await prisma.anomalyDetection.create({
          data: {
            datasetId,
            metricId: 'REVENUE',
            kind: 'SPIKE',
            // Distinct periods: the aggregator de-duplicates on metric+period.
            period: `2024-${String(index).padStart(2, '0')}`,
            baseline: { mean: 1000, periodCount: 4 },
            observed: 5000,
            deviationPct: 400,
            status: 'OPEN',
            organizationId: orgId,
            workspaceId: workspaceId,
          },
        });
      }

      await generateAndList();

      const stored = await prisma.recommendation.count({ where: { organizationId: orgId } });
      expect(stored).toBeLessThanOrEqual(50);
      expect(stored).toBeGreaterThan(0);
    });
  });
});
