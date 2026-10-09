import { z } from "zod";

export const metricKindSchema = z.enum([
  "REVENUE",
  "ORDERS",
  "CUSTOMERS",
  "EXPENSES",
  "PROFIT",
  "INVENTORY",
]);

/**
 * The metric kinds the analytics layer can actually compute. The Prisma
 * `MetricKind` enum is wider (it also has `CUSTOM`), so it must not be used as
 * the type for a computed metric.
 */
export type MetricKind = z.infer<typeof metricKindSchema>;

const filtersSchema = z.object({
  dateColumnId: z.string().min(1).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  dimensions: z.record(z.string(), z.string()).optional(),
});

export const metricsQuerySchema = z.object({
  datasetId: z.string().min(1),
  metricKind: metricKindSchema,
  filters: filtersSchema.optional(),
});

export const comparePeriodsSchema = z.object({
  datasetId: z.string().min(1),
  metricKind: metricKindSchema,
  dateColumnId: z.string().min(1).optional(),
  periodFrom: z.string().datetime(),
  periodTo: z.string().datetime(),
  filters: filtersSchema.optional(),
});

export const groupBySchema = z.object({
  datasetId: z.string().min(1),
  metricKind: metricKindSchema,
  groupByColumnId: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(10),
  filters: filtersSchema.optional(),
});

export type MetricsQueryInput = z.infer<typeof metricsQuerySchema>;
export type ComparePeriodsInput = z.infer<typeof comparePeriodsSchema>;
export type GroupByInput = z.infer<typeof groupBySchema>;
export type MetricFilters = z.infer<typeof filtersSchema>;