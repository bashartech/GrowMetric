import { z } from "zod";

export const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
});

export const conversationParamsSchema = z.object({
  id: z.string().uuid(),
});

export const createMessageSchema = z.object({
  content: z.string().trim().min(1).max(2000),
});

export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type CreateMessageInput = z.infer<typeof createMessageSchema>;