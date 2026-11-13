import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
vi.mock('server-only', () => ({}));
import { createHmac } from 'node:crypto';
import {
  seal,
  unseal,
  stableId,
  verifyWebhook,
  payloadHash,
} from '../src/lib/integrations/whatnot/crypto';
import {
  WhatnotClient,
  downloadReport,
  reportDownloadAllowed,
} from '../src/lib/integrations/whatnot/client';
import {
  sourceOrderSchema,
  sourceItemSchema,
  sourceShipmentSchema,
  sellerSchema,
  pageSchema,
  type StoredRecord,
} from '../src/lib/integrations/whatnot/schema';
import { WhatnotPlan } from '../src/lib/integrations/whatnot/planner';
import {
  parseFinancialReport,
  type LedgerTransaction,
} from '../src/lib/integrations/whatnot/reports';
import { emptyWorkspace } from '../src/lib/model';
import { metrics } from '../src/lib/finance';
import { currentOrderTotals, ledgerExportRows } from '../src/lib/ledger';
import { inventoryPipeline } from '../src/lib/pipeline';
import { assistantWorkspace } from './helpers/assistant';
import {
  actor,
  sellerId,
  whatnotSource,
  whatnotEarnings,
  whatnotShow,
  whatnotAnalytics,
  reportCsv,
} from './helpers/whatnot';
beforeEach(() =>
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-server-key-for-isolated-whatnot-tests'),
);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const response = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const txRecord = (
  tx = whatnotEarnings(),
  state: StoredRecord['state'] = 'pending',
): StoredRecord => ({
  kind: 'transaction',
  external_id: tx.id,
  payload: tx,
  state,
  hash: payloadHash(tx),
  issue: '',
  local_id: null,
  resolution: {},
});
it('encrypts randomized credentials with tenant/purpose authentication and supports a separate stable encryption key', () => {
  const a = seal(actor, 'wn_pat_tk_example_token'),
    b = seal(actor, 'wn_pat_tk_example_token');
  expect(a).not.toBe(b);
  expect(a).not.toContain('example_token');
  expect(unseal(actor, a)).toBe('wn_pat_tk_example_token');
  expect(() => unseal(crypto.randomUUID(), a)).toThrow('Reconnect');
  expect(() => unseal(actor, a, 'webhook')).toThrow('Reconnect');
  vi.stubEnv('WHATNOT_TOKEN_ENCRYPTION_KEY', 'ab'.repeat(32));
  const stable = seal(actor, 'secret');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'rotated-test-key');
  expect(unseal(actor, stable)).toBe('secret');
  expect(stableId(actor, sellerId, 'order', '1')).toBe(stableId(actor, sellerId, 'order', '1'));
});
it('uses only allowlisted documented GET endpoints, cursor pagination and a fixed bearer destination', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response({ data: [whatnotSource().items[0]], next_cursor: 'next' }))
    .mockResolvedValueOnce(response({ data: [], next_cursor: null }));
  const client = new WhatnotClient('wn_pat_tk_test_credential', fetcher, async () => {});
  expect(await client.all('/orders/123456/items', sourceItemSchema)).toHaveLength(1);
  expect(String(fetcher.mock.calls[1][0])).toContain('cursor=next');
  expect(String(fetcher.mock.calls[0][0])).toContain('limit=50');
  for (const [url, options] of fetcher.mock.calls) {
    expect(new URL(url).origin).toBe('https://api.whatnot.com');
    expect(options.method).toBe('GET');
    expect(options.redirect).toBe('error');
    expect(options.headers.Authorization).toBe('Bearer wn_pat_tk_test_credential');
  }
  await expect(client.get('/orders/123456/cancel', z.unknown())).rejects.toThrow('read-only');
  await expect(client.get('https://attacker.test', z.unknown())).rejects.toThrow('read-only');
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('respects retry-after, stops expired/insufficient tokens and rejects malformed or cycling responses', async () => {
  const waits: number[] = [],
    fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({}, 429, { 'retry-after': '1' }))
      .mockResolvedValueOnce(response({ data: [], next_cursor: null }));
  await new WhatnotClient('token', fetcher, async (ms) => {
    waits.push(ms);
  }).page('/orders', sourceOrderSchema);
  expect(waits.some((ms) => ms >= 1000)).toBe(true);
  for (const status of [401, 403]) {
    const f = vi.fn().mockResolvedValue(response({ private: 'DO_NOT_ECHO' }, status));
    await expect(
      new WhatnotClient('token', f, async () => {}).get('/users/me', sellerSchema),
    ).rejects.toMatchObject({ code: status === 401 ? 'auth' : 'scope' });
    expect(f).toHaveBeenCalledTimes(1);
  }
  const f = vi.fn().mockImplementation(async () => response({ data: [], next_cursor: 'repeat' }));
  await expect(
    new WhatnotClient('token', f, async () => {}).all('/orders/123456/items', sourceItemSchema),
  ).rejects.toThrow('cursor');
  await expect(
    new WhatnotClient(
      'token',
      vi.fn().mockResolvedValue(response({ data: 'wrong', next_cursor: null })),
      async () => {},
    ).page('/orders', sourceOrderSchema),
  ).rejects.toThrow('unsupported response');
});
it('does not forward credentials to report downloads or follow arbitrary/private URLs', async () => {
  for (const url of [
    'http://storage.googleapis.com/bucket/report',
    'https://127.0.0.1/report',
    'https://storage.googleapis.com.evil.test/report',
    'https://user:secret@storage.googleapis.com/x',
    'https://localhost/x',
    'https://api.whatnot.com/seller-api/rest/v2/users/me',
  ])
    expect(reportDownloadAllowed(url), url).toBe(false);
  const fetcher = vi.fn().mockResolvedValue(new Response(reportCsv));
  await downloadReport('https://storage.googleapis.com/test/report?signature=private', fetcher);
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    method: 'GET',
    redirect: 'error',
    cache: 'no-store',
  });
  expect(fetcher.mock.calls[0][1]).not.toHaveProperty('headers');
  await expect(downloadReport('https://internal.test/secret', fetcher)).rejects.toThrow(
    'unrecognized',
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('strips customer data from official DTOs and recognizes documented pagination', () => {
  expect(
    sourceOrderSchema.parse({ ...whatnotSource().order, buyer: { email: 'PRIVATE_CUSTOMER' } }),
  ).not.toHaveProperty('buyer');
  expect(
    pageSchema(sourceItemSchema).parse({ data: whatnotSource().items, next_cursor: null }).data,
  ).toHaveLength(1);
});
it('parses verified financial columns, excludes buyer data, deduplicates ledger IDs and rejects wrong-seller or inconsistent reports', () => {
  const rows = parseFinancialReport(reportCsv, sellerId);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toEqual(whatnotEarnings());
  expect(JSON.stringify(rows)).not.toContain('PRIVATE_BUYER');
  expect(parseFinancialReport(reportCsv + '\n' + reportCsv.split('\n')[1], sellerId)).toHaveLength(
    1,
  );
  expect(() => parseFinancialReport(reportCsv, '7654321')).toThrow('different');
  expect(
    parseFinancialReport(reportCsv.replace(',36.75,', ',40.00,'), sellerId)[0].issue,
  ).toContain('reconcile');
});
it('imports a matched physical item once, posts actual seller fees/shipping once on their ledger date, and never treats buyer shipping/tax as proceeds or earnings as payouts', () => {
  const initial = assistantWorkspace(),
    plan = new WhatnotPlan(actor, sellerId, initial, [txRecord()]);
  plan.order(whatnotSource());
  expect(plan.w.items).toHaveLength(1);
  expect(plan.w.orders).toHaveLength(1);
  expect(plan.w.orders[0]).toMatchObject({
    externalId: '123456',
    discount: 200,
    shippingCollected: 0,
    payout: 'Pending',
  });
  expect(plan.w.orders[0].lines[0]).toMatchObject({ price: 4500, costBasis: 1200 });
  expect(plan.w.financialEvents).toHaveLength(2);
  expect(metrics(plan.w)).toMatchObject({
    revenue: 4300,
    fees: 525,
    profit: 2475,
    profitKnown: true,
  });
  expect(plan.w.payouts).toHaveLength(0);
  expect(metrics(plan.w, Date.parse('2026-11-10'), Date.parse('2026-11-10T23:59:59Z')).fees).toBe(
    0,
  );
  expect(plan.w.listings.map((l) => l.status)).toEqual(['Needs delisting', 'Needs delisting']);
  const saved = structuredClone(plan.w),
    second = new WhatnotPlan(actor, sellerId, saved, [...plan.writes.values()]);
  second.order(whatnotSource());
  expect(second.w.orders).toEqual(saved.orders);
  expect(second.w.financialEvents).toEqual(saved.financialEvents);
  expect(second.w.items).toEqual(saved.items);
});
it('marks missing seller financials incomplete even when purchase cost is known, then completes them from a verified report', () => {
  const first = new WhatnotPlan(actor, sellerId, assistantWorkspace());
  first.order(whatnotSource());
  expect(first.w.orders).toHaveLength(1);
  expect(metrics(first.w)).toMatchObject({
    revenue: 4300,
    unknownCosts: 0,
    unknownFinancials: 1,
    profitKnown: false,
    hourly: null,
  });
  expect(currentOrderTotals(first.w, first.w.orders[0]).profitKnown).toBe(false);
  expect(inventoryPipeline(first.w).groups.sold.entries[0]).toMatchObject({
    cost: 1200,
    saleValue: 4300,
    profit: null,
  });
  expect(ledgerExportRows(first.w)[0].operating_profit).toBe('');
  const next = new WhatnotPlan(actor, sellerId, first.w, [...first.writes.values(), txRecord()]);
  next.order(whatnotSource());
  expect(metrics(next.w).profitKnown).toBe(true);
  expect(metrics(next.w).profit).toBe(2475);
});
it('creates only unmatched physical units with durable unknown-cost/date proofs and preserves explicit zero', () => {
  const source = whatnotSource('123456', null);
  source.items[0].purchased_item!.title = 'Unique unmatched coat';
  const plan = new WhatnotPlan(actor, sellerId, emptyWorkspace());
  plan.order(source);
  expect(plan.w.items).toHaveLength(1);
  expect(metrics(plan.w).unknownCosts).toBe(1);
  expect(JSON.parse(plan.w.imports[0].rawCsv).assumedAcquisitionItemIds).toEqual([
    plan.w.items[0].id,
  ]);
  const decision = {
    ...txRecord(),
    kind: 'order' as const,
    external_id: source.order.id,
    payload: { source },
    resolution: { units: { '9123456:0': { itemId: 'new' as const, cost: 0 } } },
  };
  const free = new WhatnotPlan(actor, sellerId, emptyWorkspace(), [decision]);
  free.order(source);
  expect(metrics(free.w).unknownCosts).toBe(0);
  expect(JSON.parse(free.w.imports[0].rawCsv).knownZeroItemIds).toHaveLength(1);
});
it('queues similar/ambiguous inventory, resolves owned selections, and rejects foreign IDs without partial items or sales', () => {
  const source = whatnotSource('123456', null),
    initial = assistantWorkspace();
  const plan = new WhatnotPlan(actor, sellerId, initial);
  plan.order(source);
  expect(plan.w).toEqual(initial);
  expect(plan.record('order', '123456')?.state).toBe('review');
  const row = plan.record('order', '123456')!;
  row.resolution = { units: { '9123456:0': { itemId: initial.items[0].id } } };
  const next = new WhatnotPlan(actor, sellerId, initial, [row]);
  next.order(source);
  expect(next.w.items).toHaveLength(1);
  expect(next.w.orders).toHaveLength(1);
  row.resolution = { units: { '9123456:0': { itemId: crypto.randomUUID() } } };
  const denied = new WhatnotPlan(actor, sellerId, initial, [row]);
  denied.order(source);
  expect(denied.w).toEqual(initial);
  expect(denied.record('order', '123456')?.issue).toContain('workspace');
});
it('does not invent completed sales from pending/failed/cancelled orders or overwrite conflicting saved transactions', () => {
  for (const status of ['pending', 'failed', 'cancelled'] as const) {
    const source = whatnotSource();
    source.order.status = status;
    const plan = new WhatnotPlan(actor, sellerId, assistantWorkspace());
    plan.order(source);
    expect(plan.w.orders).toHaveLength(0);
  }
  const original = new WhatnotPlan(actor, sellerId, assistantWorkspace());
  original.order(whatnotSource());
  const modified = whatnotSource();
  modified.items[0].unit_price.amount = '60.00';
  const plan = new WhatnotPlan(actor, sellerId, original.w, [...original.writes.values()]);
  plan.order(modified);
  expect(plan.w.orders).toEqual(original.w.orders);
  expect(plan.record('order', '123456')?.state).toBe('review');
});
it('imports verified show dates, real duration and platform analytics without posting estimated earnings', () => {
  const plan = new WhatnotPlan(actor, sellerId, emptyWorkspace());
  plan.show(whatnotShow, whatnotAnalytics);
  expect(plan.w.shows[0]).toMatchObject({
    externalId: whatnotShow.id,
    status: 'Ended',
    date: whatnotAnalytics.start_time,
    durationMinutes: 59,
  });
  expect(plan.w.orders).toHaveLength(0);
  expect(metrics(plan.w).revenue).toBe(0);
  const source = whatnotSource('123456', null);
  source.order.show_id = whatnotShow.id;
  source.items[0].purchased_item!.title = 'Unique show coat';
  plan.order(source);
  expect(plan.w.orders[0].showId).toBe(plan.w.shows[0].id);
  plan.show(whatnotShow, { ...whatnotAnalytics, stream_minutes: 1500 });
  expect(plan.w.shows[0].durationMinutes).toBe(59);
  expect(
    (plan.record('show', whatnotShow.id)?.payload as { analytics: { stream_minutes: number } })
      .analytics.stream_minutes,
  ).toBe(1500);
  plan.show({ ...whatnotShow, status: 'cancelled' }, null);
  expect(plan.record('show', whatnotShow.id)?.state).toBe('ignored');
  expect(plan.w.shows[0].status).toBe('Ended');
  const cancelled = new WhatnotPlan(actor, sellerId, emptyWorkspace());
  cancelled.show({ ...whatnotShow, status: 'cancelled' }, null);
  expect(cancelled.w.shows[0]).toMatchObject({
    status: 'Ended',
    durationMinutes: 0,
    externalId: whatnotShow.id,
  });
  expect(cancelled.w.shows[0].notes).toContain('scheduled start');
  const history = whatnotSource('123456', null);
  history.order.show_id = whatnotShow.id;
  cancelled.order(history);
  expect(cancelled.w.orders).toHaveLength(1);
});
it('uses actual shipping states without inferring label-created handover, duplicating shared label costs or erasing known fulfillment dates', () => {
  const source = whatnotSource();
  source.items[0].shipment_id = '555';
  const shipment = sourceShipmentSchema.parse({
    id: '555',
    status: 'label_generated',
    fulfillment_method: 'shipping',
    created_at: '2026-11-10T12:00:00Z',
    updated_at: '2026-11-10T12:01:00Z',
    tracking: null,
    seller_paid_shipping_cost: { amount: '5.99', currency: 'USD' },
    replacement_shipment_id: null,
  });
  source.shipments = [shipment];
  const plan = new WhatnotPlan(actor, sellerId, assistantWorkspace());
  plan.order(source);
  expect(plan.w.orders[0].fulfillment).toBe('Unfulfilled');
  expect(plan.w.orders[0].shipping).toBe(0);
  source.shipments[0].status = 'in_transit';
  plan.order(source);
  expect(plan.w.orders[0].fulfillment).toBe('Shipped');
  expect(plan.w.orders[0].itemFulfillments![0].date).toBeNull();
  plan.w.orders[0].itemFulfillments![0].date = '2026-11-11T12:00:00Z';
  source.shipments[0].status = 'label_generated';
  plan.order(source);
  expect(plan.w.orders[0].fulfillment).toBe('Shipped');
  expect(plan.w.orders[0].itemFulfillments![0].date).toBe('2026-11-11T12:00:00Z');
});
it('imports net refund activity for explicit gross/fee reconciliation, posts exactly once, and never assumes a physical return', () => {
  const plan = new WhatnotPlan(actor, sellerId, assistantWorkspace(), [txRecord()]);
  plan.order(whatnotSource());
  const refund: LedgerTransaction = {
    id: 'refund-1',
    sellerId,
    orderId: '123456',
    showId: null,
    type: 'ORDER_REFUND',
    date: '2026-11-12T12:00:00Z',
    currency: 'USD',
    amount: -3775,
  };
  plan.transaction(refund);
  expect(plan.record('transaction', 'refund-1')?.state).toBe('review');
  expect(plan.w.financialEvents).toHaveLength(2);
  const row = plan.record('transaction', 'refund-1')!;
  row.resolution = { refund: { amount: 4300, feeCredit: 525, shippingAdjustment: 0 } };
  plan.remember([row]);
  plan.transaction(refund);
  expect(metrics(plan.w)).toMatchObject({ revenue: 0, fees: 0, profit: -1300 });
  expect(plan.w.items[0].status).toBe('Sold');
  expect(plan.w.financialEvents).toHaveLength(4);
  plan.transaction(refund);
  expect(plan.w.financialEvents).toHaveLength(4);
  const cancelled = whatnotSource();
  cancelled.order.status = 'cancelled';
  plan.order(cancelled);
  expect(plan.record('order', '123456')?.state).toBe('applied');
  expect(metrics(plan.w).profitKnown).toBe(true);
  expect(metrics(plan.w).revenue).toBe(0);
});
it('rolls back all staged commands and posting markers when one component of an order fails', () => {
  const tx = whatnotEarnings();
  tx.date = '2026-11-01T12:00:00Z';
  const plan = new WhatnotPlan(actor, sellerId, assistantWorkspace(), [txRecord(tx)]);
  const original = structuredClone(plan.w);
  plan.order(whatnotSource());
  expect(plan.w).toEqual(original);
  expect(plan.record('transaction', tx.id)?.state).toBe('pending');
  expect(plan.record('order', '123456')?.state).toBe('review');
});
it('verifies Standard Webhooks raw-byte HMAC, prefixes, timestamps, rotated signatures and tampering', () => {
  const secret = 'wn_wh_' + Buffer.alloc(32, 7).toString('base64'),
    time = String(Math.floor(Date.now() / 1000)),
    id = crypto.randomUUID(),
    raw = '{"type":"orders.created"}';
  const signature = createHmac('sha256', Buffer.alloc(32, 7))
    .update(`${id}.${time}.${raw}`)
    .digest('base64');
  const headers = new Headers({
    'webhook-id': id,
    'webhook-timestamp': time,
    'webhook-signature': `v2,ignored v1,${signature}`,
  });
  expect(verifyWebhook(secret, raw, headers)).toBe(true);
  expect(verifyWebhook(secret, raw + ' ', headers)).toBe(false);
  expect(verifyWebhook(secret, raw, headers, Date.now() + 301000)).toBe(false);
  expect(verifyWebhook('wn_wh_' + Buffer.alloc(32, 8).toString('base64'), raw, headers)).toBe(
    false,
  );
});

it('reconciles an incomplete financial report from explicit user-entered fees without rewriting its source facts', () => {
  const tx = whatnotEarnings();
  delete tx.earnings;
  tx.issue = 'Missing fee breakdown';
  const first = new WhatnotPlan(actor, sellerId, assistantWorkspace(), [txRecord(tx)]);
  first.order(whatnotSource());
  const record = first.record('transaction', tx.id)!;
  record.resolution = { earnings: { fees: 400, processing: 125, shipping: 100 } };
  const next = new WhatnotPlan(actor, sellerId, first.w, [
    ...Array.from(first.writes.values()).filter((r) => r.kind !== 'transaction'),
    record,
  ]);
  next.order(whatnotSource());
  expect(metrics(next.w)).toMatchObject({ profit: 2475, profitKnown: true });
  expect((next.record('transaction', tx.id)!.payload as typeof tx).issue).toBe(
    'Missing fee breakdown',
  );
});
it('refuses changed already-posted ledger amounts rather than silently accepting or double-posting them', () => {
  const first = new WhatnotPlan(actor, sellerId, assistantWorkspace(), [txRecord()]);
  first.order(whatnotSource());
  const tx = whatnotEarnings();
  tx.earnings!.fees += 100;
  tx.amount -= 100;
  const next = new WhatnotPlan(actor, sellerId, first.w, [
    ...Array.from(first.writes.values()).filter((r) => r.kind !== 'transaction'),
    txRecord(tx),
  ]);
  next.order(whatnotSource());
  expect(next.w.financialEvents).toEqual(first.w.financialEvents);
  expect(next.record('order', '123456')?.state).toBe('review');
});

it('uses only operations, scopes and paging fields recorded from the official Whatnot v2 contract', async () => {
  const contract = (await import('../docs/WHATNOT_API_CONTRACT.json')).default;
  const { WHATNOT_BASE, WHATNOT_SCOPES } = await import('../src/lib/integrations/whatnot/schema');
  expect(WHATNOT_BASE).toBe(contract.base);
  for (const scope of WHATNOT_SCOPES) expect(Object.keys(contract.scopes)).toContain(scope);
  expect(contract.pagination).toEqual(['data', 'next_cursor']);
  expect(contract.readOperations['/orders'].queryParameters).toEqual([
    'limit',
    'cursor',
    'reverse',
  ]);
  expect(() =>
    parseFinancialReport(reportCsv.replace('2026-11-11 12:00:00', '2026-02-30 12:00:00'), sellerId),
  ).toThrow('invalid UTC');
});

it('reconciles multi-unit order quantities before using per-item source cost and imports exactly one record per physical unit', () => {
  const source = whatnotSource();
  source.items[0].quantity = 2;
  source.order.amounts.subtotal.amount = '90.00';
  source.order.amounts.total.amount = '96.00';
  const tx = whatnotEarnings();
  tx.amount = 7550;
  tx.earnings = {
    ...tx.earnings!,
    merchandise: 9000,
    netMerchandise: 8800,
    fees: 800,
    processing: 250,
    shipping: 200,
    quantity: 2,
  };
  const plan = new WhatnotPlan(actor, sellerId, emptyWorkspace(), [txRecord(tx)]);
  plan.order(source);
  expect(plan.w.items).toHaveLength(2);
  expect(plan.w.orders).toHaveLength(1);
  expect(plan.w.orders[0].lines.map((l) => l.costBasis)).toEqual([1200, 1200]);
  expect(metrics(plan.w)).toMatchObject({
    revenue: 8800,
    cogs: 2400,
    profit: 5150,
    profitKnown: true,
  });
  const retry = new WhatnotPlan(actor, sellerId, plan.w, [...plan.writes.values()]);
  retry.order(source);
  expect(retry.w.items).toHaveLength(2);
  expect(retry.w.financialEvents).toHaveLength(2);
  const contradictory = { ...tx, earnings: { ...tx.earnings!, quantity: 1 } };
  const review = new WhatnotPlan(actor, sellerId, emptyWorkspace(), [txRecord(contradictory)]);
  review.order(source);
  expect(metrics(review.w)).toMatchObject({ unknownCosts: 2, profitKnown: false });
  expect(review.record('order', source.order.id)?.state).toBe('review');
});
