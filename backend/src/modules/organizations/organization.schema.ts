import { z } from "zod";

export const updateOrganizationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Organization name is required")
    .max(100, "Organization name is too long"),
});

export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
