import { after } from 'next/server';
import { z } from 'zod';
import { randomBytes, createHash } from 'node:crypto';
import { requireUser, checkOrigin } from '@/lib/supabase/server';
import {
  config,
  EBAY_SCOPES,
  EBAY_FINANCE_SCOPE,
  EbayError,
  errors,
} from '@/lib/integrations/ebay/config';
import { connectionStatus, ebayRpc, readRecords } from '@/lib/integrations/ebay/store';
import { backgroundSync, runSync } from '@/lib/integrations/ebay/sync';
import { resolutionSchema } from '@/lib/integrations/ebay/schema';
import { json, failure, body } from '@/lib/integrations/ebay/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export async function GET(request: Request) {
  try {
    const user = await requireUser(request),
      status = await connectionStatus(user.id);
    return json({
      ...status,
      error: status.error ? errors[status.error] || errors.provider : null,
      financial_error: status.financial_error ? errors.finance : null,
      financeAvailable: process.env.EBAY_ENABLE_FINANCES === 'true',
      ...(new URL(request.url).searchParams.get('review') === '1' && status.connected
        ? { records: await readRecords(user.id, { state: 'review', limit: 100 }) }
        : {}),
    });
  } catch (e) {
    return failure(e);
  }
}
const input = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('connect'), financials: z.boolean().default(false) }),
  z.strictObject({ action: z.literal('disconnect') }),
  z.strictObject({ action: z.literal('sync'), automatic: z.boolean().optional() }),
  z.strictObject({
    action: z.literal('resolve'),
    kind: z.enum(['order', 'transaction', 'payout']),
    id: z.string().min(1).max(300),
    resolution: resolutionSchema,
  }),
]);
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser(request),
      data = input.parse(await body(request));
    if (data.action === 'connect') {
      const c = config();
      if (new URL(request.url).origin !== c.origin)
        throw new EbayError('origin', 'Connect eBay from the configured app URL.', 403);
      if (data.financials && !c.financeEnabled)
        throw new EbayError(
          'setup',
          'Enable eBay financial access in the app configuration after eBay approves its scope.',
          503,
        );
      const state = randomBytes(32).toString('base64url'),
        hash = createHash('sha256').update(state).digest('hex');
      await ebayRpc('begin_oauth', user.id, {
        state_hash: hash,
        financials: data.financials,
        environment: c.environment,
      });
      const url = new URL('/oauth2/authorize', c.auth);
      url.search = new URLSearchParams({
        client_id: c.clientId,
        redirect_uri: c.redirect,
        response_type: 'code',
        scope: [...EBAY_SCOPES, ...(data.financials ? [EBAY_FINANCE_SCOPE] : [])].join(' '),
        state,
      }).toString();
      const response = json({ url: url.href });
      response.cookies.set('__Host-thrift-ebay-state', state, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 600,
      });
      return response;
    }
    if (data.action === 'disconnect') {
      await ebayRpc('disconnect', user.id);
      return json(await connectionStatus(user.id));
    }
    if (data.action === 'resolve') {
      await ebayRpc('resolve', user.id, {
        kind: data.kind,
        id: data.id,
        resolution: data.resolution,
      });
      const result = await runSync(user.id, true);
      after(() => backgroundSync(user.id));
      return json({ ...result, status: await connectionStatus(user.id) });
    }
    const result = await runSync(user.id, !data.automatic);
    return json({ ...result, status: await connectionStatus(user.id) });
  } catch (e) {
    return failure(e);
  }
}
