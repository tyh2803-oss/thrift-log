import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { EbayPlan, orderUnits, orderAmounts } from '../src/lib/integrations/ebay/planner';
import { emptyWorkspace, itemSchema } from '../src/lib/model';
import { applyCommand } from '../src/lib/commands';
import { metrics } from '../src/lib/finance';
import { inventoryPipeline } from '../src/lib/pipeline';
import { historyCostUnknown, sellerFinancialPending } from '../src/lib/cost-knowledge';
import { confirmedFreeInventory } from '../src/lib/assistant/listing-review';
import { seal, unseal } from '../src/lib/integrations/ebay/crypto';
import { unseal as whatnotUnseal } from '../src/lib/integrations/whatnot/crypto';
import { EbayClient, exchangeToken } from '../src/lib/integrations/ebay/client';
import { z } from 'zod';
import { ebayOrder, ebayTransaction, ebayAmount, ebayActor, ebaySeller } from './helpers/ebay';
const plan = () => new EbayPlan(ebayActor, ebaySeller, 'production', emptyWorkspace());
beforeEach(() => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'isolated-ebay-test-root');
  vi.stubEnv('EBAY_CLIENT_ID', 'test-client');
  vi.stubEnv('EBAY_CLIENT_SECRET', 'test-client-secret');
  vi.stubEnv('EBAY_REDIRECT_URI_NAME', 'test-runame');
  vi.stubEnv('EBAY_APP_URL', 'https://app.test');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it('imports actual seller revenue excluding eBay tax, preserves unknown purchase costs/fees and places the sale in the canonical pipeline', () => {
  const p = plan();
  p.order(ebayOrder());
  expect(p.w.items).toHaveLength(1);
  expect(p.w.orders).toHaveLength(1);
  expect(metrics(p.w)).toMatchObject({
    revenue: 4800,
    profitKnown: false,
    unknownCosts: 1,
    unknownFinancials: 1,
  });
  expect(historyCostUnknown(p.w, p.w.orders[0].id)).toBe(true);
  expect(inventoryPipeline(p.w).groups.sold.count).toBe(1);
  p.transaction(ebayTransaction());
  expect(p.w.financialEvents).toHaveLength(1);
  expect(metrics(p.w)).toMatchObject({
    revenue: 4800,
    fees: 525,
    unknownFinancials: 0,
    profitKnown: false,
  });
});
it('reuses only unique available exact inventory and preserves known costs/photos; repeated names and SKUs create distinct physical units without a blocker', () => {
  const p = plan(),
    item = itemSchema.parse({
      id: crypto.randomUUID(),
      sku: 'JACKET-1',
      title: 'Original title',
      cost: 1200,
      asking: 6000,
      purchasedAt: '2026-11-01T00:00:00Z',
      createdAt: '2026-11-01T00:00:00Z',
      status: 'Purchased',
      photos: ['private-owned-photo'],
    });
  p.w = applyCommand(p.w, { type: 'item', value: item });
  p.order(ebayOrder());
  p.transaction(ebayTransaction());
  expect(p.w.items).toHaveLength(1);
  expect(p.w.items[0].photos).toEqual(item.photos);
  expect(metrics(p.w)).toMatchObject({ profit: 3075, profitKnown: true });
  p.order(ebayOrder({ orderId: 'another-order' }));
  expect(p.w.orders).toHaveLength(2);
  expect(p.w.items).toHaveLength(2);
  expect(p.record('order', 'another-order')?.state).toBe('applied');
});
it('distinguishes explicitly confirmed zero from unknown and accepts exact purchase costs on new physical units', () => {
  const p = plan(),
    s = ebayOrder();
  p.save('order', s.orderId, { source: s, shipments: [] }, 'pending', '', null, {
    units: { 'line-1:0': { itemId: 'new', cost: 0 } },
  });
  p.order(s);
  p.transaction(ebayTransaction());
  expect(confirmedFreeInventory(p.w, p.w.items[0].id)).toBe(true);
  expect(historyCostUnknown(p.w, p.w.orders[0].id)).toBe(false);
  expect(metrics(p.w).profitKnown).toBe(true);
});
it('splits line-level totals across quantities in exact cents and never counts one physical piece twice', () => {
  const s = ebayOrder();
  s.lineItems[0].quantity = 3;
  s.lineItems[0].lineItemCost = ebayAmount('10.01');
  s.pricingSummary = {
    priceSubtotal: ebayAmount('10.01'),
    total: ebayAmount('13.01'),
    tax: ebayAmount('3.00'),
  };
  expect(orderUnits(s).map((u) => u.price)).toEqual([334, 334, 333]);
  expect(orderAmounts(s).gross).toBe(1001);
  const p = plan();
  p.order(s);
  expect(p.w.items).toHaveLength(3);
  expect(new Set(p.w.orders[0].lines.map((l) => l.itemId)).size).toBe(3);
});
it('reconciles strict financial totals/currencies and atomically holds unsupported orders without partial item writes', () => {
  for (const mutate of [
    (s: ReturnType<typeof ebayOrder>) => (s.pricingSummary.total.value = '99.00'),
    (s: ReturnType<typeof ebayOrder>) => (s.pricingSummary.total.currency = 'GBP'),
    (s: ReturnType<typeof ebayOrder>) => (s.pricingSummary.adjustment = ebayAmount('1.00')),
  ]) {
    const p = plan(),
      s = ebayOrder();
    mutate(s);
    p.order(s);
    expect(p.w.items).toHaveLength(0);
    expect(p.w.orders).toHaveLength(0);
    expect(p.record('order', s.orderId)?.state).toBe('review');
  }
});
it('does not invent paid sales, shipping dates, actual purchase dates, buyer identity or external listing changes', () => {
  const p = plan();
  p.order(ebayOrder({ orderPaymentStatus: 'PENDING' }));
  expect(p.w.orders).toHaveLength(0);
  p.order(ebayOrder({ orderFulfillmentStatus: 'FULFILLED' }), [
    { fulfillmentId: 'label-only', lineItems: [{ lineItemId: 'line-1', quantity: 1 }] },
  ]);
  expect(inventoryPipeline(p.w).groups.sold.count).toBe(1);
  expect(p.w.shipments).toHaveLength(0);
  expect(p.w.items[0].notes).toContain('unknown');
  expect(p.w.listings).toHaveLength(0);
});
it('updates confirmed fulfillment forward, retains history, and repeated orders/transactions do not duplicate records', () => {
  const p = plan(),
    s = ebayOrder(),
    shipment = {
      fulfillmentId: 'shipment-1',
      shippedDate: '2026-11-11T12:00:00Z',
      shipmentTrackingNumber: 'TRACK',
      lineItems: [{ lineItemId: 'line-1', quantity: 1 }],
    };
  p.order(s, [shipment]);
  p.transaction(ebayTransaction());
  const w = structuredClone(p.w);
  p.order(s, [shipment]);
  p.transaction(ebayTransaction({ transactionStatus: 'FUNDS_ON_HOLD' }));
  expect(p.w.items).toEqual(w.items);
  expect(p.w.orders).toEqual(w.orders);
  expect(p.w.financialEvents).toEqual(w.financialEvents);
  expect(p.w.shipments).toHaveLength(1);
  expect(inventoryPipeline(p.w).groups.shipped.count).toBe(1);
  p.order(s, []);
  expect(inventoryPipeline(p.w).groups.shipped.count).toBe(1);
});
it('applies postage and reviewed net refunds as immutable dated events without inventing a physical return or doubling fees', () => {
  const p = plan();
  p.order(ebayOrder());
  p.transaction(ebayTransaction());
  p.transaction(
    ebayTransaction({
      transactionId: 'label-1',
      transactionType: 'SHIPPING_LABEL',
      bookingEntry: 'DEBIT',
      amount: ebayAmount('5.00'),
      totalFeeAmount: undefined,
    }),
  );
  const tx = ebayTransaction({
    transactionId: 'refund-1',
    transactionType: 'REFUND',
    bookingEntry: 'DEBIT',
    amount: ebayAmount('9.00'),
    totalFeeAmount: undefined,
  });
  p.transaction(tx);
  expect(p.record('transaction', 'REFUND:refund-1')?.state).toBe('review');
  expect(sellerFinancialPending(p.w, p.w.orders[0].id)).toBe(true);
  p.save('transaction', 'REFUND:refund-1', tx, 'pending', '', null, {
    refund: { amount: 1000, feeCredit: 100 },
  });
  p.transaction(tx);
  expect(p.record('transaction', 'REFUND:refund-1')?.state).toBe('applied');
  expect(metrics(p.w)).toMatchObject({ revenue: 3800, fees: 425, direct: 925 });
  expect(p.w.items[0].status).toBe('Sold');
  const n = p.w.financialEvents.length;
  p.transaction(tx);
  expect(p.w.financialEvents).toHaveLength(n);
});
it('holds changed posted money and unsupported financial transactions without rewriting original facts', () => {
  const p = plan();
  p.order(ebayOrder());
  p.transaction(ebayTransaction());
  const events = structuredClone(p.w.financialEvents);
  p.transaction(ebayTransaction({ amount: ebayAmount('40.00') }));
  expect(p.record('transaction', 'SALE:tx-sale-1')?.state).toBe('review');
  expect(p.w.financialEvents).toEqual(events);
  p.transaction(ebayTransaction({ transactionId: 'unknown', transactionType: 'DISPUTE' }));
  expect(p.record('transaction', 'DISPUTE:unknown')?.state).toBe('review');
});
it('books a bank payout only once with complete exact source allocation, never as revenue; failed/ambiguous payouts remain separate', () => {
  const p = plan();
  p.order(ebayOrder());
  p.transaction(ebayTransaction());
  const source = {
    payoutId: 'payout-1',
    payoutDate: '2026-11-12T12:00:00Z',
    payoutStatus: 'SUCCEEDED',
    amount: ebayAmount('42.75'),
    transactionCount: 1,
  };
  p.payout(source);
  expect(p.w.payouts).toHaveLength(1);
  expect(metrics(p.w).revenue).toBe(4800);
  p.payout(source);
  expect(p.w.payouts).toHaveLength(1);
  p.payout({ ...source, payoutId: 'unallocated', amount: ebayAmount('1.00') });
  expect(p.record('payout', 'unallocated')?.state).toBe('review');
  p.payout({ ...source, payoutId: 'failed', payoutStatus: 'RETRYABLE_FAILED' });
  expect(p.w.payouts).toHaveLength(1);
});
it('encrypts tokens with tenant/provider separation and stable IDs separated by actor and environment', () => {
  const encrypted = seal(ebayActor, 'private-refresh-token');
  expect(unseal(ebayActor, encrypted)).toBe('private-refresh-token');
  expect(() => unseal(crypto.randomUUID(), encrypted)).toThrow();
  expect(() => whatnotUnseal(ebayActor, encrypted)).toThrow();
  expect(plan().id('order', 'one')).not.toBe(
    new EbayPlan(ebayActor, ebaySeller, 'sandbox', emptyWorkspace()).id('order', 'one'),
  );
});
it('uses only fixed HTTPS read endpoints, rejects response redirects and strips sensitive upstream details from errors', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ private: 'UPSTREAM_SECRET' }, { status: 403 })),
  );
  const client = new EbayClient('private-access-token');
  await expect(client.get('https://evil.test', z.object({}))).rejects.toThrow('Unsupported');
  expect(fetch).not.toHaveBeenCalled();
  await expect(client.get('/sell/fulfillment/v1/order', z.object({}))).rejects.toThrow(
    'permission',
  );
  expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({
    method: 'GET',
    redirect: 'error',
    cache: 'no-store',
  });
});
it('exchanges and refreshes OAuth credentials only server-side, preserves renewable grants and validates granted scopes', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 7200,
        token_type: 'Bearer',
      }),
    ),
  );
  const c = await exchangeToken({ code: 'authorization-code' });
  expect(c.scopes).toHaveLength(2);
  expect(c.refreshToken).toBe('new-refresh');
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ access_token: 'refreshed-access', expires_in: 7200, token_type: 'Bearer' }),
  );
  const next = await exchangeToken({ credentials: c });
  expect(next.refreshToken).toBe(c.refreshToken);
  const [url, options] = vi.mocked(fetch).mock.calls[0];
  expect(url).toBe('https://api.ebay.com/identity/v1/oauth2/token');
  expect(options?.method).toBe('POST');
  expect(String(options?.body)).toContain('redirect_uri=test-runame');
});

it('maps partial quantities across separate fulfillment packages without inventing a whole-order shipment', () => {
  const p = plan(),
    s = ebayOrder();
  s.lineItems[0].quantity = 2;
  p.order(s, [
    {
      fulfillmentId: 'a',
      shippedDate: '2026-11-11T10:00:00Z',
      lineItems: [{ lineItemId: 'line-1', quantity: 1 }],
    },
  ]);
  expect(inventoryPipeline(p.w).groups.shipped.count).toBe(1);
  expect(inventoryPipeline(p.w).groups.sold.count).toBe(1);
  p.order(s, [
    {
      fulfillmentId: 'a',
      shippedDate: '2026-11-11T10:00:00Z',
      lineItems: [{ lineItemId: 'line-1', quantity: 1 }],
    },
    {
      fulfillmentId: 'b',
      shippedDate: '2026-11-12T10:00:00Z',
      lineItems: [{ lineItemId: 'line-1', quantity: 1 }],
    },
  ]);
  expect(p.record('order', s.orderId)?.issue).toBe('');
  expect(inventoryPipeline(p.w).groups.shipped.count).toBe(2);
  expect(p.w.shipments).toHaveLength(0);
});
it('does not double-charge manually recorded fees when an old order ID is linked to eBay', () => {
  const p = plan();
  p.order(ebayOrder());
  const receipt = p.w.imports[0];
  p.w = { ...p.w, imports: [] };
  p.w.orders[0].fees = 525;
  const before = structuredClone(p.w.orders);
  p.order(ebayOrder());
  expect(p.record('order', ebayOrder().orderId)?.state).toBe('review');
  expect(p.w.orders).toEqual(before);
  expect(p.w.financialEvents).toHaveLength(0);
  expect(receipt.mapping.ebay).toBe('true');
});
it('preserves an existing history receipt and unknown-cost proof when adopting an unposted manual order', () => {
  const p = plan();
  p.order(ebayOrder());
  const receipt = p.w.imports[0],
    audit = JSON.parse(receipt.rawCsv);
  p.w.imports[0] = {
    ...receipt,
    mapping: { format: 'assistant-v1', history: 'true' },
    rawCsv: JSON.stringify({ ...audit, sourceEvidence: 'retained original review' }),
  };
  p.order(ebayOrder());
  p.transaction(ebayTransaction());
  expect(JSON.parse(p.w.imports[0].rawCsv).sourceEvidence).toBe('retained original review');
  expect(historyCostUnknown(p.w, p.w.orders[0].id)).toBe(true);
  expect(metrics(p.w)).toMatchObject({ fees: 525, profitKnown: false });
});
it('does not conceal an unrecorded express-payout fee by creating a cash receipt automatically', () => {
  const p = plan();
  p.order(ebayOrder());
  p.transaction(ebayTransaction());
  p.payout({
    payoutId: 'payout-1',
    payoutDate: '2026-11-12T12:00:00Z',
    payoutStatus: 'SUCCEEDED',
    amount: ebayAmount('42.75'),
    totalFee: ebayAmount('1.00'),
    transactionCount: 1,
  });
  expect(p.w.payouts).toHaveLength(0);
  expect(p.record('payout', 'payout-1')?.issue).toContain('express-payout fee');
});
