import { after } from 'next/server';
import { z } from 'zod';
import { requireUser, checkOrigin } from '@/lib/supabase/server';
import { WhatnotClient, WhatnotError } from '@/lib/integrations/whatnot/client';
import {
  sellerSchema,
  sourceOrderSchema,
  sourceShowSchema,
  sourceShipmentSchema,
  sourceReportSchema,
  resolutionSchema,
} from '@/lib/integrations/whatnot/schema';
import { seal, webhookKey } from '@/lib/integrations/whatnot/crypto';
import { connectionStatus, whatnotRpc, readRecords } from '@/lib/integrations/whatnot/store';
import { runSync, backgroundSync } from '@/lib/integrations/whatnot/sync';
import { json, failure, body, publicStatusError } from '@/lib/integrations/whatnot/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export async function GET(request: Request) {
  try {
    const user = await requireUser(request),
      status = await connectionStatus(user.id);
    const records =
      new URL(request.url).searchParams.get('review') === '1' && status.connected
        ? await readRecords(user.id, { state: 'review', limit: 50 })
        : undefined;
    return json({
      ...status,
      error: publicStatusError(status.error),
      ...(records ? { records } : {}),
    });
  } catch (e) {
    return failure(e);
  }
}
const input = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('connect'),
    token: z.string().regex(/^wn_pat_tk_[\x21-\x7e]{10,4096}$/),
    webhookSecret: z.string().max(1000).optional(),
  }),
  z.object({ action: z.literal('disconnect') }),
  z.object({ action: z.literal('sync'), automatic: z.boolean().optional() }),
  z.object({ action: z.literal('webhook'), secret: z.string().min(1).max(1000) }),
  z.object({
    action: z.literal('resolve'),
    kind: z.enum(['order', 'transaction']),
    id: z.string().min(1).max(200),
    resolution: resolutionSchema,
  }),
]);
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser(request);
    const data = input.parse(await body(request, 120000));
    if (data.action === 'connect') {
      if (data.webhookSecret) validateWebhookSecret(data.webhookSecret);
      const client = new WhatnotClient(data.token),
        seller = await client.get('/users/me', sellerSchema);
      if (seller.seller_currency !== 'USD')
        throw new WhatnotError(
          'currency',
          'This workspace supports USD. A different seller currency cannot be converted automatically.',
          400,
        );
      // Probe the exact four read capabilities; no write/customer scopes or app secrets are needed.
      await client.page('/orders', sourceOrderSchema);
      await client.page('/shows', sourceShowSchema);
      await client.page('/shipments', sourceShipmentSchema);
      await client.page('/reports', sourceReportSchema, null, { status: 'completed' });
      await whatnotRpc('connect', user.id, {
        seller_id: seller.id,
        username: seller.username,
        token_ciphertext: seal(user.id, data.token),
        webhook_ciphertext: data.webhookSecret
          ? seal(user.id, data.webhookSecret, 'webhook')
          : null,
      });
      after(() => backgroundSync(user.id));
      return json(await connectionStatus(user.id));
    }
    if (data.action === 'disconnect') {
      await whatnotRpc('disconnect', user.id);
      return json(await connectionStatus(user.id));
    }
    if (data.action === 'webhook') {
      validateWebhookSecret(data.secret);
      await whatnotRpc('webhook', user.id, { ciphertext: seal(user.id, data.secret, 'webhook') });
      return json(await connectionStatus(user.id));
    }
    if (data.action === 'resolve') {
      await whatnotRpc('resolve', user.id, {
        kind: data.kind,
        id: data.id,
        resolution: data.resolution,
      });
      const result = await runSync(user.id, true);
      return json({ ...result, status: await connectionStatus(user.id) });
    }
    const result = await runSync(user.id, !data.automatic);
    return json({ ...result, status: await connectionStatus(user.id) });
  } catch (e) {
    return failure(e);
  }
}

function validateWebhookSecret(value: string) {
  try {
    webhookKey(value);
  } catch {
    throw new WhatnotError(
      'input',
      'Use the signing secret from your Whatnot developer dashboard.',
      400,
    );
  }
}
