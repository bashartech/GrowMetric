import { z } from "zod";

export const updateDatasetSchema = z.object({
  name: z.string().min(1).max(200).optional(),
});

export const getDatasetRowsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const confirmMappingSchema = z.object({
  mappings: z
    .array(
      z.object({
        datasetColumnId: z.string().min(1),
        semanticKey: z.string().min(1).max(200),
        businessMeaning: z.string().min(1).max(200),
      }),
    )
    .min(1),
});

export const reimportSchema = z.object({
  commit: z.enum(["APPEND", "REPLACE", "UPSERT"]),
  upsertKey: z.string().min(1).max(200).optional(),
});

export type UpdateDatasetInput = z.infer<typeof updateDatasetSchema>;
export type GetDatasetRowsInput = z.infer<typeof getDatasetRowsSchema>;
export type ConfirmMappingInput = z.infer<typeof confirmMappingSchema>;
export type ReimportInput = z.infer<typeof reimportSchema>;
