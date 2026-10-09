import { z } from 'zod';
import {
  RecommendationSeverity,
  RecommendationSource,
  RecommendationStatus,
} from '@prisma/client';

export const recommendationSchema = z.object({
  id: z.string().uuid(),
  severity: z.nativeEnum(RecommendationSeverity),
  source: z.nativeEnum(RecommendationSource),
  category: z.string(),
  title: z.string(),
  description: z.string(),
  evidence: z.string(),
  suggestedAction: z.string().optional(),
  status: z.nativeEnum(RecommendationStatus),
  organizationId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

/**
 * Query filters accepted on `GET /ai/recommendations`. `workspaceId` is
 * deliberately excluded: the controller resolves it from the tenant session and
 * only validates it once it is known to be a real UUID for this organization.
 */
export const recommendationFilterSchema = z.object({
  source: z.nativeEnum(RecommendationSource).optional(),
  severity: z.nativeEnum(RecommendationSeverity).optional(),
  status: z.nativeEnum(RecommendationStatus).optional(),
});

export const listRecommendationsSchema = recommendationFilterSchema.extend({
  workspaceId: z.string().uuid(),
});

export const updateRecommendationStatusSchema = z.object({
  status: z.nativeEnum(RecommendationStatus),
});

export type RecommendationFilterInput = z.infer<typeof recommendationFilterSchema>;
export type ListRecommendationsInput = z.infer<typeof listRecommendationsSchema>;
export type UpdateRecommendationStatusInput = z.infer<typeof updateRecommendationStatusSchema>;
