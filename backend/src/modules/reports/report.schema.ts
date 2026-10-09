import { z } from 'zod';
import {
  ReportKind,
  ReportStatus,
  ReportScheduleFrequency,
  ReportType,
} from '@prisma/client';
import { metricKindSchema } from '../analytics/metrics.schema.js';

// Report schemas
export const reportSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  reportType: z.nativeEnum(ReportType),
  kind: z.nativeEnum(ReportKind),
  title: z.string(),
  metricKeys: z.array(metricKindSchema).optional(),
  content: z.string().optional(),
  pdfUrl: z.string().optional(),
  status: z.nativeEnum(ReportStatus),
  organizationId: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

/** Date range + dimension filters, matching analytics `filtersSchema`. */
export const reportFiltersSchema = z.object({
  dateColumnId: z.string().min(1).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  dimensions: z.record(z.string(), z.string()).optional(),
});

export const createReportSchema = z
  .object({
    workspaceId: z.string().uuid(),
    kind: z.nativeEnum(ReportKind),
    title: z.string().min(1).max(300),
    reportType: z.nativeEnum(ReportType).default(ReportType.METRICS),
    /** The user's selected records. Required for METRICS, forbidden for INVESTIGATION. */
    metricKeys: z.array(metricKindSchema).min(1).max(10).optional(),
    datasetId: z.string().uuid().nullish(),
    investigationId: z.string().uuid().nullish(),
    filters: reportFiltersSchema.optional(),
    breakdowns: z.array(z.string().min(1)).max(5).optional(),
  })
  // A metrics report without a dataset or metrics cannot be rendered, and an
  // investigation report without an investigation cannot either. Rejecting it
  // here is better than generating a report full of nulls.
  .superRefine((value, ctx) => {
    if (value.reportType === ReportType.METRICS) {
      if (!value.datasetId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['datasetId'],
          message: 'A metrics report requires a datasetId',
        });
      }
      if (!value.metricKeys?.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['metricKeys'],
          message: 'A metrics report requires at least one metric key',
        });
      }
      if (value.investigationId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['investigationId'],
          message: 'investigationId is not allowed for a metrics report',
        });
      }
    } else {
      if (!value.investigationId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['investigationId'],
          message: 'An investigation report requires an investigationId',
        });
      }
      if (value.metricKeys?.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['metricKeys'],
          message: 'metricKeys is not allowed for an investigation report',
        });
      }
    }
  });

export const generateReportSchema = z.object({
  reportId: z.string().uuid(),
});

// Report Schedule schemas
export const reportScheduleSchema = z.object({
  id: z.string().uuid(),
  reportId: z.string().uuid(),
  frequency: z.nativeEnum(ReportScheduleFrequency),
  cron: z.string().optional(),
  timezone: z.string(),
  recipients: z.array(z.string().email()),
  enabled: z.boolean(),
  nextRunAt: z.date(),
  organizationId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const createReportScheduleSchema = z.object({
  reportId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  frequency: z.nativeEnum(ReportScheduleFrequency),
  // D4: the Prisma column is `cron`; the old `cronExpression` name meant
  // schedule creation threw on every write.
  cron: z.string().min(1).optional(),
  timezone: z.string().default('UTC'),
  recipients: z.array(z.string().email()),
});

/**
 * D5: PATCH previously reused `createReportScheduleSchema`, which forced
 * `reportId` and `workspaceId` on every update. A partial update must not
 * require the immutable fields.
 */
export const updateReportScheduleSchema = z
  .object({
    frequency: z.nativeEnum(ReportScheduleFrequency).optional(),
    cron: z.string().min(1).optional(),
    timezone: z.string().optional(),
    recipients: z.array(z.string().email()).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

export type ReportDTO = z.infer<typeof reportSchema>;
export type CreateReportInput = z.infer<typeof createReportSchema>;
export type GenerateReportInput = z.infer<typeof generateReportSchema>;
export type ReportScheduleDTO = z.infer<typeof reportScheduleSchema>;
export type CreateReportScheduleInput = z.infer<typeof createReportScheduleSchema>;
export type UpdateReportScheduleInput = z.infer<typeof updateReportScheduleSchema>;
