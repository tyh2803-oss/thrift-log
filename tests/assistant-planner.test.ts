import { describe, it, expect } from 'vitest';
import { matchInventory } from '../src/lib/assistant/matching';
import { createBatch } from '../src/lib/assistant/drafts';
import { previewBatch, importDate } from '../src/lib/assistant/planner';
import { applyCommand } from '../src/lib/commands';
import { metrics } from '../src/lib/finance';
import { extractedSale, extractedLine, assistantWorkspace } from './helpers/assistant';
const hash = 'a'.repeat(64);
const batch = (
  record = extractedSale({ lines: [extractedLine({ listingId: 'listing-1' })] }),
  w = assistantWorkspace(),
) => createBatch([{ hash, name: 'sale.png', extraction: { records: [record], message: '' } }], w);
describe('inventory matching', () => {
  it('prefers an exact scoped listing ID over a different SKU or approximate description', () => {
    const w = assistantWorkspace();
    expect(
      matchInventory(
        w,
        extractedSale(),
        extractedLine({ listingId: 'listing-1', sku: 'missing' }),
      )[0],
    ).toMatchObject({ exact: true, item: { id: w.items[0].id } });
    expect(
      matchInventory(
        w,
        extractedSale({ marketplace: 'eBay' }),
        extractedLine({ listingId: 'listing-1' }),
      )[0].exact,
    ).toBe(false);
  });
  it('uses exact SKUs and URLs, retaining punctuation in SKUs', () => {
    const w = assistantWorkspace();
    expect(matchInventory(w, extractedSale(), extractedLine({ sku: 'jacket-1' }))[0].exact).toBe(
      true,
    );
    expect(matchInventory(w, extractedSale(), extractedLine({ sku: 'JACKET/1' }))[0].exact).toBe(
      false,
    );
    expect(
      matchInventory(
        w,
        extractedSale(),
        extractedLine({ url: 'https://vinted.test/items/1?ref=screen' }),
      )[0].exact,
    ).toBe(true);
  });
  it('suggests similar descriptions and leaves approximate/ambiguous matches unselected', () => {
    const w = assistantWorkspace();
    w.items.push({ ...w.items[0], id: crypto.randomUUID(), sku: 'JACKET-2' });
    const candidates = matchInventory(w, extractedSale(), extractedLine());
    expect(candidates).toHaveLength(2);
    expect(candidates.every((c) => !c.exact)).toBe(true);
    expect(batch(extractedSale(), w).rows[0].matches[0].itemId).toBeNull();
    expect(
      matchInventory(
        w,
        extractedSale(),
        extractedLine({ title: 'red boots', brand: 'Nike', color: 'red', size: '7' }),
      ),
    ).toHaveLength(0);
  });
});
describe('sales preparation and existing financial logic', () => {
  it('prepares without mutating the workspace, retrieves cost, and computes $26 profit', () => {
    const w = assistantWorkspace(),
      before = JSON.stringify(w);
    const b = batch();
    const p = previewBatch(w, b)[0];
    expect(JSON.stringify(w)).toBe(before);
    expect(p.ready).toBe(true);
    expect(p.costs).toEqual([1200]);
    expect(p.totals?.profit).toBe(2600);
    const next = p.commands.reduce(applyCommand, w);
    expect(metrics(next, 0, Infinity).profit).toBe(2600);
    expect(next.items[0].status).toBe('Sold');
    expect(next.listings.map((l) => l.status)).toEqual(['Sold', 'Needs delisting']);
  });
  it('accounts for seller-received shipping, discounts, processing and direct costs', () => {
    const p = previewBatch(
      assistantWorkspace(),
      batch(
        extractedSale({
          lines: [extractedLine({ listingId: 'listing-1' })],
          shippingCollected: 500,
          discount: 200,
          processing: 100,
          other: 50,
        }),
      ),
    )[0];
    expect(p.totals).toMatchObject({ revenue: 4800, profit: 2750 });
  });
  it('never treats unknown purchase costs or legacy zero costs as free inventory', () => {
    const w = assistantWorkspace();
    w.items[0].cost = 0;
    const b = batch(undefined, w);
    expect(previewBatch(w, b)[0]).toMatchObject({ ready: false, costs: [null], totals: null });
    b.rows[0].matches[0].confirmZeroCost = true;
    expect(previewBatch(w, b)[0]).toMatchObject({ ready: true, costs: [0] });
    b.rows[0].matches[0].itemId = null;
    expect(previewBatch(w, b)[0].ready).toBe(false);
  });
  it('labels missing fees/shipping as unresolved while allowing a provisional estimate', () => {
    const p = previewBatch(
      assistantWorkspace(),
      batch(
        extractedSale({
          lines: [extractedLine({ listingId: 'listing-1' })],
          fees: null,
          shipping: null,
        }),
      ),
    )[0];
    expect(p.ready).toBe(false);
    expect(p.commands).toHaveLength(0);
    expect(p.issues.join(' ')).toMatch(/fees is unknown/);
    expect(p.totals?.profit).toBe(3300);
  });
  it.each(['offer', 'pending', 'refunded', 'unknown'] as const)(
    'does not record status %s',
    (status) => {
      expect(
        previewBatch(
          assistantWorkspace(),
          batch(extractedSale({ status, lines: [extractedLine({ listingId: 'listing-1' })] })),
        )[0].ready,
      ).toBe(false);
    },
  );
  it('detects external orders and physical items already sold, including manual/CSV entries', () => {
    const w = assistantWorkspace();
    const b = batch();
    const p = previewBatch(w, b)[0];
    const next = p.commands.reduce(applyCommand, w);
    const duplicate = previewBatch(next, batch())[0];
    expect(duplicate.ready).toBe(false);
    expect(duplicate.duplicateKind).toBe('order');
    expect(
      previewBatch(
        next,
        batch(
          extractedSale({
            externalOrderId: null,
            lines: [extractedLine({ listingId: 'listing-1' })],
          }),
        ),
      )[0].ready,
    ).toBe(false);
  });
  it('keeps shared fees/shipping once for multi-item orders with exact-cent allocations', () => {
    const w = assistantWorkspace();
    w.items.push({ ...w.items[0], id: crypto.randomUUID(), sku: 'JACKET-2', cost: 1000 });
    const b = batch(
      extractedSale({
        lines: [
          extractedLine({ sku: 'JACKET-1', price: 1000 }),
          extractedLine({ sku: 'JACKET-2', price: 2000 }),
        ],
        fees: 101,
        shipping: 299,
      }),
      w,
    );
    const p = previewBatch(w, b)[0];
    expect(p.ready).toBe(true);
    expect(p.commands).toHaveLength(1);
    expect(p.totals?.profit).toBe(400);
    expect(p.profits.reduce((n, l) => n + l.profit, 0)).toBe(400);
  });
  it('blocks duplicate screenshot/order rows inside one batch', () => {
    const w = assistantWorkspace();
    const b = batch();
    b.rows.push({ ...structuredClone(b.rows[0]), id: crypto.randomUUID() });
    const p = previewBatch(w, b);
    expect(p.filter((v) => v.ready)).toHaveLength(1);
  });
  it('rejects invalid dates and interprets date-only values in the workspace timezone', () => {
    expect(importDate('2026-02-30', 'America/New_York')).toBeNull();
    expect(importDate('2026-11-08', 'America/New_York')).toBe('2026-11-08T05:00:00.000Z');
    expect(importDate('2026-11-08T12:00:00', 'America/New_York')).toBeNull();
  });
});
