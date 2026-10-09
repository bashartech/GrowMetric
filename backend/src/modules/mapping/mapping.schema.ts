import { z } from "zod";

export const listMappingSuggestionsSchema = z.object({
  datasetId: z.string().uuid().optional(),
  importJobId: z.string().uuid().optional(),
  status: z.enum(["PENDING", "CONFIRMED", "REJECTED", "SKIPPED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

export const suggestionIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const batchSuggestionsSchema = z.object({
  importJobId: z.string().uuid(),
  decisions: z
    .array(
      z.object({
        suggestionId: z.string().uuid(),
        action: z.enum(["CONFIRM", "REJECT"]),
      }),
    )
    .min(1)
    .max(100),
});

export type ListMappingSuggestionsInput = z.infer<typeof listMappingSuggestionsSchema>;
export type SuggestionIdParams = z.infer<typeof suggestionIdParamsSchema>;
export type BatchSuggestionsInput = z.infer<typeof batchSuggestionsSchema>;