import { z } from "zod";

export const listImportsQuerySchema = z.object({
  status: z
    .enum(["QUEUED", "RUNNING", "REQUESTING_MAPPING", "COMPLETED", "FAILED"])
    .optional(),
  dataSourceId: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export type ListImportsQuery = z.infer<typeof listImportsQuerySchema>;