import { beforeEach, it, expect, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const m = vi.hoisted(() => ({ rpc: vi.fn(), read: vi.fn(), load: vi.fn() }));
vi.mock('../src/lib/integrations/whatnot/store', () => ({
  whatnotRpc: m.rpc,
  readRecords: m.read,
}));
vi.mock('../src/lib/supabase/workspace', () => ({ loadWorkspace: m.load }));
import { reviewWhatnotOrders } from '../src/lib/integrations/whatnot/review';
import { WhatnotPlan } from '../src/lib/integrations/whatnot/planner';
import { emptyWorkspace, type Workspace } from '../src/lib/model';
import { payloadHash } from '../src/lib/integrations/whatnot/crypto';
import { type StoredRecord } from '../src/lib/integrations/whatnot/schema';
import { whatnotSource, actor, sellerId } from './helpers/whatnot';
let w: Workspace, records: Map<string, StoredRecord>;
const row = (id: string): StoredRecord => {
  const source = whatnotSource(id, null);
  source.items[0].purchased_item!.title = 'Vintage clothing #7';
  const payload = { source, unitMap: {}, adopted: false };
  return {
    kind: 'order',
    external_id: id,
    payload,
    hash: payloadHash(payload),
    state: 'review',
    issue: 'Possible existing inventory: select a physical item or explicitly create a new one.',
    local_id: null,
    resolution: {},
  };
};
beforeEach(() => {
  vi.clearAllMocks();
  w = emptyWorkspace();
  records = new Map();
  m.load.mockImplementation(async () => structuredClone(w));
  m.read.mockImplementation(async (user, query) => {
    expect(user).toBe(actor);
    return [...records.values()].filter(
      (r) => r.kind === query.kind && (!query.ids || query.ids.includes(r.external_id)),
    );
  });
  m.rpc.mockImplementation(async (action, user, data) => {
    expect(user).toBe(actor);
    if (action === 'claim')
      return {
        user_id: actor,
        seller_id: sellerId,
        lease: crypto.randomUUID(),
        version: crypto.randomUUID(),
        checkpoint: { phase: 'orders', orders: ['999'] },
      };
    if (action === 'finish') {
      if (data.workspace) w = data.workspace;
      for (const record of data.records) records.set(record.external_id, record);
      return { hasMore: true };
    }
    return {};
  });
});
it('rechecks fifty same-name held orders without manual matching or provider calls, preserves unknown costs/fees and makes retries idempotent', async () => {
  const rows = Array.from({ length: 50 }, (_, i) => row(String(100000 + i)));
  rows.forEach((r) => records.set(r.external_id, r));
  const entries = rows.map((r) => ({ id: r.external_id, hash: r.hash, resolution: {} }));
  const result = await reviewWhatnotOrders(actor, entries);
  expect(result.applied).toHaveLength(50);
  expect(result.unresolved).toEqual([]);
  expect(w.items).toHaveLength(50);
  expect(w.orders).toHaveLength(50);
  expect(new Set(w.orders.map((o) => o.externalId)).size).toBe(50);
  expect(
    w.imports.every(
      (i) =>
        JSON.parse(i.rawCsv).unknownCostItemIds.length === 1 &&
        JSON.parse(i.rawCsv).whatnotFinancialsPending === true,
    ),
  ).toBe(true);
  const repeated = await reviewWhatnotOrders(actor, entries);
  expect(repeated.applied).toHaveLength(50);
  expect(w.items).toHaveLength(50);
  expect(w.orders).toHaveLength(50);
  expect(m.rpc.mock.calls.find((c) => c[0] === 'finish')![2].checkpoint).toMatchObject({
    phase: 'orders',
    orders: ['999'],
  });
});
it('saves valid rows and reports genuine accounting exceptions without partial physical items', async () => {
  const good = row('111111'),
    bad = row('222222');
  (bad.payload as { source: ReturnType<typeof whatnotSource> }).source.order.amounts.total.amount =
    '999.00';
  bad.hash = payloadHash(bad.payload);
  records.set(good.external_id, good);
  records.set(bad.external_id, bad);
  const result = await reviewWhatnotOrders(
    actor,
    [good, bad].map((r) => ({ id: r.external_id, hash: r.hash, resolution: {} })),
  );
  expect(result.applied).toEqual(['111111']);
  expect(result.unresolved?.[0]).toMatchObject({ id: '222222' });
  expect(result.unresolved?.[0].issue).toContain('reconcile');
  expect(w.items).toHaveLength(1);
  expect(records.get('222222')?.state).toBe('review');
});
it('applies explicit new-item costs including zero while rejecting foreign selections before a commit', async () => {
  const r = row('111111');
  records.set(r.external_id, r);
  const result = await reviewWhatnotOrders(actor, [
    {
      id: r.external_id,
      hash: r.hash,
      resolution: { units: { '9111111:0': { itemId: 'new', cost: 0 } } },
    },
  ]);
  expect(result.applied).toEqual(['111111']);
  expect(JSON.parse(w.imports[0].rawCsv).knownZeroItemIds).toHaveLength(1);
  const next = row('222222');
  records.set(next.external_id, next);
  m.rpc.mockClear();
  await expect(
    reviewWhatnotOrders(actor, [
      {
        id: next.external_id,
        hash: next.hash,
        resolution: { units: { '9222222:0': { itemId: crypto.randomUUID(), cost: 100 } } },
      },
    ]),
  ).rejects.toThrow('workspace');
  expect(m.rpc.mock.calls.some((c) => c[0] === 'finish')).toBe(false);
  expect(w.orders).toHaveLength(1);
});
it('retains work on stale source hashes, active sync leases and revoked commits', async () => {
  const r = row('111111');
  records.set(r.external_id, r);
  const stale = await reviewWhatnotOrders(actor, [
    { id: r.external_id, hash: 'f'.repeat(64), resolution: {} },
  ]);
  expect(stale.applied).toEqual([]);
  expect(stale.unresolved?.[0].issue).toContain('changed');
  expect(w.orders).toHaveLength(0);
  m.rpc.mockResolvedValueOnce(null);
  expect(
    (await reviewWhatnotOrders(actor, [{ id: r.external_id, hash: r.hash, resolution: {} }])).busy,
  ).toBe(true);
  m.rpc.mockImplementation(async (action) => {
    if (action === 'claim')
      return {
        seller_id: sellerId,
        lease: crypto.randomUUID(),
        version: crypto.randomUUID(),
        checkpoint: { phase: 'done' },
      };
    throw new Error('Unauthorized');
  });
  await expect(
    reviewWhatnotOrders(actor, [{ id: r.external_id, hash: r.hash, resolution: {} }]),
  ).rejects.toThrow('Unauthorized');
  expect(w.orders).toHaveLength(0);
});
it('imports a reused sold SKU as a separate provider unit without reopening or double-selling the old piece', () => {
  const original = new WhatnotPlan(actor, sellerId, emptyWorkspace());
  original.order(whatnotSource('111111', 'STYLE-1'));
  const first = original.w.orders[0].lines[0].itemId;
  original.w.items[0].sku = 'STYLE-1';
  const next = new WhatnotPlan(actor, sellerId, original.w, [...original.writes.values()]);
  next.order(whatnotSource('222222', 'STYLE-1'));
  expect(next.w.orders).toHaveLength(2);
  expect(next.w.items).toHaveLength(2);
  expect(next.w.orders[1].lines[0].itemId).not.toBe(first);
});
