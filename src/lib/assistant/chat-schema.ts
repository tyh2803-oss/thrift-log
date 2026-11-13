import { z } from 'zod';
import { batchSchema } from './drafts';

export const chatMessageSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(['user', 'assistant']),
  text: z.string().max(6000),
  context: z.string().max(48000).optional(),
  fileIds: z.array(z.string().uuid()).max(10).optional(),
  files: z
    .array(
      z.object({ id: z.string().uuid(), name: z.string().max(200), mime: z.string().max(100) }),
    )
    .max(10)
    .optional(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export const chatContextSchema = z.object({
  batch: batchSchema.nullable().default(null),
  historyBatch: batchSchema.nullable().default(null),
});
export type ChatDrafts = z.infer<typeof chatContextSchema>;
export const chatAnswerSchema = z.strictObject({
  message: z.string().min(1).max(6000),
  choices: z
    .array(
      z.strictObject({
        itemId: z.string().uuid().nullable(),
        label: z.string().min(1).max(160),
        text: z.string().min(1).max(500),
      }),
    )
    .max(5),
});
export const chatResponseSchema = chatAnswerSchema.extend({
  drafts: chatContextSchema,
  model: z.string().max(100),
  workspaceRevision: z.number().int().nonnegative(),
  tools: z.array(z.string().max(100)).max(16),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
});
export type ChatResponse = z.infer<typeof chatResponseSchema>;
