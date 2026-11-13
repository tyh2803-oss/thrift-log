import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), read: vi.fn(), load: vi.fn() }));
vi.mock('../src/lib/integrations/whatnot/store', () => ({
  whatnotRpc: mocks.rpc,
  readRecords: mocks.read,
}));
vi.mock('../src/lib/supabase/workspace', () => ({ loadWorkspace: mocks.load }));
import { runSync } from '../src/lib/integrations/whatnot/sync';
import { seal } from '../src/lib/integrations/whatnot/crypto';
import { WhatnotError } from '../src/lib/integrations/whatnot/client';
import { emptyWorkspace, type Workspace } from '../src/lib/model';
import type { StoredRecord, SyncCursor } from '../src/lib/integrations/whatnot/schema';
import {
  actor,
  sellerId,
  whatnotSource,
  whatnotShow,
  whatnotAnalytics,
  reportCsv,
} from './helpers/whatnot';
import { metrics } from '../src/lib/finance';
import { inventoryPipeline } from '../src/lib/pipeline';
let w: Workspace,
  checkpoint: SyncCursor | Record<string, never>,
  records: Map<string, StoredRecord>,
  connected: boolean;
const reportId = '88888888-8888-4888-8888-888888888888';
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'isolated-sync-test-key');
  w = emptyWorkspace();
  checkpoint = {};
  records = new Map();
  connected = true;
  mocks.load.mockImplementation(async () => structuredClone(w));
  mocks.rpc.mockImplementation(async (action, user, data) => {
    expect(user).toBe(actor);
    if (action === 'claim')
      return connected
        ? {
            user_id: actor,
            seller_id: sellerId,
            token_ciphertext: seal(actor, 'wn_pat_tk_test_sync_credential'),
            version: '77777777-7777-4777-8777-777777777777',
            lease: crypto.randomUUID(),
            checkpoint: structuredClone(checkpoint),
          }
        : null;
    if (action === 'finish') {
      if (!connected) throw new WhatnotError('conflict', 'Disconnected', 409);
      expect(data.revision).toBe(w.revision);
      expect(JSON.stringify(data)).not.toContain('wn_pat_tk');
      if (data.workspace) w = { ...data.workspace, revision: w.revision + 1 };
      for (const row of data.records) records.set(`${row.kind}:${row.external_id}`, row);
      checkpoint = data.checkpoint;
      return { revision: w.revision, hasMore: data.more };
    }
    return { saved: true };
  });
  mocks.read.mockImplementation(async (_user, query) =>
    [...records.values()]
      .filter(
        (row) =>
          (!query.kind || row.kind === query.kind) &&
          (!query.state || row.state === query.state) &&
          (!query.ids || query.ids.includes(row.external_id)) &&
          (!query.orderId || (row.payload as { orderId?: string }).orderId === query.orderId) &&
          (!query.resolved || Object.keys(row.resolution || {}).length),
      )
      .slice(0, query.limit || 100),
  );
  const order = whatnotSource('123456', 'SKU-NEW');
  order.order.show_id = whatnotShow.id;
  order.items[0].shipment_id = '555';
  const report = {
    id: reportId,
    report_type: 'seller_financial_report',
    status: 'completed',
    report_url:
      'https://storage.googleapis.com/whatnot-test/report.csv?signature=PRIVATE_SIGNED_URL',
    created_at: '2026-11-11T12:00:00Z',
    updated_at: '2026-11-11T12:00:00Z',
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input, init) => {
      expect(init?.method).toBe('GET');
      const url = new URL(input as string),
        path = url.pathname.replace('/seller-api/rest/v2', '');
      if (url.hostname === 'storage.googleapis.com') {
        expect(init?.headers).toBeUndefined();
        return new Response(reportCsv.replaceAll('JACKET-1', 'SKU-NEW'));
      }
      if (path === '/reports') return Response.json({ data: [report], next_cursor: null });
      if (path === `/reports/${reportId}`) return Response.json(report);
      if (path === '/shows')
        return Response.json({
          data: url.searchParams.get('status') === 'ended' ? [whatnotShow] : [],
          next_cursor: null,
        });
      if (path === `/analytics/shows/${whatnotShow.id}`) return Response.json(whatnotAnalytics);
      if (path === '/orders') return Response.json({ data: [order.order], next_cursor: null });
      if (path === '/orders/123456') return Response.json(order.order);
      if (path === '/orders/123456/items')
        return Response.json({ data: order.items, next_cursor: null });
      if (path === '/shipments/555')
        return Response.json({
          id: '555',
          status: 'in_transit',
          fulfillment_method: 'shipping',
          created_at: '2026-11-10T12:00:00Z',
          updated_at: '2026-11-11T12:00:00Z',
          tracking: { carrier: 'usps', service: 'ground', tracking_code: 'SYNTHETIC_TRACKING' },
          seller_paid_shipping_cost: { amount: '8.00', currency: 'USD' },
          replacement_shipment_id: null,
          recipient: { email: 'PRIVATE_CUSTOMER' },
        });
      throw new Error('Unexpected provider request');
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function cycle() {
  for (let n = 0; n < 30; n++) {
    const result = await runSync(actor, true);
    if (!result.hasMore) return;
  }
  throw new Error('Cycle did not finish');
}
it('resumes all resource phases, books verified facts through the existing planner, and finishes another cycle without duplicate inventory, sales, fees or payouts', async () => {
  await cycle();
  expect(w.orders).toHaveLength(1);
  expect(w.items).toHaveLength(1);
  expect(w.shows).toHaveLength(1);
  expect(w.financialEvents).toHaveLength(2);
  expect(w.payouts).toHaveLength(0);
  expect(metrics(w)).toMatchObject({ revenue: 4300, profit: 2475, fees: 525, profitKnown: true });
  expect(inventoryPipeline(w).groups.shipped.count).toBe(1);
  expect(JSON.stringify([...records.values()])).not.toMatch(
    /PRIVATE_SIGNED_URL|PRIVATE_CUSTOMER|PRIVATE_BUYER|wn_pat_tk/,
  );
  const saved = structuredClone(w);
  await cycle();
  expect(w.orders).toEqual(saved.orders);
  expect(w.items).toEqual(saved.items);
  expect(w.financialEvents).toEqual(saved.financialEvents);
  expect(w.shows).toEqual(saved.shows);
  expect(
    vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => new URL(url as string).hostname === 'storage.googleapis.com'),
  ).toHaveLength(1);
});
it('retains completed orders and an unfinished page queue when a later provider request fails', async () => {
  checkpoint = { phase: 'orders' };
  const first = whatnotSource('123456', null);
  first.items[0].purchased_item!.title = 'Unique fixture coat';
  const second = whatnotSource('123457', null);
  vi.mocked(fetch).mockImplementation(async (input) => {
    const path = new URL(input as string).pathname;
    if (path.endsWith('/orders'))
      return Response.json({ data: [first.order, second.order], next_cursor: null });
    if (path.endsWith('/orders/123456/items'))
      return Response.json({ data: first.items, next_cursor: null });
    throw new Error('Network disconnected; this unsafe provider error must not escape');
  });
  const result = await runSync(actor);
  expect(result.hasMore).toBe(true);
  expect(w.orders).toHaveLength(1);
  expect(checkpoint).toMatchObject({ phase: 'orders', orders: ['123457'] });
  expect(mocks.rpc.mock.calls.some(([action]) => action === 'error')).toBe(false);
});
it('cannot commit a previously fetched account snapshot after disconnect and preserves its old records', async () => {
  checkpoint = { phase: 'orders' };
  const original = structuredClone(w);
  const originalRpc = mocks.rpc.getMockImplementation()!;
  mocks.rpc.mockImplementation(async (action, ...args) => {
    if (action === 'finish') connected = false;
    return originalRpc(action, ...args);
  });
  await expect(runSync(actor, true)).rejects.toMatchObject({ code: 'conflict' });
  expect(w).toEqual(original);
  expect(records.size).toBe(0);
});
it('stages wrong-seller reports without importing their contents or leaking their signed download URLs', async () => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (input, options) =>
    new URL(input as string).hostname === 'storage.googleapis.com'
      ? new Response(reportCsv.replaceAll(sellerId, '7654321'))
      : original(input, options),
  );
  await runSync(actor, true);
  expect(w.orders).toHaveLength(0);
  expect([...records.values()].some((r) => r.kind === 'report' && r.state === 'review')).toBe(true);
  expect([...records.values()].filter((r) => r.kind === 'transaction')).toHaveLength(0);
  expect(JSON.stringify([...records.values()])).not.toContain('PRIVATE_SIGNED_URL');
});
