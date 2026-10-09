import { z } from "zod";

export const anomalyStatusSchema = z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED"]);

export const listAnomaliesQuerySchema = z.object({
  status: anomalyStatusSchema.optional(),
  metricKind: z.string().optional(),
  period: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().default(50),
});

export type ListAnomaliesInput = z.infer<typeof listAnomaliesQuerySchema>;
export type AnomalyStatus = z.infer<typeof anomalyStatusSchema>;
