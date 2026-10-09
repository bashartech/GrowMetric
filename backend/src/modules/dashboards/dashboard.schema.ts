import { z } from "zod";

const filtersSchema = z.object({
  dateColumnId: z.string().min(1).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  dimensions: z.record(z.string(), z.string()).optional(),
});

export const dashboardNameSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  layout: z.record(z.string(), z.unknown()).optional(),
});

export const widgetSchema = z.object({
  type: z.enum(["KPI", "LINE", "BAR", "PIE", "TABLE"]),
  datasetId: z.string().min(1).optional(),
  config: z
    .object({
      title: z.string().min(1).max(120).optional(),
      metricKind: z
        .enum(["REVENUE", "ORDERS", "CUSTOMERS", "EXPENSES", "PROFIT", "INVENTORY"])
        .optional(),
      groupBy: z.string().min(1).optional(),
    })
    .optional(),
  position: z.record(z.string(), z.unknown()).optional(),
});

export const updateWidgetSchema = z.object({
  config: z
    .object({
      title: z.string().min(1).max(120).optional(),
      metricKind: z
        .enum(["REVENUE", "ORDERS", "CUSTOMERS", "EXPENSES", "PROFIT", "INVENTORY"])
        .optional(),
      groupBy: z.string().min(1).optional(),
    })
    .optional(),
  position: z.record(z.string(), z.unknown()).optional(),
});

export const dashboardPreviewSchema = z.object({
  filters: filtersSchema.optional(),
});

export type DashboardNameInput = z.infer<typeof dashboardNameSchema>;
export type WidgetInput = z.infer<typeof widgetSchema>;
export type UpdateWidgetInput = z.infer<typeof updateWidgetSchema>;
export type DashboardPreviewInput = z.infer<typeof dashboardPreviewSchema>;