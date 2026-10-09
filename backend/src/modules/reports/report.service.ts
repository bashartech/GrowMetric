import { Prisma, PrismaClient, ReportType } from "@prisma/client";
import type {
  CreateReportInput,
  GenerateReportInput,
  CreateReportScheduleInput,
  UpdateReportScheduleInput,
} from "./report.schema.js";
import { logger } from "../../lib/logger.js";
import { AppError, notFound } from "../../lib/http-errors.js";
import { storage } from "../../lib/storage.js";
import { nextRunAtAfterNow } from "../../lib/schedule-cadence.js";
import { enqueueJob } from "../../jobs/queue.js";
import { CANONICAL_METRICS } from "../analytics/metric-catalog.js";
import { findPage, type PaginationInput } from "../../lib/pagination.js";
import { computeMetric, groupByMetric } from "../analytics/metrics.service.js";
import type {
  MetricFilters as ReportFiltersInput,
  MetricKind,
} from "../analytics/metrics.schema.js";
import PDFDocument from "pdfkit";

/** The pdfkit document type, derived so it tracks the installed version. */
type PdfDoc = InstanceType<typeof PDFDocument>;

/** The report row fields the renderer needs, with Json columns typed. */
type ReportWithConfig = {
  id: string;
  title: string;
  kind: string;
  reportType: ReportType;
  organizationId: string;
  workspaceId: string;
  datasetId: string | null;
  investigationId: string | null;
  metricKeys: unknown;
  filters: unknown;
  breakdowns: unknown;
};

interface ReportMetric {
  metricKind: MetricKind;
  name: string;
  unit: string;
  value: number | null;
  available: boolean;
}

interface ReportBreakdown {
  metricKind: MetricKind;
  columnId: string;
  available: boolean;
  rows: Array<{ group: string; value: number }>;
}

interface ReportInvestigationContent {
  investigationId: string;
  title: string;
  question: string;
  status: string;
  periodTarget: unknown;
  periodBaseline: unknown;
  findings: Array<{
    level: string;
    kind: string;
    title: string;
    summary: string;
    confidence: number | null;
    isCausalClaim: boolean;
  }>;
}

interface ReportContent {
  title: string;
  kind: string;
  reportType: ReportType;
  generatedAt: string;
  metrics?: ReportMetric[];
  breakdowns?: ReportBreakdown[];
  investigation?: ReportInvestigationContent;
}

/**
 * Reports written before the storage migration stored a public URL
 * (`/uploads/reports/<file>.pdf`) in `pdfUrl`. New reports store a storage key
 * (`<orgId>/reports/<file>.pdf`). This normalises both onto a storage key so
 * existing reports keep downloading.
 */
export function reportStorageKey(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const legacyPrefix = "/uploads/";
  if (stored.startsWith(legacyPrefix)) {
    return stored.slice(legacyPrefix.length);
  }
  if (stored.startsWith("/")) return null;
  return stored;
}

export class ReportService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Create a new report
   */
  async create(input: CreateReportInput, organizationId: string) {
    const { filters, breakdowns, metricKeys, datasetId, investigationId, reportType, ...rest } = input;

    const report = await this.prisma.report.create({
      data: {
        ...rest,
        reportType,
        // Json columns need the raw value, not a JSON string, or the value is
        // stored double-encoded and must be parsed twice on read.
        metricKeys: metricKeys as unknown as Prisma.InputJsonValue,
        filters: (filters ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
        breakdowns: (breakdowns ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
        datasetId: datasetId ?? null,
        investigationId: investigationId ?? null,
        organizationId,
        status: 'DRAFT',
      },
    });

    logger.info({ reportId: report.id, reportType, datasetId }, 'Report created');
    return { report };
  }

  /**
   * List reports for a workspace
   */
  /**
   * Paginated report list (Batch 10).
   *
   * This previously returned every report in the workspace with no `skip`/`take`,
   * so a tenant with a long report history loaded the whole table on every page
   * of the UI.
   */
  async list(workspaceId: string, organizationId: string, paging: PaginationInput) {
    const where = { organizationId, workspaceId };
    const { items, meta } = await findPage(
      () =>
        this.prisma.report.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (paging.page - 1) * paging.limit,
          take: paging.limit,
        }),
      () => this.prisma.report.count({ where }),
      paging.page,
      paging.limit,
    );

    return { reports: items, meta };
  }

  /**
   * Get a single report
   */
  async get(id: string, organizationId: string) {
    const report = await this.prisma.report.findFirst({
      where: { id, organizationId },
    });

    if (!report) {
      throw notFound('Report not found');
    }

    return { report };
  }

  /**
   * Queue a generation run and return immediately (C5).
   *
   * `contracts/reports.md` specifies `202 Accepted` for
   * `POST /reports/:id/generate`: PDF rendering plus a dataset scan is slow
   * enough that holding the request open only produces gateway timeouts. The
   * job is what actually calls `generate`, and it owns the DRAFT → GENERATED |
   * FAILED transition, so this only validates access and enqueues.
   */
  async queueGeneration(reportId: string, organizationId: string): Promise<{ jobId: string; report: { id: string; status: string } }> {
    const report = await this.prisma.report.findFirst({
      where: { id: reportId, organizationId },
      select: { id: true, status: true },
    });

    if (!report) {
      throw notFound('Report not found');
    }

    const job = await enqueueJob({
      type: 'GENERATE_REPORT',
      organizationId,
      payload: { reportId: report.id },
    });

    logger.info({ reportId: report.id, jobId: job.id }, 'Report generation queued');
    return { jobId: job.id, report };
  }

  /**
   * Generate report content from configured metrics
   */
  async generate(input: GenerateReportInput, organizationId: string) {
    const report = await this.prisma.report.findFirst({
      where: { id: input.reportId, organizationId },
    });

    if (!report) {
      throw notFound('Report not found');
    }

    try {
      // Build content JSON from configured metrics
      const content = await this.buildReportContent(report);

      // Render to a buffer and persist through the storage abstraction so the
      // PDF works with R2 and survives an ephemeral filesystem.
      const bytes = await this.renderPDF(report, content);
      const storageKey = `${organizationId}/reports/report-${report.id}-${Date.now()}.pdf`;
      await storage.put(storageKey, bytes);

      // `content` is a Json? column: assign the object, never a JSON string,
      // otherwise the value is stored double-encoded and must be parsed twice.
      const updated = await this.prisma.report.update({
        where: { id: report.id },
        data: {
          content: content as unknown as Prisma.InputJsonValue,
          pdfUrl: storageKey,
          status: 'GENERATED',
          error: null,
        },
      });

      logger.info({ reportId: report.id, storageKey, bytes: bytes.length }, 'Report generated');
      return { report: updated };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown generation error';

      await this.prisma.report.update({
        where: { id: report.id },
        data: { status: 'FAILED', error: message },
      });

      logger.error({ reportId: report.id, error }, 'Report generation failed');
      throw new Error(`Report generation failed: ${message}`);
    }
  }

  /**
   * Build the report content from the user's selected records (D1).
   *
   * Every number comes from `computeMetric` / `groupByMetric` against the
   * report's dataset. A metric the dataset cannot supply is reported as
   * unavailable instead of being invented, so a report is never a work of
   * fiction.
   */
  private async buildReportContent(report: ReportWithConfig): Promise<ReportContent> {
    const base = {
      title: report.title,
      kind: report.kind,
      reportType: report.reportType,
      generatedAt: new Date().toISOString(),
    };

    if (report.reportType === 'INVESTIGATION') {
      return { ...base, investigation: await this.buildInvestigationContent(report) };
    }

    const datasetId = report.datasetId;
    if (!datasetId) {
      throw new AppError('VALIDATION_ERROR', 'This report has no dataset to compute from');
    }

    const metricKeys = (report.metricKeys as MetricKind[] | null) ?? [];
    if (metricKeys.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'This report has no metrics selected');
    }

    const filters = (report.filters as ReportFiltersInput | null) ?? undefined;

    // Each metric is independent, so one unsupported column must not fail the
    // whole report.
    const computed = await Promise.all(
      metricKeys.map(async (metricKind) => {
        const definition = CANONICAL_METRICS.find((m) => m.kind === metricKind);
        const result = await computeMetric(
          { datasetId, metricKind, filters },
          report.organizationId,
          report.workspaceId,
        );
        return {
          metricKind,
          name: definition?.name ?? metricKind,
          unit: result.unit,
          value: result.value,
          available: result.available,
        };
      }),
    );

    const breakdowns: ReportBreakdown[] = [];
    for (const metricKind of metricKeys) {
      for (const columnId of (report.breakdowns as string[] | null) ?? []) {
        const result = await groupByMetric(
          { datasetId, metricKind, groupByColumnId: columnId, limit: 10, filters },
          report.organizationId,
          report.workspaceId,
        );
        breakdowns.push({
          metricKind,
          columnId,
          available: result.available,
          rows: result.rows,
        });
      }
    }

    return { ...base, metrics: computed, breakdowns };
  }

  /**
   * An investigation report summarises the findings already produced for that
   * investigation. It never recomputes or invents conclusions.
   */
  private async buildInvestigationContent(
    report: ReportWithConfig,
  ): Promise<ReportInvestigationContent> {
    const investigation = await this.prisma.investigation.findFirst({
      where: { id: report.investigationId!, organizationId: report.organizationId },
      include: { findings: { orderBy: { createdAt: 'asc' } } },
    });

    if (!investigation) {
      throw notFound('Investigation not found');
    }

    return {
      investigationId: investigation.id,
      title: investigation.title,
      question: investigation.question,
      status: investigation.status,
      periodTarget: investigation.periodTarget,
      periodBaseline: investigation.periodBaseline,
      findings: investigation.findings.map((finding) => ({
        level: finding.level,
        kind: finding.kind,
        title: finding.title,
        summary: finding.summary,
        confidence: finding.confidence ? Number(finding.confidence) : null,
        isCausalClaim: finding.isCausalClaim,
      })),
    };
  }

  /**
   * Render report content to a PDF buffer.
   *
   * The buffer is handed to the storage abstraction rather than written to a
   * local path, so the same code works with R2 configured and without it. A
   * local path would also have been lost on every restart in an ephemeral
   * deployment.
   */
  private async renderPDF(report: any, content: any): Promise<Buffer> {
    return new Promise((resolvePromise, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolvePromise(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      doc.fontSize(20).text(content.title, { align: 'center' });
      doc.moveDown();
      doc.fontSize(10).text(`Generated: ${new Date(content.generatedAt).toUTCString()}`);
      doc.moveDown(2);

      if (content.investigation) {
        this.writeInvestigation(doc, content.investigation);
      } else {
        this.writeMetrics(doc, content.metrics ?? []);
        this.writeBreakdowns(doc, content.breakdowns ?? []);
      }

      doc.end();
    });
  }

  /** Metrics section; an unavailable metric is stated, never faked. */
  private writeMetrics(doc: PdfDoc, metrics: ReportMetric[]): void {
    doc.fontSize(16).text('Metrics Summary', { underline: true });
    doc.moveDown();
    doc.fontSize(12);

    if (metrics.length === 0) {
      doc.text('No metrics were selected for this report.');
      doc.moveDown();
      return;
    }

    for (const metric of metrics) {
      if (metric.available && metric.value !== null) {
        doc.text(`${metric.name}: ${this.formatNumber(metric.value)} ${metric.unit}`);
      } else {
        doc.fillColor('#b91c1c').text(
          `${metric.name}: not available — this dataset has no matching column.`,
        );
        doc.fillColor('#000000');
      }
    }
    doc.moveDown();
  }

  /** One small table per (metric, breakdown) pair. */
  private writeBreakdowns(doc: PdfDoc, breakdowns: ReportBreakdown[]): void {
    if (breakdowns.length === 0) return;

    for (const breakdown of breakdowns) {
      doc.fontSize(14).text(`${breakdown.metricKind} by ${breakdown.columnId}`, { underline: true });
      doc.moveDown(0.5);

      if (!breakdown.available || breakdown.rows.length === 0) {
        doc.fontSize(11).fillColor('#6b7280').text('No data for this breakdown.');
        doc.fillColor('#000000');
        doc.moveDown();
        continue;
      }

      doc.fontSize(11);
      for (const row of breakdown.rows) {
        doc.text(`${row.group}: ${this.formatNumber(row.value)}`);
      }
      doc.moveDown();
    }
  }

  private writeInvestigation(doc: PdfDoc, content: ReportInvestigationContent): void {
    doc.fontSize(16).text('Investigation', { underline: true });
    doc.moveDown();
    doc.fontSize(12);
    doc.text(`Question: ${content.question}`);
    doc.text(`Status: ${content.status}`);
    doc.moveDown();

    doc.fontSize(14).text('Findings', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11);

    if (content.findings.length === 0) {
      doc.text('This investigation produced no findings.');
      doc.moveDown();
      return;
    }

    for (const finding of content.findings) {
      doc.fontSize(12).fillColor('#111827').text(`${finding.level} · ${finding.title}`, { underline: true });
      doc.fillColor('#000000').fontSize(11);
      doc.text(finding.summary, { align: 'left' });
      if (finding.confidence !== null) {
        doc.text(`Confidence: ${finding.confidence}`);
      }
      doc.moveDown(0.75);
    }
  }

  /** Thousands separators and no exponent notation for large sums. */
  private formatNumber(value: number): string {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
  }

  /**
   * Read a generated report's PDF. The report must belong to the caller's
   * organization, so a foreign id is reported as 404 rather than 403 and never
   * reveals whether it exists.
   */
  async getPdf(id: string, organizationId: string): Promise<{ report: any; bytes: Buffer }> {
    const report = await this.prisma.report.findFirst({
      where: { id, organizationId },
    });

    if (!report) {
      throw notFound('Report not found');
    }

    const key = reportStorageKey(report.pdfUrl);
    if (!key) {
      throw notFound('This report has no generated PDF yet');
    }

    const bytes = await storage.getObject(key);
    if (!bytes) {
      logger.warn({ reportId: id, key }, 'Stored report PDF is missing');
      throw notFound('The stored PDF is no longer available. Generate the report again.');
    }

    return { report, bytes };
  }

  /**
   * Create a report schedule
   */
  async createSchedule(input: CreateReportScheduleInput, organizationId: string) {
    const schedule = await this.prisma.reportSchedule.create({
      data: {
        ...input,
        organizationId,
        enabled: true,
        nextRunAt: this.calculateNextRun(input.frequency, input.cron, input.timezone),
      },
    });

    logger.info({ scheduleId: schedule.id }, 'Report schedule created');
    return { schedule };
  }

  /**
   * List report schedules
   */
  async listSchedules(
    workspaceId: string,
    organizationId: string,
    paging: PaginationInput,
  ) {
    const where = { organizationId, workspaceId };
    const { items, meta } = await findPage(
      () =>
        this.prisma.reportSchedule.findMany({
          where,
          include: { report: true },
          orderBy: { createdAt: 'desc' },
          skip: (paging.page - 1) * paging.limit,
          take: paging.limit,
        }),
      () => this.prisma.reportSchedule.count({ where }),
      paging.page,
      paging.limit,
    );

    return { schedules: items, meta };
  }

  /**
   * Get a single schedule
   */
  async getSchedule(id: string, organizationId: string) {
    const schedule = await this.prisma.reportSchedule.findFirst({
      where: { id, organizationId },
      include: { report: true },
    });

    if (!schedule) {
      throw notFound('Report schedule not found');
    }

    return { schedule };
  }

  /**
   * Update a report schedule
   */
  async updateSchedule(id: string, input: UpdateReportScheduleInput, organizationId: string) {
    const existing = await this.prisma.reportSchedule.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw notFound('Report schedule not found');
    }

    // Changing the cadence, the cron, or the timezone must move the next run.
    // Timezone matters as much as frequency: `09:00 Asia/Karachi` and
    // `09:00 UTC` are different instants, so a timezone-only edit that kept the
    // old `nextRunAt` would fire at the wrong hour until the next tick rewrote
    // it.
    const cadenceChanged =
      input.frequency !== undefined ||
      input.cron !== undefined ||
      input.timezone !== undefined;
    const nextRunAt =
      cadenceChanged && (input.enabled ?? existing.enabled)
        ? this.calculateNextRun(
            input.frequency ?? existing.frequency,
            input.cron ?? existing.cron,
            input.timezone ?? existing.timezone,
          )
        : undefined;

    const schedule = await this.prisma.reportSchedule.update({
      where: { id },
      data: nextRunAt ? { ...input, nextRunAt } : input,
    });

    logger.info({ scheduleId: id }, 'Report schedule updated');
    return { schedule };
  }

  /**
   * Delete a report
   */
  async delete(id: string, organizationId: string) {
    const report = await this.prisma.report.findFirst({
      where: { id, organizationId },
    });

    if (!report) {
      throw notFound('Report not found');
    }

    await this.prisma.report.delete({ where: { id } });
    logger.info({ reportId: id }, 'Report deleted');
    return { deleted: true, id };
  }

  /**
   * Delete a report schedule
   */
  async deleteSchedule(id: string, organizationId: string) {
    const schedule = await this.prisma.reportSchedule.findFirst({
      where: { id, organizationId },
    });

    if (!schedule) {
      throw notFound('Report schedule not found');
    }

    await this.prisma.reportSchedule.delete({ where: { id } });
    logger.info({ scheduleId: id }, 'Report schedule deleted');
    return { deleted: true, id };
  }

  /**
   * Calculate next run time based on frequency.
   *
   * The cadence maths lives in `lib/schedule-cadence.ts` so the scheduler's
   * tick advances schedules with exactly the same rule that created them.
   */
  private calculateNextRun(frequency: string, cron?: string | null, timezone?: string | null): Date {
    return nextRunAtAfterNow(frequency, cron, new Date(), timezone ?? 'UTC');
  }
}
