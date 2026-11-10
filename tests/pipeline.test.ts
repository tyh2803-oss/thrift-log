import { describe, it, expect } from 'vitest';
import {
  emptyWorkspace,
  itemSchema,
  orderSchema,
  listingSchema,
  type Workspace,
  type Order,
} from '../src/lib/model';
import { applyCommand } from '../src/lib/commands';
import { inventoryPipeline, pipelineValue } from '../src/lib/pipeline';
import { setItemFulfillment } from '../src/lib/fulfillment-state';
import { createBatch } from '../src/lib/assistant/drafts';
import { approvalCommands } from '../src/lib/assistant/planner';
import { extractedSale, extractedLine } from './helpers/assistant';
const date = '2026-11-01T12:00:00Z';
function stock(w = emptyWorkspace(), patch: Record<string, unknown> = {}) {
  const item = itemSchema.parse({
    id: crypto.randomUUID(),
    sku: crypto.randomUUID(),
    title: 'Test jacket',
    cost: 1200,
    asking: 4500,
    purchasedAt: date,
    createdAt: date,
    status: 'Purchased',
    ...patch,
  });
  return applyCommand(w, { type: 'item', value: item });
}
function list(
  w: Workspace,
  itemId = w.items[0].id,
  price = 4500,
  marketplace: 'Vinted' | 'Depop' | 'Whatnot' = 'Vinted',
) {
  return applyCommand(w, {
    type: 'listing',
    value: listingSchema.parse({
      id: crypto.randomUUID(),
      itemId,
      marketplace,
      price,
      originalPrice: price,
      listedAt: date,
      status: 'Active',
    }),
  });
}
function sell(w: Workspace, patch: Partial<Order> = {}) {
  return applyCommand(w, {
    type: 'order',
    value: orderSchema.parse({
      id: crypto.randomUUID(),
      marketplace: 'Vinted',
      date,
      lines: [{ itemId: w.items[0].id, price: 4500, costBasis: w.items[0].cost }],
      discount: 0,
      shippingCollected: 0,
      fees: 400,
      processing: 0,
      shipping: 300,
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
      amountsConfirmed: true,
      ...patch,
    }),
  });
}
const group = (w: Workspace, key: 'unlisted' | 'for-sale' | 'sold' | 'shipped') =>
  inventoryPipeline(w).groups[key];
describe('physical lifecycle precedence', () => {
  it('moves a unique piece from unlisted to for sale to sold to shipped, with delivered retained', () => {
    let w = stock();
    expect(group(w, 'unlisted').count).toBe(1);
    w = list(w);
    w = list(w, w.items[0].id, 5000, 'Depop');
    expect(group(w, 'for-sale')).toMatchObject({ count: 1, activeListings: 2 });
    expect(pipelineValue(group(w, 'for-sale'), 'sale').value).toBe(4500);
    w = sell(w);
    expect(group(w, 'for-sale').count).toBe(0);
    expect(group(w, 'sold').count).toBe(1);
    w = applyCommand(w, { type: 'order', value: { ...w.orders[0], fulfillment: 'Shipped' } });
    expect(group(w, 'shipped').count).toBe(1);
    w = applyCommand(w, { type: 'order', value: { ...w.orders[0], fulfillment: 'Delivered' } });
    expect(group(w, 'shipped').count).toBe(1);
  });
  it('prefers completed orders over stale active listings/item status and excludes archived stock', () => {
    const w = sell(list(stock()));
    w.items[0].status = 'Listed';
    w.listings[0].status = 'Active';
    expect(group(w, 'sold').count).toBe(1);
    expect(group(w, 'for-sale').count).toBe(0);
    w.items[0].status = 'Archived';
    expect(inventoryPipeline(w).entries).toHaveLength(0);
    expect(inventoryPipeline(w).archived).toBe(1);
  });
  it('keeps reserved Whatnot stock in its actual listing position', () => {
    let w = stock();
    w = applyCommand(w, {
      type: 'show',
      value: {
        id: crypto.randomUUID(),
        name: 'Show',
        date,
        type: 'Whatnot',
        status: 'Planned',
        notes: '',
        externalId: '',
        checklist: [],
        lineup: [{ itemId: w.items[0].id, startingBid: 0, presented: false }],
        durationMinutes: 0,
      },
    });
    expect(group(w, 'unlisted')).toMatchObject({ count: 1, reserved: 1 });
    w = list(w, w.items[0].id, 4500, 'Whatnot');
    expect(group(w, 'for-sale')).toMatchObject({ count: 1, reserved: 1 });
  });
  it('counts physical lines for multi-item orders, partial shipments and grouped packages', () => {
    let w = stock(stock());
    w = sell(w, { lines: w.items.map((i) => ({ itemId: i.id, price: 4500, costBasis: i.cost })) });
    expect(group(w, 'sold')).toMatchObject({ count: 2, orders: 1 });
    w = applyCommand(w, {
      type: 'order',
      value: setItemFulfillment(w.orders[0], w.items[0].id, 'Shipped', '2026-11-02T12:00:00Z'),
    });
    expect(group(w, 'shipped').count).toBe(1);
    expect(group(w, 'sold').count).toBe(1);
    expect(w.orders[0].fulfillment).toBe('Unfulfilled');
    w = applyCommand(w, {
      type: 'order',
      value: setItemFulfillment(w.orders[0], w.items[1].id, 'Delivered', '2026-11-02T12:00:00Z'),
    });
    expect(group(w, 'shipped').count).toBe(2);
    let grouped = stock(stock());
    grouped = sell(grouped);
    grouped = sell(grouped, {
      lines: [{ itemId: grouped.items[1].id, price: 4500, costBasis: 1200 }],
    });
    grouped = applyCommand(grouped, {
      type: 'shipment',
      value: {
        id: crypto.randomUUID(),
        marketplace: 'Vinted',
        date: '2026-11-02T12:00:00Z',
        orderIds: grouped.orders.map((o) => o.id),
        carrier: '',
        tracking: '',
        status: 'Delivered',
        labelCost: 0,
        notes: '',
        allocatedShipping: false,
      },
    });
    expect(group(grouped, 'shipped')).toMatchObject({ count: 2, orders: 2 });
  });
  it('distinguishes handover from shipment and does not auto-fulfill an in-person sale', () => {
    let w = sell(stock(), { marketplace: 'In person' });
    expect(group(w, 'sold').count).toBe(1);
    w = applyCommand(w, {
      type: 'order',
      value: setItemFulfillment(w.orders[0], w.items[0].id, 'Handed over', '2026-11-02T12:00:00Z'),
    });
    expect(group(w, 'shipped')).toMatchObject({ count: 1, handedOver: 1 });
    expect(group(w, 'shipped').entries[0].fulfillment).toBe('Handed over');
  });
  it('restores cancellations, holds physical returns for restocking, and uses the current resale cycle', () => {
    let cancelled = sell(stock());
    cancelled = applyCommand(cancelled, {
      type: 'order',
      value: { ...cancelled.orders[0], status: 'Cancelled' },
    });
    expect(group(cancelled, 'unlisted').count).toBe(1);
    let w = sell(stock());
    const first = w.orders[0];
    w = applyCommand(w, {
      type: 'financialEvent',
      value: {
        id: crypto.randomUUID(),
        orderId: first.id,
        date: '2026-11-02T12:00:00Z',
        kind: 'Return',
        amount: 0,
        reason: 'Physical return',
        itemIds: [w.items[0].id],
        externalId: '',
        reversesId: null,
        category: 'Other',
      },
    });
    expect(inventoryPipeline(w).restocking).toHaveLength(1);
    expect(group(w, 'unlisted').count).toBe(0);
    w = applyCommand(w, { type: 'item', value: { ...w.items[0], status: 'Ready to List' } });
    expect(group(w, 'unlisted').count).toBe(1);
    w = list(w);
    expect(group(w, 'for-sale').count).toBe(1);
    w = sell(w, { date: '2026-11-03T12:00:00Z' });
    expect(group(w, 'sold').count).toBe(1);
    expect(group(w, 'sold').entries[0].order!.id).not.toBe(first.id);
  });
});
describe('Cost | Sale Value | Profit', () => {
  it('counts cost and asking once, excludes missing estimates, and uses explicit selling expense estimates', () => {
    let w = stock(stock(), { asking: 0 });
    w = list(w, w.items[0].id, 5000);
    w = list(w, w.items[0].id, 4000, 'Depop');
    expect(pipelineValue(group(w, 'for-sale'), 'cost')).toMatchObject({ value: 1200, missing: 0 });
    expect(pipelineValue(group(w, 'for-sale'), 'sale')).toMatchObject({
      value: 4000,
      label: 'Asking value',
    });
    expect(pipelineValue(group(w, 'for-sale'), 'profit')).toMatchObject({
      value: null,
      missing: 1,
      label: 'Potential Profit',
    });
    w.settings.estimatedSellingExpenses = 500;
    expect(pipelineValue(group(w, 'for-sale'), 'profit').value).toBe(2300);
    expect(pipelineValue(group(w, 'unlisted'), 'sale')).toMatchObject({ value: null, missing: 1 });
    expect(pipelineValue(group(w, 'unlisted'), 'profit')).toMatchObject({
      value: null,
      missing: 1,
    });
  });
  it('excludes buyer shipping/tips from merchandise while including recorded income in realized profit', () => {
    const w = sell(stock(), { shippingCollected: 500, tips: 200 });
    expect(pipelineValue(group(w, 'sold'), 'sale').value).toBe(4500);
    expect(pipelineValue(group(w, 'sold'), 'profit')).toMatchObject({
      value: 3300,
      label: 'Realized Profit',
    });
  });
  it('allocates shared fees, discounts and partial refunds by the existing exact-cent ledger', () => {
    let w = stock(stock());
    w = sell(w, {
      lines: [
        { itemId: w.items[0].id, price: 1000, costBasis: 1200 },
        { itemId: w.items[1].id, price: 2000, costBasis: 1200 },
      ],
      fees: 101,
      shipping: 299,
      discount: 100,
    });
    const order = w.orders[0];
    w = applyCommand(w, {
      type: 'financialEvent',
      value: {
        id: crypto.randomUUID(),
        orderId: order.id,
        date: '2026-11-02T12:00:00Z',
        kind: 'Refund',
        amount: 301,
        reason: 'Partial refund, no physical return',
        itemIds: [],
        externalId: '',
        reversesId: null,
        category: 'Other',
      },
    });
    expect(pipelineValue(group(w, 'sold'), 'sale').value).toBe(2599);
    expect(pipelineValue(group(w, 'sold'), 'profit')).toMatchObject({
      value: -201,
      label: 'Realized Profit',
    });
    w = applyCommand(w, {
      type: 'order',
      value: setItemFulfillment(w.orders[0], w.items[0].id, 'Shipped', '2026-11-03T12:00:00Z'),
    });
    expect(
      pipelineValue(group(w, 'sold'), 'profit').value! +
        pipelineValue(group(w, 'shipped'), 'profit').value!,
    ).toBe(-201);
  });
  it('marks legacy financial zeros provisional and zero acquisition costs unknown', () => {
    const w = sell(stock(), { amountsConfirmed: false });
    expect(pipelineValue(group(w, 'sold'), 'profit')).toMatchObject({
      value: 2600,
      label: 'Provisional Profit',
      provisional: 1,
    });
    const missing = stock(undefined, { cost: 0 });
    expect(pipelineValue(group(missing, 'unlisted'), 'cost')).toMatchObject({
      value: null,
      missing: 1,
    });
  });
  it('does not guess merchandise attribution for a refund involving buyer shipping', () => {
    const w = sell(stock(), { shippingCollected: 500, refund: 200 });
    expect(pipelineValue(group(w, 'sold'), 'sale')).toMatchObject({ value: null, missing: 1 });
    expect(pipelineValue(group(w, 'sold'), 'profit').value).toBe(2900);
  });
  it('derives AI-imported listing and sale transitions without changing any financial record', () => {
    let w = stock();
    w.items[0].sku = 'VISION-1';
    const listing = extractedSale({
      kind: 'listing',
      status: 'active',
      lines: [extractedLine({ sku: 'VISION-1', listingId: 'AI-1' })],
    });
    let b = createBatch(
      [
        {
          hash: 'a'.repeat(64),
          name: 'listing.png',
          extraction: { records: [listing], message: '' },
        },
      ],
      w,
    );
    w = approvalCommands(w, b, [b.rows[0].id]).reduce(applyCommand, w);
    expect(group(w, 'for-sale').count).toBe(1);
    b = createBatch(
      [
        {
          hash: 'b'.repeat(64),
          name: 'sale.png',
          extraction: {
            records: [extractedSale({ lines: [extractedLine({ listingId: 'AI-1' })] })],
            message: '',
          },
        },
      ],
      w,
    );
    w = approvalCommands(w, b, [b.rows[0].id]).reduce(applyCommand, w);
    const before = JSON.stringify(w),
      snapshot = inventoryPipeline(w);
    expect(snapshot.groups.sold.count).toBe(1);
    for (const mode of ['cost', 'sale', 'profit'] as const)
      pipelineValue(snapshot.groups.sold, mode);
    expect(JSON.stringify(w)).toBe(before);
    expect(() => approvalCommands(w, b, [b.rows[0].id])).toThrow();
  });
});
it('validates item fulfillment relationships and keeps legacy global changes compatible', () => {
  let w = sell(stock(stock()));
  const o = w.orders[0];
  expect(() =>
    applyCommand(w, {
      type: 'order',
      value: {
        ...o,
        itemFulfillments: [{ itemId: crypto.randomUUID(), status: 'Shipped', date: null }],
      },
    }),
  ).toThrow('not in this order');
  w = applyCommand(w, {
    type: 'order',
    value: setItemFulfillment(o, w.items[0].id, 'Shipped', '2026-11-02T12:00:00Z'),
  });
  w = applyCommand(w, { type: 'order', value: { ...w.orders[0], fulfillment: 'Delivered' } });
  expect(w.orders[0].itemFulfillments).toEqual([]);
  expect(group(w, 'shipped').count).toBe(1);
});
it('can reset the only fulfilled item without retaining a shipped rollup', () => {
  let w = sell(stock(), { fulfillment: 'Shipped' });
  w = applyCommand(w, {
    type: 'order',
    value: setItemFulfillment(w.orders[0], w.items[0].id, 'Unfulfilled', '2026-11-02T12:00:00Z'),
  });
  expect(group(w, 'sold').count).toBe(1);
  expect(w.orders[0].fulfillment).toBe('Unfulfilled');
});
