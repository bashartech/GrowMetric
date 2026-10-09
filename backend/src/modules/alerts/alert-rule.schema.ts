import { z } from "zod";
import { AlertCondition, AlertSeverity, AlertStatus, AlertRuleFrequency } from "@prisma/client";

// Alert Rule schemas
export const alertRuleSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  // E2: the user names their rule; the column is non-null.
  name: z.string().min(1).max(200),
  metricKind: z.string(),
  datasetId: z.string().uuid().optional(),
  condition: z.nativeEnum(AlertCondition),
  threshold: z.number(),
  frequency: z.nativeEnum(AlertRuleFrequency),
  // D4: matches the Prisma column name.
  cron: z.string().optional(),
  recipients: z.array(z.string().email()),
  enabled: z.boolean(),
  organizationId: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const createAlertRuleSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(200),
  metricKind: z.string(),
  datasetId: z.string().uuid().optional(),
  condition: z.nativeEnum(AlertCondition),
  threshold: z.number(),
  frequency: z.nativeEnum(AlertRuleFrequency),
  cron: z.string().optional(),
  recipients: z.array(z.string().email()),
});

export const updateAlertRuleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  metricKind: z.string().optional(),
  datasetId: z.string().uuid().nullable().optional(),
  condition: z.nativeEnum(AlertCondition).optional(),
  threshold: z.number().optional(),
  frequency: z.nativeEnum(AlertRuleFrequency).optional(),
  cron: z.string().optional(),
  recipients: z.array(z.string().email()).optional(),
  enabled: z.boolean().optional(),
});

// Alert schemas
export const alertSchema = z.object({
  id: z.string().uuid(),
  ruleId: z.string().uuid(),
  title: z.string(),
  severity: z.nativeEnum(AlertSeverity),
  message: z.string(),
  evidence: z.string(),
  status: z.nativeEnum(AlertStatus),
  organizationId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const updateAlertStatusSchema = z.object({
  status: z.nativeEnum(AlertStatus),
});

export type AlertRuleDTO = z.infer<typeof alertRuleSchema>;
export type CreateAlertRuleInput = z.infer<typeof createAlertRuleSchema>;
export type UpdateAlertRuleInput = z.infer<typeof updateAlertRuleSchema>;
export type AlertDTO = z.infer<typeof alertSchema>;
export type UpdateAlertStatusInput = z.infer<typeof updateAlertStatusSchema>;
