import { it, expect } from 'vitest';
import { assistantWorkspace, extractedSale, extractedLine } from './helpers/assistant';
import { createBatch, batchSchema } from '../src/lib/assistant/drafts';
import {
  listingAmount,
  listingPotential,
  changeListingCost,
  changeListingPrice,
} from '../src/lib/assistant/listing-review';
import { approvalCommands, previewBatch } from '../src/lib/assistant/planner';
import { applyCommand } from '../src/lib/commands';
const setup = (matched = false) => {
  const w = assistantWorkspace();
  const batch = createBatch(
    [
      {
        hash: 'e'.repeat(64),
        name: 'listings.png',
        extraction: {
          message: '',
          records: [
            extractedSale({
              kind: 'listing',
              status: 'active',
              externalOrderId: null,
              marketplace: 'eBay',
              lines: [
                extractedLine({
                  sku: matched ? w.items[0].sku : null,
                  title: 'Collegiate jacket',
                  price: 4000,
                }),
              ],
            }),
          ],
        },
      },
    ],
    w,
  );
  return { w, batch };
};
it('parses mobile decimal text exactly and distinguishes unknown, explicit zero and invalid amounts', () => {
  expect(listingAmount('')).toEqual({ value: null, error: null });
  expect(listingAmount('0')).toEqual({ value: 0, error: null });
  expect(listingAmount('12.30').value).toBe(1230);
  expect(listingAmount('.50').value).toBe(50);
  for (const value of ['-1', '1e3', '2.001', '1000000.01', 'hello', '12.'])
    expect(listingAmount(value).error).toBeTruthy();
});
it('recalculates gross and configured net in cents without treating missing expenses as zero', () => {
  const { w, batch } = setup();
  const before = structuredClone(w);
  let row = batch.rows[0];
  expect(listingPotential(w, row, 0)).toEqual({ cost: null, gross: null, net: null });
  row = changeListingCost(w, row, 0, '12.34');
  expect(listingPotential(w, row, 0)).toEqual({ cost: 1234, gross: 2766, net: null });
  row = changeListingPrice(row, 0, '10.01');
  w.settings.estimatedSellingExpenses = 200;
  expect(listingPotential(w, row, 0)).toEqual({ cost: 1234, gross: -233, net: -433 });
  w.settings.estimatedSellingExpenses = 0;
  expect(listingPotential(w, row, 0).net).toBe(-233);
  expect(w.items).toEqual(before.items);
  expect(w.listings).toEqual(before.listings);
});
it('retains cost entry before explicit new-item creation and rejects incomplete/invalid drafts', () => {
  const { w, batch } = setup();
  let row = changeListingCost(w, batch.rows[0], 0, '0');
  row.matches[0].newItem = {
    id: crypto.randomUUID(),
    sku: 'INLINE-NEW',
    purchasedAt: '2026-10-01',
    cost: row.matches[0].purchaseCost!,
    confirmedDistinct: true,
  };
  batch.rows[0] = row;
  expect(previewBatch(w, batch)[0].ready).toBe(true);
  row = changeListingCost(w, row, 0, '');
  batch.rows[0] = row;
  expect(listingPotential(w, row, 0).cost).toBeNull();
  expect(previewBatch(w, batch)[0].ready).toBe(false);
  row = changeListingCost(w, row, 0, '0.001');
  batch.rows[0] = row;
  expect(() => approvalCommands(w, batch, [row.id])).toThrow('two decimals');
});
it('preserves stored costs unless a correction is explicitly proposed and approved', () => {
  const { w, batch } = setup(true);
  const before = structuredClone(w.items[0]);
  expect(listingPotential(w, batch.rows[0], 0).cost).toBe(1200);
  expect(() => changeListingCost(w, batch.rows[0], 0, '15')).toThrow('Correct cost');
  batch.rows[0].matches[0].costCorrection = true;
  batch.rows[0] = changeListingCost(w, batch.rows[0], 0, '15');
  expect(listingPotential(w, batch.rows[0], 0).gross).toBe(2500);
  expect(w.items[0]).toEqual(before);
  const saved = approvalCommands(w, batch, [batch.rows[0].id]).reduce(applyCommand, w);
  expect(saved.items).toHaveLength(1);
  expect(saved.items[0]).toEqual({ ...before, cost: 1500 });
  expect(saved.listings).toHaveLength(3);
});
it('edits independent cards, persists pending strings and notes, and saves only approved data', () => {
  const { w, batch } = setup();
  const second = structuredClone(batch.rows[0]);
  second.id = crypto.randomUUID();
  second.recordIndex = 1;
  batch.screenshots[0].extraction.records.push(structuredClone(second.facts));
  batch.rows.push(second);
  batch.rows[0] = changeListingCost(w, batch.rows[0], 0, '10.25');
  batch.rows[1] = changeListingPrice(batch.rows[1], 0, '22.50');
  expect(listingPotential(w, batch.rows[0], 0).gross).toBe(2975);
  expect(listingPotential(w, batch.rows[1], 0).cost).toBeNull();
  expect(batchSchema.parse(JSON.parse(JSON.stringify(batch)))).toEqual(batch);
});
it('allows an intentional cost correction alongside an unchanged listing without duplicating it', () => {
  const { w, batch } = setup(true);
  batch.rows[0].facts.marketplace = 'Vinted';
  batch.rows[0].facts.lines[0].price = w.listings[0].price;
  batch.rows[0].facts.lines[0].listingId = w.listings[0].externalId;
  batch.rows[0].matches[0].costCorrection = true;
  batch.rows[0] = changeListingCost(w, batch.rows[0], 0, '14');
  const saved = approvalCommands(w, batch, [batch.rows[0].id]).reduce(applyCommand, w);
  expect(saved.items[0].cost).toBe(1400);
  expect(saved.listings).toHaveLength(w.listings.length);
});

it('blocks contradictory cost corrections for cross-listings of one physical item', () => {
  const { w, batch } = setup(true);
  const second = structuredClone(batch.rows[0]);
  second.id = crypto.randomUUID();
  second.recordIndex = 1;
  second.facts.marketplace = 'Whatnot';
  batch.screenshots[0].extraction.records.push(structuredClone(second.facts));
  batch.rows.push(second);
  for (const row of batch.rows) row.matches[0].costCorrection = true;
  batch.rows[0] = changeListingCost(w, batch.rows[0], 0, '13');
  batch.rows[1] = changeListingCost(w, batch.rows[1], 0, '14');
  expect(
    previewBatch(w, batch).every(
      (p) => !p.ready && p.issues.some((s) => s.includes('Conflicting acquisition-cost')),
    ),
  ).toBe(true);
});
it('requires intentional entry for legacy zero costs and permits explicit corrections in item-context scans', () => {
  const { w, batch } = setup(true);
  w.items[0].cost = 0;
  batch.context = { itemId: w.items[0].id };
  expect(listingPotential(w, batch.rows[0], 0).cost).toBeNull();
  batch.rows[0] = changeListingCost(w, batch.rows[0], 0, '15');
  expect(batch.rows[0].matches[0].costCorrection).toBe(true);
  expect(previewBatch(w, batch)[0].ready).toBe(true);
  expect(w.items[0].cost).toBe(0);
});
