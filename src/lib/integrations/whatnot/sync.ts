import 'server-only';
import { z } from 'zod';
import { loadWorkspace } from '@/lib/supabase/workspace';
import { WhatnotClient, WhatnotError, downloadReport, errorMessages } from './client';
import { unseal, payloadHash } from './crypto';
import { whatnotRpc, readRecords, type Connection } from './store';
import {
  sourceOrderSchema,
  sourceItemSchema,
  sourceShipmentSchema,
  sourceShowSchema,
  sourceReportSchema,
  analyticsSchema,
  type SyncCursor,
  type OrderSource,
} from './schema';
import { parseFinancialReport, type LedgerTransaction } from './reports';
import { WhatnotPlan } from './planner';
import { matchingNotice } from '@/lib/assistant/warnings';
const sourceSchema = z.object({
  order: sourceOrderSchema,
  items: z.array(sourceItemSchema).max(500),
  shipments: z.array(sourceShipmentSchema).max(500),
});
const states = ['scheduled', 'live', 'stopped', 'ended', 'cancelled'];
export async function runSync(userId: string, force = false) {
  const connection = await whatnotRpc<Connection | null>('claim', userId, { force });
  if (!connection) return { busy: true, hasMore: false, changed: false };
  try {
    let token: string;
    try {
      token = unseal(userId, connection.token_ciphertext);
    } catch {
      throw new WhatnotError('credential', errorMessages.credential, 401);
    }
    const client = new WhatnotClient(token),
      current = await loadWorkspace(userId),
      plan = new WhatnotPlan(userId, connection.seller_id, current);
    let checkpoint: SyncCursor =
      'phase' in connection.checkpoint && connection.checkpoint.phase !== 'done'
        ? (connection.checkpoint as SyncCursor)
        : { phase: 'reports', cursor: null };
    // Explicit review decisions are handled before the next provider page, using cached,
    // authenticated source facts and the latest tenant workspace. No user-supplied source data.
    const resolved = await readRecords(userId, { state: 'pending', resolved: true, limit: 3 });
    // Previously held similarity-only decisions no longer need human review. Re-run
    // cached owned source facts under the current planner; financial failures remain held.
    const held = resolved.length
      ? []
      : await readRecords(userId, { kind: 'order', state: 'review', limit: 200 });
    const matchingHolds = held.filter((row) => matchingNotice(row.issue)).slice(0, 20);
    const retry = resolved.length ? resolved : matchingHolds;
    if (retry.length) {
      plan.remember(retry);
      for (const record of retry) {
        if (record.kind === 'order') {
          const source = sourceSchema.parse((record.payload as { source: unknown }).source);
          plan.remember(
            await readRecords(userId, {
              kind: 'transaction',
              orderId: source.order.id,
              limit: 200,
            }),
          );
          plan.order(source);
        } else if (record.kind === 'transaction') {
          const tx = record.payload as LedgerTransaction;
          if (tx.orderId)
            plan.remember(
              await readRecords(userId, { kind: 'transaction', orderId: tx.orderId, limit: 200 }),
            );
          if (tx.type === 'ORDER_EARNINGS' && tx.orderId) {
            const orderRows = await readRecords(userId, { kind: 'order', ids: [tx.orderId] });
            plan.remember(orderRows);
            if (orderRows[0])
              plan.order(sourceSchema.parse((orderRows[0].payload as { source: unknown }).source));
            else plan.transaction(tx);
          } else plan.transaction(tx);
        }
      }
    } else if (checkpoint.phase === 'reports') {
      let pending = checkpoint.reports || [],
        cursor = checkpoint.cursor || null;
      if (!pending.length) {
        const page = await client.page('/reports', sourceReportSchema, cursor, {
          status: 'completed',
        });
        pending = page.data
          .filter((r) => r.report_type === 'seller_financial_report')
          .map((r) => r.id);
        cursor = page.next_cursor;
        if (!pending.length)
          checkpoint = cursor
            ? { phase: 'reports', cursor }
            : { phase: 'shows', showStatus: 0, cursor: null };
      }
      if (pending.length) {
        const id = pending[0],
          report = await client.get(`/reports/${id}`, sourceReportSchema);
        const safe = {
          id: report.id,
          report_type: report.report_type,
          status: report.status,
          created_at: report.created_at,
          updated_at: report.updated_at,
        };
        const old = (await readRecords(userId, { kind: 'report', ids: [id] }))[0];
        plan.remember(old ? [old] : []);
        if (old?.state === 'applied' && old.hash === payloadHash(safe)) {
          pending = pending.slice(1);
          checkpoint =
            pending.length || cursor
              ? { phase: 'reports', reports: pending, cursor, offset: 0 }
              : { phase: 'shows', showStatus: 0, cursor: null };
        } else {
          try {
            if (report.status !== 'completed' || !report.report_url)
              throw new Error(
                'This financial report is not ready. Generate it in Whatnot, then refresh.',
              );
            const transactions = parseFinancialReport(
                await downloadReport(report.report_url),
                connection.seller_id,
              ),
              offset = checkpoint.offset || 0,
              chunk = transactions.slice(offset, offset + 100);
            plan.remember(
              await readRecords(userId, {
                kind: 'transaction',
                ids: chunk.map((t) => t.id),
                limit: 200,
              }),
            );
            for (const tx of chunk) {
              const before = plan.record('transaction', tx.id);
              if (before?.hash === payloadHash(tx)) continue;
              const revised =
                before?.state === 'applied' ||
                (before?.payload as LedgerTransaction | undefined)?.revisionConflict
                  ? {
                      ...tx,
                      revisionConflict: true,
                      issue:
                        'Whatnot changed a previously imported ledger ID. Reconcile the original dated postings before accepting the revision.',
                    }
                  : tx;
              plan.save(
                'transaction',
                tx.id,
                revised,
                revised.issue ? 'review' : 'pending',
                revised.issue || '',
                before?.local_id || null,
                before?.resolution,
              );
            }
            if (offset + chunk.length < transactions.length)
              checkpoint = {
                phase: 'reports',
                reports: pending,
                cursor,
                offset: offset + chunk.length,
              };
            else {
              plan.save('report', id, safe, 'applied');
              pending = pending.slice(1);
              checkpoint =
                pending.length || cursor
                  ? { phase: 'reports', reports: pending, cursor, offset: 0 }
                  : { phase: 'shows', showStatus: 0, cursor: null };
            }
          } catch (e) {
            // Bad individual reports remain visible and do not block other source pages.
            plan.save(
              'report',
              id,
              safe,
              'review',
              e instanceof Error ? e.message.slice(0, 1000) : 'This financial report needs review.',
            );
            pending = pending.slice(1);
            checkpoint =
              pending.length || cursor
                ? { phase: 'reports', reports: pending, cursor, offset: 0 }
                : { phase: 'shows', showStatus: 0, cursor: null };
          }
        }
      }
    } else if (checkpoint.phase === 'shows') {
      const statusIndex = checkpoint.showStatus || 0;
      const page = await client.page('/shows', sourceShowSchema, checkpoint.cursor || null, {
        status: states[statusIndex],
      });
      plan.remember(await readRecords(userId, { kind: 'show', ids: page.data.map((s) => s.id) }));
      for (const source of page.data) {
        let analytics = null;
        if (source.status !== 'cancelled') {
          try {
            analytics = await client.get(`/analytics/shows/${source.id}`, analyticsSchema);
          } catch (e) {
            if (!(e instanceof WhatnotError) || !['not_found', 'response'].includes(e.code))
              throw e;
          }
        }
        if (analytics && analytics.show_id !== source.id)
          throw new WhatnotError('response', 'Whatnot returned analytics for a different show.');
        plan.show(source, analytics);
      }
      checkpoint = page.next_cursor
        ? { phase: 'shows', showStatus: statusIndex, cursor: page.next_cursor }
        : statusIndex < states.length - 1
          ? { phase: 'shows', showStatus: statusIndex + 1, cursor: null }
          : { phase: 'orders', cursor: null };
    } else if (checkpoint.phase === 'orders') {
      let pending = checkpoint.orders || [],
        cursor = checkpoint.cursor || null;
      const sources = new Map<string, z.infer<typeof sourceOrderSchema>>();
      if (!pending.length) {
        const page = await client.page('/orders', sourceOrderSchema, cursor);
        if (page.next_cursor && page.next_cursor === cursor)
          throw new WhatnotError('response', 'Whatnot repeated its order cursor.');
        pending = page.data.map((order) => order.id);
        cursor = page.next_cursor;
        for (const order of page.data) sources.set(order.id, order);
      }
      plan.remember(await readRecords(userId, { kind: 'order', ids: pending }));
      let processed = 0;
      while (pending.length && processed < 3) {
        const id = pending[0];
        try {
          const order = sources.get(id) || (await client.get(`/orders/${id}`, sourceOrderSchema));
          if (order.id !== id)
            throw new WhatnotError('response', 'Whatnot returned a different order.');
          const items = await client.all(`/orders/${order.id}/items`, sourceItemSchema);
          const shipmentIds = [
            ...new Set(items.flatMap((item) => (item.shipment_id ? [item.shipment_id] : []))),
          ];
          if (shipmentIds.length > 10)
            throw new WhatnotError(
              'response',
              'This order spans too many shipments for automatic import.',
            );
          const shipments = [];
          for (const shipmentId of shipmentIds) {
            const shipment = await client.get(`/shipments/${shipmentId}`, sourceShipmentSchema);
            if (shipment.id !== shipmentId)
              throw new WhatnotError('response', 'Whatnot returned a different shipment.');
            shipments.push(shipment);
            plan.save('shipment', shipmentId, shipment, 'applied');
          }
          const source: OrderSource = { order, items, shipments };
          plan.remember(
            await readRecords(userId, { kind: 'transaction', orderId: order.id, limit: 200 }),
          );
          plan.order(source);
          pending = pending.slice(1);
          processed++;
        } catch (e) {
          // Commit completed earlier orders and keep the unfinished IDs. No slow/erroring
          // last order can repeatedly roll back all progress on an otherwise valid page.
          if (
            processed &&
            e instanceof WhatnotError &&
            ['budget', 'rate', 'provider'].includes(e.code)
          )
            break;
          throw e;
        }
      }
      checkpoint =
        pending.length || cursor
          ? { phase: 'orders', orders: pending, cursor }
          : { phase: 'transactions' };
    } else if (checkpoint.phase === 'transactions') {
      const pending = await readRecords(userId, {
        kind: 'transaction',
        state: 'pending',
        limit: 50,
      });
      plan.remember(pending);
      for (const row of pending) plan.transaction(row.payload as LedgerTransaction);
      checkpoint = pending.length === 50 ? { phase: 'transactions' } : { phase: 'done' };
    }
    const result = await whatnotRpc<{ hasMore: boolean; revision: number }>('finish', userId, {
      lease: connection.lease,
      version: connection.version,
      revision: current.revision,
      workspace: plan.changed ? plan.w : null,
      records: [...plan.writes.values()],
      checkpoint,
      more: checkpoint.phase !== 'done' || matchingHolds.length > 0,
    });
    return {
      busy: false,
      hasMore: result.hasMore,
      changed: plan.changed,
      processed: plan.writes.size,
    };
  } catch (e) {
    const code = e instanceof WhatnotError ? e.code : 'provider';
    try {
      await whatnotRpc('error', userId, {
        lease: connection.lease,
        version: connection.version,
        code,
      });
    } catch {
      /* A disconnected or revoked account cannot commit, including its error state. */
    }
    if (e instanceof WhatnotError) throw e;
    if (e instanceof Error && e.message === 'Unauthorized') throw e;
    throw new WhatnotError(code, errorMessages[code] || errorMessages.provider);
  }
}
export async function backgroundSync(userId: string) {
  // Short continuations fit serverless execution; durable checkpoints survive interruption.
  for (let i = 0; i < 3; i++) {
    try {
      const result = await runSync(userId);
      if (!result.hasMore || result.busy) return;
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2100));
  }
}
