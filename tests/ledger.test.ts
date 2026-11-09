import { describe, it, expect } from 'vitest';
import { applyCommand } from '../src/lib/commands';
import {
  emptyWorkspace,
  itemSchema,
  orderSchema,
  type FinancialEvent,
  type Workspace,
} from '../src/lib/model';
import { metrics } from '../src/lib/finance';
import {
  currentOrderTotals,
  itemIsSold,
  paidForOrder,
  payoutOutstanding,
  payoutReceived,
} from '../src/lib/ledger';
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const saleDate = '2026-09-30T16:00:00.000Z',
  refundDate = '2026-10-03T16:00:00.000Z';
function fixture() {
  let w = emptyWorkspace();
  for (let i = 1; i <= 2; i++)
    w = applyCommand(w, {
      type: 'item',
      value: itemSchema.parse({
        id: id(i),
        sku: `L-${i}`,
        title: `Piece ${i}`,
        cost: 1000 * i,
        asking: 5000,
        purchasedAt: '2026-09-01T12:00:00Z',
        createdAt: saleDate,
        status: 'Purchased',
      }),
    });
  return applyCommand(w, {
    type: 'order',
    value: orderSchema.parse({
      id: id(10),
      marketplace: 'Whatnot',
      date: saleDate,
      externalId: 'LOT-1',
      lines: [
        { itemId: id(1), price: 6000, costBasis: 1000 },
        { itemId: id(2), price: 4000, costBasis: 2000 },
      ],
      discount: 0,
      shippingCollected: 0,
      fees: 1000,
      processing: 0,
      shipping: 0,
      packaging: 0,
      other: 0,
      refund: 0,
      feeCredit: 0,
      adjustment: 0,
      tips: 0,
      type: 'Sale',
      status: 'Completed',
      fulfillment: 'Unfulfilled',
      payout: 'Pending',
    }),
  });
}
function event(overrides: Partial<FinancialEvent> = {}): FinancialEvent {
  return {
    id: id(20),
    orderId: id(10),
    kind: 'Refund',
    date: refundDate,
    amount: 6000,
    reason: 'One piece returned',
    itemIds: [id(1)],
    externalId: '',
    reversesId: null,
    category: 'Other',
    ...overrides,
  };
}
const post = (w: Workspace, e: FinancialEvent) =>
  applyCommand(w, { type: 'financialEvent', value: e });
describe('dated refunds and partial physical returns', () => {
  it('retains September profit while recognizing an October refund and cost recovery', () => {
    const before = fixture();
    const w = post(before, event());
    expect(metrics(w, Date.parse('2026-09-01'), Date.parse('2026-09-30T23:59:59Z')).profit).toBe(
      6000,
    );
    const october = metrics(w, Date.parse('2026-10-01'), Date.parse('2026-10-31T23:59:59Z'));
    expect(october.revenue).toBe(-6000);
    expect(october.cogs).toBe(-1000);
    expect(october.profit).toBe(-5000);
    expect(currentOrderTotals(w, w.orders[0]).profit).toBe(1000);
    expect(w.items[0].status).toBe('Returned');
    expect(w.items[1].status).toBe('Sold');
    expect(itemIsSold(w, id(2))).toBe(true);
  });
  it('allows resale of just the returned piece, with no duplicate COGS', () => {
    let w = post(fixture(), event());
    w = applyCommand(w, {
      type: 'order',
      value: {
        ...w.orders[0],
        id: id(11),
        externalId: 'RESALE',
        date: '2026-10-04T12:00:00Z',
        lines: [{ itemId: id(1), price: 5000, costBasis: 1000 }],
        fees: 500,
      },
    });
    expect(metrics(w).cogs).toBe(3000);
    expect(w.items[0].status).toBe('Sold');
    expect(() =>
      post(
        w,
        event({
          id: id(21),
          kind: 'Reversal',
          amount: 0,
          itemIds: [],
          reversesId: id(20),
          date: '2026-10-05T12:00:00Z',
        }),
      ),
    ).toThrow('resold');
  });
  it('prevents duplicate returns, excessive refunds, fee overcredits, and baseline rewrites', () => {
    const w = post(fixture(), event());
    expect(() => post(w, event({ id: id(21) }))).toThrow('available to return');
    expect(() => post(w, event({ id: id(21), amount: 5000, itemIds: [] }))).toThrow(
      'Cumulative refunds',
    );
    expect(() =>
      post(w, event({ id: id(21), kind: 'Fee adjustment', amount: -1001, itemIds: [] })),
    ).toThrow('Fee credits');
    expect(() => applyCommand(w, { type: 'order', value: { ...w.orders[0], fees: 900 } })).toThrow(
      'dated ledger',
    );
  });
  it('preserves immutable event history and posts reversals on their own dates', () => {
    let w = post(fixture(), event({ itemIds: [], amount: 1000 }));
    expect(() => post(w, event({ itemIds: [], amount: 2000 }))).toThrow('immutable');
    w = post(
      w,
      event({
        id: id(21),
        kind: 'Reversal',
        amount: 0,
        itemIds: [],
        reversesId: id(20),
        date: '2026-11-01T12:00:00Z',
      }),
    );
    expect(metrics(w, Date.parse('2026-10-01'), Date.parse('2026-10-31T23:59:59Z')).profit).toBe(
      -1000,
    );
    expect(metrics(w, Date.parse('2026-11-01'), Date.parse('2026-11-02')).profit).toBe(1000);
    expect(w.financialEvents).toHaveLength(2);
    expect(() =>
      post(
        w,
        event({
          id: id(22),
          kind: 'Reversal',
          amount: 0,
          itemIds: [],
          reversesId: id(20),
          date: '2026-11-02T12:00:00Z',
        }),
      ),
    ).toThrow('unreversed');
  });
  it('restores giveaway stock without inventing paid units or revenue', () => {
    let w = emptyWorkspace();
    const item = fixture().items[0];
    w = applyCommand(w, { type: 'item', value: { ...item, status: 'Purchased' } });
    const order = {
      ...fixture().orders[0],
      type: 'Giveaway' as const,
      lines: [{ itemId: item.id, price: 0, costBasis: item.cost }],
      fees: 0,
    };
    w = applyCommand(w, { type: 'order', value: order });
    w = post(w, event({ kind: 'Return', amount: 0 }));
    expect(metrics(w).sold).toBe(0);
    expect(metrics(w).revenue).toBe(0);
    expect(metrics(w).cogs).toBe(0);
  });
  it('rejects a resale dated before the recorded physical return', () => {
    const w = post(fixture(), event());
    expect(() =>
      applyCommand(w, {
        type: 'order',
        value: {
          ...w.orders[0],
          id: id(11),
          externalId: 'RESALE',
          date: saleDate,
          lines: [{ itemId: id(1), price: 5000, costBasis: 1000 }],
        },
      }),
    ).toThrow('resale date');
  });
});
describe('cash receipts and grouped fulfillment', () => {
  it('records partial cash receipts without changing revenue or profit, and reverses them exactly', () => {
    let w = fixture();
    const before = metrics(w).profit;
    const payout = {
      id: id(40),
      marketplace: 'Whatnot' as const,
      date: refundDate,
      reference: 'PAY-1',
      amount: 3000,
      allocations: [{ orderId: id(10), amount: 3000 }],
      notes: '',
      reversalOf: null,
    };
    w = applyCommand(w, { type: 'payout', value: payout });
    expect(payoutReceived(w)).toBe(3000);
    expect(paidForOrder(w, id(10))).toBe(3000);
    expect(payoutOutstanding(w, w.orders[0])).toBe(6000);
    expect(metrics(w).profit).toBe(before);
    w = applyCommand(w, {
      type: 'payout',
      value: {
        ...payout,
        id: id(41),
        reference: 'REV-PAY-1',
        date: '2026-10-04T12:00:00Z',
        reversalOf: id(40),
      },
    });
    expect(payoutReceived(w)).toBe(0);
    expect(payoutOutstanding(w, w.orders[0])).toBe(9000);
  });
  it('rejects duplicated payout references, overallocations, and mismatched receipt totals', () => {
    let w = fixture();
    const payout = {
      id: id(40),
      marketplace: 'Whatnot' as const,
      date: refundDate,
      reference: 'PAY-1',
      amount: 9000,
      allocations: [{ orderId: id(10), amount: 9000 }],
      notes: '',
      reversalOf: null,
    };
    w = applyCommand(w, { type: 'payout', value: payout });
    expect(() => applyCommand(w, { type: 'payout', value: { ...payout, id: id(41) } })).toThrow(
      'reference',
    );
    expect(() =>
      applyCommand(w, { type: 'payout', value: { ...payout, id: id(41), reference: 'PAY-2' } }),
    ).toThrow('exceeds');
    expect(() =>
      applyCommand(fixture(), { type: 'payout', value: { ...payout, amount: 9001 } }),
    ).toThrow('exact cash');
  });
  it('groups orders without double-counting label costs or sales', () => {
    let w = fixture();
    const pkg = {
      id: id(50),
      marketplace: 'Whatnot' as const,
      date: refundDate,
      orderIds: [id(10)],
      carrier: 'USPS',
      tracking: 'TEST',
      status: 'Shipped' as const,
      labelCost: 500,
      notes: '',
      allocatedShipping: false,
    };
    const before = metrics(w).profit;
    w = applyCommand(w, { type: 'shipment', value: pkg });
    expect(w.orders[0].fulfillment).toBe('Shipped');
    expect(metrics(w).profit).toBe(before);
    expect(() => applyCommand(w, { type: 'shipment', value: { ...pkg, id: id(51) } })).toThrow(
      'another package',
    );
  });
  it('requires a matching shipping posting and protects the posted allocation', () => {
    let w = fixture();
    const pkg = {
      id: id(50),
      marketplace: 'Whatnot' as const,
      date: refundDate,
      orderIds: [id(10)],
      carrier: 'USPS',
      tracking: 'TEST',
      status: 'Shipped' as const,
      labelCost: 500,
      notes: '',
      allocatedShipping: true,
    };
    expect(() => applyCommand(w, { type: 'shipment', value: pkg })).toThrow('exact shipping');
    w = post(
      w,
      event({
        kind: 'Direct cost adjustment',
        amount: 500,
        itemIds: [],
        externalId: `shipment:${pkg.id}:${id(10)}`,
        category: 'Shipping',
      }),
    );
    w = applyCommand(w, { type: 'shipment', value: pkg });
    expect(metrics(w).profit).toBe(5500);
    expect(() => applyCommand(w, { type: 'shipment', value: { ...pkg, labelCost: 600 } })).toThrow(
      'posted',
    );
  });
});
it('exports dated profit and cash as distinct columns without duplicate order totals', async () => {
  const { ledgerExportRows } = await import('../src/lib/ledger');
  let w = post(fixture(), event());
  w = applyCommand(w, {
    type: 'expense',
    value: {
      id: id(60),
      title: 'Supplies',
      category: 'Supplies',
      amount: 200,
      date: refundDate,
      showId: null,
      tripId: null,
    },
  });
  w = applyCommand(w, {
    type: 'payout',
    value: {
      id: id(40),
      marketplace: 'Whatnot',
      date: refundDate,
      reference: 'EXPORT-PAY',
      amount: 3000,
      allocations: [{ orderId: id(10), amount: 3000 }],
      notes: '',
      reversalOf: null,
    },
  });
  const rows = ledgerExportRows(w);
  expect(Math.round(rows.reduce((n, r) => n + Number(r.operating_profit), 0) * 100)).toBe(
    metrics(w).profit,
  );
  expect(Math.round(rows.reduce((n, r) => n + Number(r.cash_receipt), 0) * 100)).toBe(
    payoutReceived(w),
  );
  expect(rows.filter((r) => r.record_type === 'Payout receipt')[0].revenue).toBe(0);
});
it('keeps manual order fulfillment consistent with its grouped package', () => {
  let w = fixture();
  w = applyCommand(w, {
    type: 'shipment',
    value: {
      id: id(50),
      marketplace: 'Whatnot',
      date: refundDate,
      orderIds: [id(10)],
      carrier: 'USPS',
      tracking: 'TEST',
      status: 'Shipped',
      labelCost: 0,
      notes: '',
      allocatedShipping: false,
    },
  });
  expect(() =>
    applyCommand(w, { type: 'order', value: { ...w.orders[0], fulfillment: 'Unfulfilled' } }),
  ).toThrow('linked package');
});
