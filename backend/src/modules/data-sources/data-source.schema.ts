import { z } from "zod";

export const createFileSourceSchema = z.object({
  name: z.string().min(1, "Data source name is required").max(200),
});

export const createExternalDbSourceSchema = z.object({
  name: z.string().min(1, "Data source name is required").max(200),
  host: z.string().min(1, "Host is required"),
  port: z.number().int().positive().default(5432),
  database: z.string().min(1, "Database name is required"),
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
  sslMode: z.enum(["require", "prefer", "disable"]).default("require"),
});

export const updateDataSourceSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  status: z.enum(["NEW", "CONNECTED", "VALIDATED", "FAILED", "DISABLED"]).optional(),
});

export const updateTableSelectionSchema = z.object({
  tables: z.array(
    z.object({
      schemaName: z.string(),
      tableName: z.string(),
      isSelected: z.boolean(),
      syncMode: z.enum(["REPLACE", "UPSERT"]).optional(),
      upsertKeyColumnName: z.string().max(256).optional().nullable(),
    }),
  ),
});

export type CreateFileSourceInput = z.infer<typeof createFileSourceSchema>;
export type CreateExternalDbSourceInput = z.infer<typeof createExternalDbSourceSchema>;
export type UpdateDataSourceInput = z.infer<typeof updateDataSourceSchema>;
export type UpdateTableSelectionInput = z.infer<typeof updateTableSelectionSchema>;
