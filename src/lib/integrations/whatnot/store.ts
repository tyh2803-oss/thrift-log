import 'server-only';
import { adminClient } from '@/lib/supabase/server';
import { WhatnotError } from './client';
import type { ConnectionStatus, SyncCursor, StoredRecord } from './schema';
export type Connection = {
  user_id: string;
  seller_id: string;
  username: string;
  token_ciphertext: string;
  webhook_ciphertext: string | null;
  webhook_id: string;
  version: string;
  lease: string;
  checkpoint: SyncCursor | Record<string, never>;
  last_sync: string | null;
};
export async function whatnotRpc<T>(
  action: string,
  userId: string | null,
  data: unknown = {},
): Promise<T> {
  const result = await adminClient().rpc('whatnot_admin', {
    p_action: action,
    p_user_id: userId,
    p_data: data,
  });
  if (result.error) {
    const code = result.error.code,
      message = result.error.message || '';
    if (code === 'PGRST202' || code === '42883')
      throw new WhatnotError(
        'setup',
        'Whatnot setup needs the saved migration 202611120001_whatnot_read_only.sql. Existing workspaces still work.',
        503,
      );
    if (
      message.includes('revision_conflict') ||
      message.includes('stale_sync_lease') ||
      message.includes('sync_busy')
    )
      throw new WhatnotError(
        'conflict',
        'Another save, sync or disconnect changed this connection. Refresh and retry.',
        409,
      );
    if (message.includes('workspace_access_denied')) throw new Error('Unauthorized');
    if (code === '23505' || message.includes('disconnect_before_switching'))
      throw new WhatnotError(
        'conflict',
        'This seller is already linked or differs from the connected account. Disconnect the old connection before switching.',
        409,
      );
    throw new WhatnotError(
      'storage',
      'The database did not confirm this Whatnot operation. Saved records and progress are preserved.',
      503,
    );
  }
  return result.data as T;
}
export async function connectionStatus(userId: string): Promise<ConnectionStatus> {
  try {
    return await whatnotRpc<ConnectionStatus>('status', userId);
  } catch (e) {
    if (e instanceof WhatnotError && e.code === 'setup')
      return { ready: false, connected: false, setup: e.message };
    throw e;
  }
}
export const readRecords = (userId: string, query: Record<string, unknown>) =>
  whatnotRpc<StoredRecord[]>('read', userId, query).then((rows) => rows || []);
