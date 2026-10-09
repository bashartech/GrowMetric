import { z } from "zod";

export const usageSchema = z.object({
  metric: z
    .string()
    .trim()
    .min(1, "Metric is required")
    .max(64, "Metric name is too long"),
  amount: z
    .number()
    .int("Amount must be a whole number")
    .positive("Amount must be greater than zero")
    .max(1000, "Amount is too large"),
});

export type UsageInput = z.infer<typeof usageSchema>;
