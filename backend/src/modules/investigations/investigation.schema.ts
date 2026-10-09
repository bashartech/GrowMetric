import { z } from "zod";

export const periodPresetSchema = z.enum([
  "LAST_3_MONTHS",
  "LAST_6_MONTHS",
  "LAST_12_MONTHS",
]);

export const createInvestigationSchema = z.object({
  title: z.string().trim().min(1).max(200),
  question: z.string().trim().min(1).max(2000),
  topic: z.string().trim().min(1).max(100),
  datasetId: z.string().uuid().optional(),
  periodPreset: periodPresetSchema.optional(),
  periodTarget: z
    .object({
      from: z.string().min(1),
      to: z.string().min(1),
    })
    .optional(),
  periodBaseline: z
    .object({
      from: z.string().min(1),
      to: z.string().min(1),
    })
    .optional(),
});

export const investigationParamsSchema = z.object({
  id: z.string().uuid(),
});

export type CreateInvestigationInput = z.infer<typeof createInvestigationSchema>;