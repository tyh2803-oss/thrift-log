import { after } from 'next/server';
import { z } from 'zod';
import { unseal, verifyWebhook } from '@/lib/integrations/whatnot/crypto';
import { whatnotRpc } from '@/lib/integrations/whatnot/store';
import { boundedText } from '@/lib/integrations/whatnot/client';
import { backgroundSync } from '@/lib/integrations/whatnot/sync';
import { json } from '@/lib/integrations/whatnot/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const supported = new Set([
  'orders.created',
  'orders.updated',
  'shows.created',
  'shows.updated',
  'shows.started',
  'shows.ended',
  'shows.cancelled',
  'shipments.created',
  'shipments.label_generated',
  'shipments.tracking_code_added',
  'shipments.parcel_updated',
  'shipments.items.added',
  'shipments.items.removed',
  'shipments.cancelled',
  'shipments.replaced',
]);
export async function POST(request: Request, context: { params: Promise<{ endpoint: string }> }) {
  try {
    const endpoint = z
      .string()
      .uuid()
      .parse((await context.params).endpoint);
    const connection = await whatnotRpc<{
      user_id: string;
      seller_id: string;
      webhook_ciphertext: string | null;
      version: string;
    } | null>('webhook_connection', null, { endpoint });
    if (!connection?.webhook_ciphertext) return json({ error: 'Unknown subscription' }, 404);
    const raw = await boundedText(new Response(request.body), 100000);
    if (
      !verifyWebhook(
        unseal(connection.user_id, connection.webhook_ciphertext, 'webhook'),
        raw,
        request.headers,
      )
    )
      return json({ error: 'Invalid webhook signature' }, 400);
    const event = z
      .object({
        type: z.string().max(200),
        version: z.string(),
        seller_id: z.string(),
        timestamp: z.iso.datetime({ offset: true }),
      })
      .parse(JSON.parse(raw));
    if (event.seller_id !== connection.seller_id)
      return json({ error: 'Invalid webhook seller' }, 400);
    if (event.version !== 'v2' || !supported.has(event.type))
      return json({ accepted: true, ignored: true });
    const result = await whatnotRpc<{ accepted: boolean }>('enqueue', connection.user_id, {
      endpoint,
      seller_id: event.seller_id,
      version: connection.version,
      event_id: request.headers.get('webhook-id'),
    });
    if (result.accepted) after(() => backgroundSync(connection.user_id));
    return json({ accepted: true });
  } catch {
    return json({ error: 'Webhook could not be accepted; delivery may be retried.' }, 503);
  }
}
