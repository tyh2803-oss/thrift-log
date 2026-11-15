import 'server-only';
import { adminClient } from '@/lib/supabase/server';
import { config, EbayError, errors } from './config';
import type { Checkpoint, ConnectionStatus, StoredRecord } from './schema';
export type Connection = {
  user_id: string;
  seller_id: string;
  username: string;
  environment: 'production' | 'sandbox';
  financials: boolean;
  token_ciphertext: string;
  version: string;
  lease: string;
  checkpoint: Checkpoint | Record<string, never>;
  last_sync: string | null;
  last_financial_sync: string | null;
  financial_error: string | null;
};
export async function ebayRpc<T>(
  action: string,
  userId: string | null,
  data: unknown = {},
): Promise<T> {
  const result = await adminClient().rpc('ebay_admin', {
    p_action: action,
    p_user_id: userId,
    p_data: data,
  });
  if (result.error) {
    const code = result.error.code,
      message = result.error.message || '';
    if (code === 'PGRST202' || code === '42883')
      throw new EbayError(
        'setup',
        'Apply the saved optional migration 202611150001_ebay_read_only.sql after approval. Existing records are unchanged.',
        503,
      );
    if (message.includes('workspace_access_denied')) throw new Error('Unauthorized');
    if (message.includes('invalid_oauth_state'))
      throw new EbayError(
        'state',
        'This eBay connection attempt expired or was already used. Start Connect eBay again.',
        400,
      );
    if (message.includes('oauth_rate_limit'))
      throw new EbayError('rate', 'Too many connection attempts. Try again in an hour.', 429);
    if (code === '23505' || message.includes('disconnect_before_switching'))
      throw new EbayError(
        'conflict',
        'This seller is already connected, or differs from this connection. Disconnect before switching accounts.',
        409,
      );
    if (/revision_conflict|stale_sync_lease|sync_busy/.test(message))
      throw new EbayError('conflict', errors.conflict, 409);
    throw new EbayError(
      'storage',
      'eBay connection storage could not confirm this action. Existing records are preserved.',
      503,
    );
  }
  return result.data as T;
}
export async function connectionStatus(id: string): Promise<ConnectionStatus> {
  let configured = false,
    setup = '';
  try {
    config();
    configured = true;
  } catch (e) {
    setup = e instanceof EbayError ? e.message : 'Check the eBay server configuration.';
  }
  try {
    return {
      ...(await ebayRpc<ConnectionStatus>('status', id)),
      configured,
      ...(!configured ? { setup } : {}),
    };
  } catch (e) {
    if (e instanceof EbayError && e.code === 'setup')
      return { ready: false, configured, connected: false, setup: e.message };
    throw e;
  }
}
export const readRecords = (id: string, query: Record<string, unknown>) =>
  ebayRpc<StoredRecord[]>('read', id, query).then((rows) => rows || []);
