import 'server-only';
import { z } from 'zod';
import { loadWorkspace } from '@/lib/supabase/workspace';
import { config, EbayError, errors } from './config';
import { EbayClient, credentialsSchema, exchangeToken } from './client';
import { seal, unseal } from './crypto';
import { ebayRpc, readRecords, type Connection } from './store';
import {
  orderSourceSchema,
  transactionSourceSchema,
  payoutSourceSchema,
  shipmentSourceSchema,
  type Checkpoint,
  type OrderSource,
} from './schema';
import { EbayPlan } from './planner';
const DAY = 86400000;
const checkpointSchema = z.object({
  phase: z.enum(['orders', 'transactions', 'payouts', 'done']),
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  end: z.iso.datetime(),
  offset: z.number().int().min(0).max(9999),
  incremental: z.boolean(),
});
export function firstCheckpoint(lastSync: string | null, now = new Date()): Checkpoint {
  const end = now.toISOString(),
    start = lastSync
      ? new Date(Math.max(+now - 729 * DAY, Date.parse(lastSync) - 7 * DAY)).toISOString()
      : new Date(+now - 729 * DAY).toISOString();
  return {
    phase: 'orders',
    from: start,
    to: new Date(Math.min(+now, Date.parse(start) + 30 * DAY)).toISOString(),
    end,
    offset: 0,
    incremental: !!lastSync,
  };
}
function advance(c: Checkpoint, more: boolean, count: number, financials: boolean): Checkpoint {
  if (more) {
    if (!count) throw new EbayError('response', errors.response);
    if (c.offset + count >= 9000) {
      if (Date.parse(c.to) - Date.parse(c.from) < 1000)
        throw new EbayError(
          'response',
          'This second exceeds eBay pagination capacity. Contact support for a narrower historical import.',
        );
      return {
        ...c,
        to: new Date(Math.floor((Date.parse(c.from) + Date.parse(c.to)) / 2)).toISOString(),
        offset: 0,
      };
    }
    return { ...c, offset: c.offset + count };
  }
  if (c.to !== c.end) {
    const from = new Date(Date.parse(c.to) + 1).toISOString();
    return {
      ...c,
      from,
      to: new Date(Math.min(Date.parse(c.end), Date.parse(from) + 30 * DAY)).toISOString(),
      offset: 0,
    };
  }
  if (c.phase === 'orders' && financials) {
    const start = firstCheckpoint(c.incremental ? c.from : null, new Date(c.end));
    // For incremental runs use the original synchronization start retained by caller.
    return { ...c, phase: 'transactions', from: start.from, to: start.to, offset: 0 };
  }
  if (c.phase === 'transactions') {
    return { ...c, phase: 'payouts', offset: 0 };
  }
  return { ...c, phase: 'done', offset: 0 };
}
export async function runSync(userId: string, force = false) {
  const connection = await ebayRpc<Connection | null>('claim', userId, { force });
  if (!connection) return { busy: true, hasMore: false, changed: false };
  try {
    const cfg = config();
    if (cfg.environment !== connection.environment)
      throw new EbayError(
        'setup',
        'This account belongs to a different eBay environment. Restore its configuration or reconnect.',
        503,
      );
    let credentials;
    try {
      credentials = credentialsSchema.parse(
        JSON.parse(unseal(userId, connection.token_ciphertext)),
      );
    } catch {
      throw new EbayError('auth', errors.auth, 401);
    }
    let refreshed = false;
    if (credentials.expiresAt < Date.now() + 120000) {
      credentials = await exchangeToken({ credentials });
      refreshed = true;
    }
    const client = new EbayClient(credentials.accessToken, connection.environment),
      current = await loadWorkspace(userId),
      plan = new EbayPlan(userId, connection.seller_id, connection.environment, current);
    let checkpoint: Checkpoint = Object.keys(connection.checkpoint).length
      ? checkpointSchema.parse(connection.checkpoint)
      : firstCheckpoint(connection.last_sync);
    if (checkpoint.phase === 'done') checkpoint = firstCheckpoint(connection.last_sync);
    let financialError = connection.financial_error;
    const resolved = await readRecords(userId, { state: 'pending', resolved: true, limit: 3 });
    const rememberOrder = async (id: string) => {
      plan.remember(await readRecords(userId, { kind: 'order', ids: [id] }));
      plan.remember(await readRecords(userId, { kind: 'transaction', orderId: id, limit: 200 }));
    };
    if (resolved.length) {
      plan.remember(resolved);
      for (const r of resolved) {
        if (r.kind === 'order') {
          const payload = r.payload as { source: OrderSource; shipments: unknown[] };
          await rememberOrder(payload.source.orderId);
          plan.order(
            orderSourceSchema.parse(payload.source),
            z.array(shipmentSourceSchema).parse(payload.shipments),
          );
        } else if (r.kind === 'transaction') {
          const tx = transactionSourceSchema.parse(r.payload);
          if (tx.orderId) await rememberOrder(tx.orderId);
          plan.transaction(tx);
        } else {
          plan.payout(payoutSourceSchema.parse(r.payload));
        }
      }
    } else {
      const field =
        checkpoint.phase === 'orders'
          ? checkpoint.incremental
            ? 'lastmodifieddate'
            : 'creationdate'
          : checkpoint.phase === 'transactions'
            ? 'transactionDate'
            : 'payoutDate';
      const query = {
        filter: `${field}:[${checkpoint.from}..${checkpoint.to}]`,
        limit: checkpoint.phase === 'orders' ? '10' : '50',
        offset: String(checkpoint.offset),
      };
      const isOrders = checkpoint.phase === 'orders',
        key = isOrders
          ? 'orders'
          : checkpoint.phase === 'transactions'
            ? 'transactions'
            : 'payouts';
      let page: { rows: unknown[]; more: boolean };
      try {
        const raw = await client.get(
          isOrders
            ? '/sell/fulfillment/v1/order'
            : `/sell/finances/v1/${checkpoint.phase === 'transactions' ? 'transaction' : 'payout'}`,
          z.object({
            [key]: z.array(z.unknown()).max(50).default([]),
            next: z.string().max(10000).optional(),
            total: z.number().int().min(0).optional(),
          }),
          isOrders ? { ...query, fieldGroups: 'TAX_BREAKDOWN' } : query,
        );
        const rows = raw[key] as unknown[];
        page = {
          rows,
          more:
            !!raw.next ||
            (typeof raw.total === 'number' && raw.total > checkpoint.offset + rows.length),
        };
        if (!isOrders) financialError = null;
      } catch (e) {
        if (!isOrders && e instanceof EbayError && e.code === 'permissions') {
          financialError = 'finance';
          checkpoint = { ...checkpoint, phase: 'done' };
          page = { rows: [], more: false };
        } else throw e;
      }
      if (checkpoint.phase !== 'done') {
        for (const raw of page.rows) {
          if (isOrders) {
            const parsed = orderSourceSchema.safeParse(raw);
            if (!parsed.success)
              throw new EbayError(
                'response',
                'An eBay order has an unsupported shape. Progress is retained; no source rows are skipped.',
              );
            const source = parsed.data;
            await rememberOrder(source.orderId);
            const shipping =
              ['PAID', 'PARTIALLY_REFUNDED', 'FULLY_REFUNDED'].includes(
                source.orderPaymentStatus,
              ) && source.orderFulfillmentStatus !== 'NOT_STARTED'
                ? await client.get(
                    `/sell/fulfillment/v1/order/${encodeURIComponent(source.orderId)}/shipping_fulfillment`,
                    z.object({ fulfillments: z.array(shipmentSourceSchema).max(100).default([]) }),
                  )
                : null;
            plan.order(source, shipping?.fulfillments || []);
          } else if (checkpoint.phase === 'transactions') {
            const tx = transactionSourceSchema.parse(raw);
            if (tx.orderId) await rememberOrder(tx.orderId);
            plan.remember(
              await readRecords(userId, {
                kind: 'transaction',
                ids: [`${tx.transactionType}:${tx.transactionId}`],
              }),
            );
            plan.transaction(tx);
          } else {
            const payout = payoutSourceSchema.parse(raw);
            plan.remember(await readRecords(userId, { kind: 'payout', ids: [payout.payoutId] }));
            plan.remember(
              await readRecords(userId, {
                kind: 'transaction',
                payoutId: payout.payoutId,
                limit: 200,
              }),
            );
            plan.payout(payout);
          }
        }
        const before = checkpoint,
          next = advance(checkpoint, page.more, page.rows.length, connection.financials);
        // Each resource scans the same entire original date interval, not just the last page window.
        if (before.phase !== next.phase && next.phase !== 'done') {
          const root = firstCheckpoint(
            connection.last_financial_sync ?? null,
            new Date(before.end),
          );
          checkpoint = { ...next, from: root.from, to: root.to };
        } else checkpoint = next;
      }
    }
    const result = await ebayRpc<{ hasMore: boolean }>('finish', userId, {
      lease: connection.lease,
      version: connection.version,
      revision: current.revision,
      workspace: plan.changed ? plan.w : null,
      records: [...plan.writes.values()],
      checkpoint,
      more: checkpoint.phase !== 'done',
      financial_error: financialError,
      ...(refreshed ? { token_ciphertext: seal(userId, JSON.stringify(credentials)) } : {}),
    });
    return { ...result, changed: plan.changed };
  } catch (e) {
    try {
      await ebayRpc('error', userId, {
        lease: connection.lease,
        version: connection.version,
        code: e instanceof EbayError ? e.code : 'provider',
      });
    } catch {
      /* Stale leases cannot update a disconnected/revoked account. */
    }
    throw e;
  }
}
export async function backgroundSync(userId: string) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await runSync(userId);
      if (!r.hasMore || r.busy) return;
      await new Promise((resolve) => setTimeout(resolve, 2100));
    } catch {
      return;
    }
  }
}
