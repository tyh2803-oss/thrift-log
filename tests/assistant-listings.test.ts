import { describe, it, expect } from 'vitest';
import { assistantWorkspace, extractedLine, extractedSale } from './helpers/assistant';
import { createBatch } from '../src/lib/assistant/drafts';
import { approvalCommands, previewBatch } from '../src/lib/assistant/planner';
import { applyCommand } from '../src/lib/commands';
import { metrics } from '../src/lib/finance';
import type { ExtractedRecord } from '../src/lib/assistant/schema';
const listing = (patch: Partial<ExtractedRecord> = {}) =>
  extractedSale({
    kind: 'listing',
    status: 'active',
    externalOrderId: null,
    lines: [extractedLine({ listingId: 'listing-1', price: 4800 })],
    ...patch,
  });
const makeBatch = (record = listing(), w = assistantWorkspace()) =>
  createBatch(
    [{ hash: 'c'.repeat(64), name: 'listing.png', extraction: { records: [record], message: '' } }],
    w,
  );
describe('listing imports share physical inventory', () => {
  it('updates an existing listing and preserves its original price and physical cost', () => {
    const w = assistantWorkspace(),
      b = makeBatch();
    const p = previewBatch(w, b)[0];
    expect(p.ready).toBe(true);
    const next = approvalCommands(w, b, [b.rows[0].id]).reduce(applyCommand, w);
    expect(next.items).toHaveLength(1);
    expect(next.listings).toHaveLength(2);
    expect(next.listings[0]).toMatchObject({ price: 4800, originalPrice: 5000 });
    expect(metrics(next).inventoryCost).toBe(1200);
    expect(next.orders).toHaveLength(0);
  });
  it('adds another marketplace listing without duplicating inventory', () => {
    const w = assistantWorkspace(),
      b = makeBatch(
        listing({
          marketplace: 'eBay',
          lines: [extractedLine({ sku: 'JACKET-1', listingId: 'ebay-1' })],
        }),
      );
    const next = approvalCommands(w, b, [b.rows[0].id]).reduce(applyCommand, w);
    expect(next.items).toHaveLength(1);
    expect(next.listings).toHaveLength(3);
    expect(metrics(next).inventoryCost).toBe(1200);
  });
  it('accepts repeated listing screens and source IDs while keeping dates and stored identities correct', () => {
    expect(
      previewBatch(
        assistantWorkspace(),
        makeBatch(listing({ lines: [extractedLine({ listingId: 'listing-1', price: 4500 })] })),
      )[0],
    ).toMatchObject({ ready: true, duplicateKind: null });
    const b = makeBatch(
      listing({ lines: [extractedLine({ sku: 'JACKET-1', listingId: 'different-id' })] }),
    );
    expect(previewBatch(assistantWorkspace(), b)[0].ready).toBe(true);
    const update = makeBatch(listing({ date: null }));
    expect(previewBatch(assistantWorkspace(), update)[0].ready).toBe(true);
    const add = makeBatch(
      listing({
        date: null,
        marketplace: 'eBay',
        lines: [extractedLine({ sku: 'JACKET-1', listingId: 'ebay-1' })],
      }),
    );
    expect(previewBatch(assistantWorkspace(), add)[0].ready).toBe(true);
    const planned = previewBatch(assistantWorkspace(), add)[0].commands.find(
      (c) => c.type === 'listing',
    );
    expect(planned?.value).toHaveProperty('listedAt');
  });
  it('requires a known acquisition cost and valid date without a duplicate-confirmation checkbox', () => {
    const w = assistantWorkspace(),
      b = makeBatch(
        listing({
          lines: [
            extractedLine({
              title: 'Red boots',
              brand: 'Other',
              size: '7',
              color: 'Red',
              listingId: 'boots-1',
            }),
          ],
        }),
      );
    b.rows[0].matches[0] = {
      itemId: null,
      confirmZeroCost: false,
      newItem: {
        id: crypto.randomUUID(),
        sku: 'BOOTS-1',
        cost: null,
        purchasedAt: '',
        confirmedDistinct: false,
      },
    };
    expect(previewBatch(w, b)[0].ready).toBe(false);
    b.rows[0].matches[0].newItem = {
      ...b.rows[0].matches[0].newItem!,
      cost: 1500,
      purchasedAt: '2026-10-02',
      confirmedDistinct: true,
    };
    const p = previewBatch(w, b)[0];
    expect(p.ready).toBe(true);
    expect(p.commands.map((c) => c.type)).toEqual(['item', 'listing']);
    const next = approvalCommands(w, b, [b.rows[0].id]).reduce(applyCommand, w);
    expect(next.items).toHaveLength(2);
    expect(next.listings).toHaveLength(3);
    expect(metrics(next).inventoryCost).toBe(2700);
    expect(next.items[1].condition).toBe('');
    expect(next.items[1].source).toBe('');
  });
  it('allows an explicitly chosen new physical item when a source identifier repeats', () => {
    const w = assistantWorkspace(),
      b = makeBatch();
    b.rows[0].matches[0] = {
      itemId: null,
      confirmZeroCost: false,
      newItem: {
        id: crypto.randomUUID(),
        sku: 'OTHER-SKU',
        cost: 1500,
        purchasedAt: '2026-10-02',
        confirmedDistinct: true,
      },
    };
    expect(previewBatch(w, b)[0].ready).toBe(true);
    const saved = approvalCommands(w, b, [b.rows[0].id]).reduce(applyCommand, w);
    expect(saved.items).toHaveLength(2);
    expect(saved.listings[0]).toEqual(w.listings[0]);
  });
  it('keeps repeated source SKUs with new internal identifiers and preserves unknown zero cost', () => {
    const w = assistantWorkspace(),
      b = makeBatch(listing({ lines: [extractedLine({ title: 'Boots', listingId: 'boots-1' })] }));
    b.rows[0].matches[0] = {
      itemId: null,
      confirmZeroCost: false,
      newItem: {
        id: crypto.randomUUID(),
        sku: 'JACKET-1',
        cost: 1500,
        purchasedAt: '2026-10-02',
        confirmedDistinct: true,
      },
    };
    expect(previewBatch(w, b)[0].ready).toBe(true);
    const saved = approvalCommands(w, b, [b.rows[0].id]).reduce(applyCommand, w);
    expect(new Set(saved.items.map((i) => i.sku)).size).toBe(2);
    w.items[0].cost = 0;
    const zero = makeBatch(undefined, w);
    zero.rows[0].matches[0].costOverride = null;
    expect(previewBatch(w, zero)[0].costs).toEqual([null]);
  });
  it('can create a missing inventory item and its sale together after explicit cost review', () => {
    const w = assistantWorkspace(),
      b = makeBatch(
        extractedSale({
          lines: [extractedLine({ title: 'Red boots', brand: 'Other', listingId: 'boots-1' })],
        }),
      );
    b.rows[0].matches[0] = {
      itemId: null,
      confirmZeroCost: false,
      newItem: {
        id: crypto.randomUUID(),
        sku: 'BOOTS-1',
        cost: 1500,
        purchasedAt: '2026-10-02',
        confirmedDistinct: true,
      },
    };
    const next = approvalCommands(w, b, [b.rows[0].id]).reduce(applyCommand, w);
    expect(next.items[1].status).toBe('Sold');
    expect(next.orders[0].lines[0].costBasis).toBe(1500);
  });
  it('corrects current purchase cost only on approval and snapshots it into the new sale', () => {
    const w = assistantWorkspace(),
      b = makeBatch(extractedSale({ lines: [extractedLine({ listingId: 'listing-1' })] }));
    b.rows[0].matches[0].costOverride = 1400;
    expect(previewBatch(w, b)[0].totals?.profit).toBe(2400);
    expect(w.items[0].cost).toBe(1200);
    const next = approvalCommands(w, b, [b.rows[0].id]).reduce(applyCommand, w);
    expect(next.items[0].cost).toBe(1400);
    expect(next.orders[0].lines[0].costBasis).toBe(1400);
  });
});
