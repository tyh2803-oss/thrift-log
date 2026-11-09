import { describe, it, expect } from 'vitest';
import {
  allocate,
  parseMoney,
  orderTotals,
  metrics,
  laborMs,
  lineProfits,
} from '../src/lib/finance';
import { applyCommand } from '../src/lib/commands';
import {
  emptyWorkspace,
  itemSchema,
  orderSchema,
  type Workspace,
  type Session,
  type Order,
} from '../src/lib/model';
import { readCsv, planImport, csvText } from '../src/lib/csv';
import { periodRange } from '../src/lib/dates';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const date = '2026-11-01T12:00:00.000Z';
function fixture() {
  let w = emptyWorkspace();
  for (let i = 1; i <= 3; i++)
    w = applyCommand(w, {
      type: 'item',
      value: itemSchema.parse({
        id: id(i),
        sku: `SKU-${i}`,
        title: `Item ${i}`,
        cost: 1000 * i,
        asking: 5000,
        status: 'Purchased',
        purchasedAt: date,
        createdAt: date,
      }),
    });
  return w;
}
function sale(overrides: Partial<Order> = {}): Order {
  return orderSchema.parse({
    id: id(10),
    marketplace: 'Whatnot',
    date,
    lines: [{ itemId: id(1), price: 5000, costBasis: 1000 }],
    discount: 200,
    shippingCollected: 600,
    fees: 500,
    processing: 100,
    shipping: 650,
    packaging: 50,
    other: 0,
    refund: 0,
    feeCredit: 0,
    adjustment: 0,
    tips: 0,
    type: 'Sale',
    status: 'Completed',
    fulfillment: 'Unfulfilled',
    payout: 'Pending',
    ...overrides,
  });
}
const session = (idN: number, start: string, end: string | null): Session => ({
  id: id(idN),
  category: 'Selling',
  subcategory: '',
  notes: '',
  showId: null,
  tripId: null,
  locationId: null,
  state: end ? 'Ended' : 'Running',
  segments: [{ start, end }],
});
describe('financial calculations', () => {
  it('parses decimal money without binary rounding', () => {
    expect(parseMoney('0.29')).toBe(29);
    expect(parseMoney('-12.05')).toBe(-1205);
    expect(() => parseMoney('1.001')).toThrow();
    expect(() => parseMoney('NaN')).toThrow();
  });
  it('uses consistent seller revenue and actual direct costs', () =>
    expect(orderTotals(sale())).toEqual({
      gross: 5000,
      revenue: 5400,
      cogs: 1000,
      fees: 600,
      direct: 1300,
      profit: 3100,
      netProceeds: 4100,
    }));
  it('allocates all cents in multi-item orders including zero-price lots', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
    expect(allocate(11, [0, 0])).toEqual([6, 5]);
    const o = sale({
      lines: [
        { itemId: id(1), price: 3001, costBasis: 1000 },
        { itemId: id(2), price: 1999, costBasis: 2000 },
      ],
    });
    expect(lineProfits(o).reduce((n, l) => n + l.profit, 0)).toBe(orderTotals(o).profit);
  });
  it('handles refunds, fee credits, and returned cost basis', () => {
    expect(orderTotals(sale({ refund: 1000, feeCredit: 100 })).profit).toBe(2200);
    expect(orderTotals(sale({ status: 'Returned', refund: 5400 })).profit).toBe(-1300);
  });
  it('does not deduct cancelled refunds from unrecognized revenue twice', () => {
    expect(orderTotals(sale({ status: 'Cancelled', refund: 5400 })).revenue).toBe(0);
    expect(orderTotals(sale({ status: 'Cancelled', refund: 5400 })).profit).toBe(-1300);
  });
  it('keeps giveaway cost, tips, and fee adjustments distinct', () => {
    expect(
      orderTotals(
        sale({
          type: 'Giveaway',
          lines: [{ itemId: id(1), price: 0, costBasis: 1000 }],
          discount: 0,
          shippingCollected: 0,
          fees: 0,
          processing: 0,
          shipping: 500,
          packaging: 50,
        }),
      ).profit,
    ).toBe(-1550);
    expect(
      orderTotals(
        sale({
          type: 'Tip',
          lines: [],
          discount: 0,
          shippingCollected: 0,
          fees: 50,
          processing: 0,
          shipping: 0,
          packaging: 0,
          tips: 1000,
          adjustment: -25,
        }),
      ).profit,
    ).toBe(925);
  });
  it('separates inventory purchases from COGS, expenses, and payouts', () => {
    let w = fixture();
    expect(metrics(w).cogs).toBe(0);
    expect(metrics(w).profit).toBe(0);
    w = applyCommand(w, { type: 'order', value: sale() });
    w = applyCommand(w, {
      type: 'expense',
      value: {
        id: id(90),
        title: 'Supplies',
        category: 'Supplies',
        amount: 100,
        date,
        showId: null,
        tripId: null,
      },
    });
    expect(metrics(w).profit).toBe(3000);
    expect(metrics(w).inventoryCost).toBe(5000);
    expect(metrics(w).pendingPayout).toBe(4100);
    expect(metrics(w).hourly).toBeNull();
  });
});
describe('inventory and sales integrity', () => {
  it('counts cross-listed stock once and flags other listings for manual delisting', () => {
    let w = fixture();
    for (const [i, marketplace] of ['Whatnot', 'Depop'].entries())
      w = applyCommand(w, {
        type: 'listing',
        value: {
          id: id(30 + i),
          itemId: id(1),
          marketplace: marketplace as 'Whatnot' | 'Depop',
          price: 5000,
          originalPrice: 5000,
          externalId: '',
          url: '',
          listedAt: date,
          status: 'Active',
          format: 'Fixed price',
          lastSync: null,
        },
      });
    expect(metrics(w).inventoryCost).toBe(6000);
    w = applyCommand(w, { type: 'order', value: sale() });
    expect(w.items[0].status).toBe('Sold');
    expect(w.listings.map((l) => l.status)).toEqual(['Sold', 'Needs delisting']);
    expect(() => applyCommand(w, { type: 'order', value: sale({ id: id(11) }) })).toThrow(
      'already sold',
    );
  });
  it('prevents duplicate order imports and historical cost changes', () => {
    const w = applyCommand(fixture(), { type: 'order', value: sale({ externalId: 'WN-123' }) });
    expect(() =>
      applyCommand(w, { type: 'order', value: sale({ id: id(11), externalId: 'WN-123' }) }),
    ).toThrow('already been recorded');
    expect(() =>
      applyCommand(w, {
        type: 'order',
        value: sale({
          externalId: 'WN-123',
          lines: [{ itemId: id(1), price: 5000, costBasis: 1 }],
        }),
      }),
    ).toThrow('historical cost');
  });
  it('restores returns and permits resale without double COGS', () => {
    let w = applyCommand(fixture(), { type: 'order', value: sale() });
    w = applyCommand(w, {
      type: 'order',
      value: { ...w.orders[0], status: 'Returned', refund: 5400 },
    });
    expect(w.items[0].status).toBe('Returned');
    w = applyCommand(w, { type: 'order', value: sale({ id: id(11) }) });
    expect(metrics(w).cogs).toBe(1000);
  });
  it('reserves show inventory and releases unsold items when a show ends', () => {
    let w = fixture();
    const show = {
      id: id(60),
      name: 'Sunday',
      date,
      type: 'Whatnot' as const,
      status: 'Planned' as const,
      notes: '',
      externalId: '',
      lineup: [{ itemId: id(1), startingBid: 1000, presented: false }],
      checklist: [],
      durationMinutes: 120,
    };
    w = applyCommand(w, { type: 'show', value: show });
    expect(w.items[0].status).toBe('Reserved');
    w = applyCommand(w, { type: 'show', value: { ...show, status: 'Ended' } });
    expect(w.items[0].status).toBe('Ready to List');
    expect(metrics(w).hours).toBe(0);
  });
  it('rejects refunds above actual revenue and negative amounts', () => {
    expect(() =>
      applyCommand(fixture(), { type: 'order', value: sale({ refund: 99999 }) }),
    ).toThrow('Refund exceeds');
    expect(() => itemSchema.parse({ ...fixture().items[0], cost: -1 })).toThrow();
  });
});
describe('time and reporting', () => {
  it('merges overlap and clips intervals to period', () => {
    const a = session(1, '2026-11-01T10:00:00Z', '2026-11-01T12:00:00Z');
    const b = session(2, '2026-11-01T11:00:00Z', '2026-11-01T13:00:00Z');
    expect(laborMs([a, b])).toBe(3 * 3600000);
    expect(
      laborMs([a, b], Date.parse('2026-11-01T11:30:00Z'), Date.parse('2026-11-01T12:30:00Z')),
    ).toBe(3600000);
  });
  it('persists paused intervals and prevents concurrent timers', () => {
    let w = fixture();
    const a = session(80, date, null);
    w = applyCommand(w, { type: 'session', value: a });
    expect(() => applyCommand(w, { type: 'session', value: { ...a, id: id(81) } })).toThrow(
      'current timer',
    );
    w = applyCommand(w, {
      type: 'session',
      value: { ...a, state: 'Paused', segments: [{ start: date, end: '2026-11-01T13:00:00Z' }] },
    });
    const recovered = JSON.parse(JSON.stringify(w)) as Workspace;
    expect(laborMs(recovered.sessions)).toBe(3600000);
    w = applyCommand(w, {
      type: 'session',
      value: {
        ...recovered.sessions[0],
        state: 'Running',
        segments: [...recovered.sessions[0].segments, { start: '2026-11-01T14:00:00Z', end: null }],
      },
    });
    expect(w.sessions[0].segments).toHaveLength(2);
  });
  it('handles New York daylight-saving boundaries', () => {
    const [start, end] = periodRange(
      'Today',
      'America/New_York',
      '',
      '',
      new Date('2026-11-01T18:00:00Z'),
    );
    expect(new Date(start).toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(end - start + 1).toBe(25 * 3600000);
  });
});
describe('CSV reconciliation', () => {
  it('reads quoted commas and retains exact SKU matching', () => {
    const csv = readCsv(
      'order_id,sku,price,marketplace,title\nWN1,SKU-1,50,Whatnot,"Jacket, vintage"',
    );
    expect(csv.rows[0].title).toBe('Jacket, vintage');
    const p = planImport(
      'Sales',
      csv.rows,
      Object.fromEntries(csv.columns.map((c) => [c, c])),
      fixture(),
    );
    expect(p.errors).toEqual([]);
    expect(p.commands).toHaveLength(1);
  });
  it('groups multi-item orders and skips overlapping weekly reports', () => {
    const csv = readCsv('order_id,sku,price,fees\nWN1,SKU-1,50,2\nWN1,SKU-2,40,1');
    const map = Object.fromEntries(csv.columns.map((c) => [c, c]));
    let w = fixture();
    const p = planImport('Sales', csv.rows, map, w);
    expect(p.commands).toHaveLength(1);
    w = p.commands.reduce(applyCommand, w);
    expect(w.orders[0].fees).toBe(300);
    expect(w.orders[0].lines).toHaveLength(2);
    expect(planImport('Sales', csv.rows, map, w).duplicates).toBe(1);
  });
  it('does not guess inventory or import ambiguous rows', () => {
    const p = planImport(
      'Sales',
      [{ order_id: 'WN1', sku: 'UNKNOWN', price: '50' }],
      { order_id: 'order_id', sku: 'sku', price: 'price' },
      fixture(),
    );
    expect(p.commands).toHaveLength(0);
    expect(p.errors[0]).toContain('Unmatched SKU');
  });
  it('guards CSV exports against spreadsheet formula injection', () =>
    expect(csvText([{ title: '=HYPERLINK("bad")' }])).toContain("'=HYPERLINK"));
});
