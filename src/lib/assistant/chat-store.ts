import 'server-only';
import { z } from 'zod';
import { adminClient } from '../supabase/server';
import { AssistantError } from './openai';
import { chatMessageSchema, chatResponseSchema } from './chat-schema';
export const chatStateSchema = z.object({
  revision: z.number().int().nonnegative(),
  messages: z.array(chatMessageSchema).max(40).default([]),
  response: chatResponseSchema.nullable().optional(),
  lease: z.string().uuid().optional(),
  replayed: z.boolean().optional(),
});
export async function chatStore(
  userId: string,
  action: 'load' | 'claim' | 'finish' | 'cancel' | 'clear',
  data: unknown = {},
) {
  const result = await adminClient().rpc('assistant_chat', {
    p_action: action,
    p_user_id: userId,
    p_data: data,
  });
  if (result.error) {
    const message = result.error.message || '';
    if (message.includes('assistant_security_not_ready'))
      throw new AssistantError(
        'Business chat security needs administrator verification. Existing records remain protected.',
        503,
      );
    if (['PGRST202', '42883'].includes(result.error.code || ''))
      throw new AssistantError(
        'Business chat needs migration 202611130001_assistant_conversations.sql. File import and existing records remain available.',
        503,
      );
    if (message.includes('rate_limit'))
      throw new AssistantError('Too many assistant turns. Wait a minute and try again.', 429);
    if (message.includes('context_changed'))
      throw new AssistantError(
        'This conversation changed on another device. Reload the chat and retry.',
        409,
      );
    if (message.includes('busy'))
      throw new AssistantError(
        'Another assistant turn is still running. Wait for it to finish.',
        409,
      );
    if (message.includes('workspace_access_denied')) throw new Error('Unauthorized');
    throw new AssistantError(
      'The conversation could not be confirmed. Your business records were not changed; reload and retry.',
      409,
    );
  }
  return action === 'cancel' ? null : chatStateSchema.parse(result.data);
}
