import 'server-only';
import { z } from 'zod';
import { loadWorkspace } from '@/lib/supabase/workspace';
import { WhatnotPlan } from './planner';
import { whatnotRpc, readRecords, type Connection } from './store';
import {
  sourceOrderSchema,
  sourceItemSchema,
  sourceShipmentSchema,
  resolutionSchema,
  type StoredRecord,
} from './schema';
import { WhatnotError } from './client';
const sourceSchema = z.object({
  order: sourceOrderSchema,
  items: z.array(sourceItemSchema).max(500),
  shipments: z.array(sourceShipmentSchema).max(500),
});
export const reviewEntriesSchema = z
  .array(
    z.object({
      id: z.string().min(1).max(200),
      hash: z.string().length(64),
      resolution: resolutionSchema.default({}),
    }),
  )
  .min(1)
  .max(50);
export type ReviewEntries = z.infer<typeof reviewEntriesSchema>;
/** Cached source facts + current owned workspace; no marketplace writes or provider calls. */
export async function reviewWhatnotOrders(userId: string, entries: ReviewEntries) {
  if (new Set(entries.map((e) => e.id)).size !== entries.length)
    throw new WhatnotError('input', 'Choose each pending order once.', 400);
  const connection = await whatnotRpc<Connection | null>('claim', userId, { force: true });
  if (!connection) return { busy: true, changed: false, applied: [], unresolved: [] };
  try {
    const w = await loadWorkspace(userId),
      rows = await readRecords(userId, {
        kind: 'order',
        ids: entries.map((e) => e.id),
        limit: 200,
      });
    const records: StoredRecord[] = [],
      linked: StoredRecord[] = [];
    const unresolved: { id: string; issue: string }[] = [],
      applied: string[] = [];
    for (const entry of entries) {
      const row = rows.find((r) => r.external_id === entry.id);
      if (!row) throw new WhatnotError('input', 'Choose orders in this workspace.', 404);
      if (row.state === 'applied') {
        applied.push(entry.id);
        continue;
      }
      if (row.hash !== entry.hash || row.state !== 'review') {
        unresolved.push({ id: entry.id, issue: 'This order changed; refresh its review.' });
        continue;
      }
      const source = sourceSchema.parse((row.payload as { source: unknown }).source);
      const keys = new Set(
        source.items.flatMap((i) => Array.from({ length: i.quantity }, (_, n) => `${i.id}:${n}`)),
      );
      for (const [key, decision] of Object.entries(entry.resolution.units || {})) {
        if (
          !keys.has(key) ||
          (decision.itemId !== 'new' && !w.items.some((i) => i.id === decision.itemId))
        )
          throw new WhatnotError('input', 'Choose physical items in this workspace.', 400);
      }
      records.push({ ...row, resolution: { ...row.resolution, ...entry.resolution } });
    }
    // Bound concurrent local reads. All fees/refunds still pass the canonical planner.
    for (let start = 0; start < records.length; start += 5) {
      const groups = await Promise.all(
        records
          .slice(start, start + 5)
          .map((row) =>
            readRecords(userId, { kind: 'transaction', orderId: row.external_id, limit: 200 }),
          ),
      );
      for (const group of groups) linked.push(...group);
    }
    const plan = new WhatnotPlan(userId, connection.seller_id, w, [...records, ...linked]);
    for (const row of records) {
      plan.order(sourceSchema.parse((row.payload as { source: unknown }).source));
      const result = plan.record('order', row.external_id)!;
      if (result.state === 'applied') applied.push(row.external_id);
      else unresolved.push({ id: row.external_id, issue: result.issue });
    }
    if (plan.writes.size > 200)
      throw new WhatnotError(
        'input',
        'This batch has too many linked updates. Select fewer orders.',
        400,
      );
    const checkpoint = connection.checkpoint;
    const result = await whatnotRpc<{ hasMore: boolean }>('finish', userId, {
      lease: connection.lease,
      version: connection.version,
      revision: w.revision,
      workspace: plan.changed ? plan.w : null,
      records: [...plan.writes.values()],
      checkpoint,
      more: !('phase' in checkpoint) || checkpoint.phase !== 'done',
    });
    return { busy: false, changed: plan.changed, applied, unresolved, hasMore: result.hasMore };
  } catch (error) {
    try {
      await whatnotRpc('error', userId, {
        lease: connection.lease,
        version: connection.version,
        code: 'review',
      });
    } catch {
      /* Revoked/disconnected actors stay denied. */
    }
    throw error;
  }
}
