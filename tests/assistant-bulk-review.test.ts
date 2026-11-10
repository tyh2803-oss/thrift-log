import { expect, it } from 'vitest';
import { assistantWorkspace, extractedLine, extractedSale } from './helpers/assistant';
import { batchSchema, createBatch } from '../src/lib/assistant/drafts';
import { emptyWorkspace } from '../src/lib/model';
import { applyCommand } from '../src/lib/commands';
import { approvalCommands, previewBatch } from '../src/lib/assistant/planner';
import { changeListingCost, listingCost } from '../src/lib/assistant/listing-review';
import {
  applyBatchCost,
  eligiblePhysicalDrafts,
  setBatchAcquisitionDate,
  updateReviewRow,
  reconcileApprovedDrafts,
} from '../src/lib/assistant/review-bulk';
import { localDay } from '../src/lib/dates';
import { inventoryPipeline } from '../src/lib/pipeline';

function listings(w = emptyWorkspace(), crossListed = false) {
  const records = Array.from({ length: 4 }, (_, i) =>
    extractedSale({
      kind: 'listing',
      status: 'active',
      date: null,
      externalOrderId: null,
      marketplace: crossListed && i === 1 ? 'Depop' : 'Vinted',
      lines: [
        extractedLine({
          title: `New garment ${i}`,
          sku: crossListed && i < 2 ? 'SHARED' : `UNIQUE-${i}`,
          listingId: `bulk-${i}`,
          price: 2650,
        }),
      ],
    }),
  );
  return createBatch(
    [{ hash: 'f'.repeat(64), name: 'four.png', extraction: { message: '', records } }],
    w,
  );
}
it('four empty-workspace listings become ready from cost entry alone; final approval accepts the labeled date assumption', () => {
  const w = emptyWorkspace();
  let batch = listings(w);
  expect(previewBatch(w, batch).every((p) => !p.ready && p.issues.length === 1)).toBe(true);
  for (const row of batch.rows) {
    expect(row.matches[0].newItem?.confirmedDistinct).toBe(false);
    expect(row.matches[0].newItem?.purchasedAt).toBe(localDay(new Date(), w.settings.timezone));
    batch = updateReviewRow(batch, changeListingCost(w, row, 0, '10'));
  }
  expect(previewBatch(w, batch).every((p) => p.ready)).toBe(true);
  const saved = approvalCommands(
    w,
    batch,
    batch.rows.map((r) => r.id),
  ).reduce(applyCommand, w);
  expect(saved.items).toHaveLength(4);
  expect(saved.listings).toHaveLength(4);
  expect(saved.items.every((i) => i.notes.includes('assumed and accepted'))).toBe(true);
  expect(inventoryPipeline(saved).groups['for-sale'].count).toBe(4);
  expect(saved.items.reduce((n, i) => n + i.cost, 0)).toBe(4000);
  expect(saved.listings.reduce((n, l) => n + l.price, 0)).toBe(10600);
  expect(w.items).toHaveLength(0);
});
it('allocates exact cents in stable order, supports selected physical items and individual overrides', () => {
  const w = emptyWorkspace();
  let batch = applyBatchCost(w, listings(w), 'split', '10.01');
  expect(batch.rows.map((r) => r.matches[0].newItem?.cost)).toEqual([251, 250, 250, 250]);
  expect(batch.rows.reduce((n, r) => n + r.matches[0].newItem!.cost!, 0)).toBe(1001);
  batch = updateReviewRow(batch, changeListingCost(w, batch.rows[1], 0, '3.27'));
  expect(batch.rows.map((r) => r.matches[0].newItem?.cost)).toEqual([251, 327, 250, 250]);
  batch = applyBatchCost(w, batch, 'same', '0', [batch.rows[3].matches[0].newItem!.id]);
  expect(batch.rows.map((r) => r.matches[0].newItem?.cost)).toEqual([251, 327, 250, 0]);
  expect(batchSchema.parse(JSON.parse(JSON.stringify(batch)))).toEqual(batch);
  expect(() => applyBatchCost(w, batch, 'split', '')).toThrow();
  expect(() => applyBatchCost(w, batch, 'split', '1.001')).toThrow();
});
it('counts shared cross-listings once, persists one physical item, and synchronizes manual overrides', () => {
  const w = emptyWorkspace();
  let batch = listings(w, true);
  expect(eligiblePhysicalDrafts(w, batch)).toHaveLength(3);
  batch = applyBatchCost(w, batch, 'split', '10.00');
  expect(batch.rows.map((r) => r.matches[0].newItem?.cost)).toEqual([334, 334, 333, 333]);
  batch = updateReviewRow(batch, changeListingCost(w, batch.rows[1], 0, '4.50'));
  expect(batch.rows[0].matches[0].newItem?.cost).toBe(450);
  const previews = previewBatch(w, batch);
  expect(previews.every((p) => p.ready)).toBe(true);
  const saved = approvalCommands(
    w,
    batch,
    batch.rows.map((r) => r.id),
  ).reduce(applyCommand, w);
  expect(saved.items).toHaveLength(3);
  expect(saved.listings).toHaveLength(4);
  expect(new Set(saved.listings.map((l) => l.itemId)).size).toBe(3);
  expect(inventoryPipeline(saved).groups['for-sale'].count).toBe(3);
});
it('excludes ambiguous and existing inventory from bulk allocation until an actual candidate decision', () => {
  const w = assistantWorkspace();
  let batch = listings(w);
  for (const row of batch.rows) row.facts.lines[0].title = 'Blue Carhartt jacket';
  batch.rows[0].matches[0] = { itemId: w.items[0].id, newItem: null, confirmZeroCost: false };
  expect(eligiblePhysicalDrafts(w, batch)).toHaveLength(0); // Similar Carhartt attributes require a choice.
  expect(() => applyBatchCost(w, batch, 'same', '5')).toThrow('No eligible');
  for (const row of batch.rows.slice(1)) row.matches[0].dismissedCandidateIds = [w.items[0].id];
  batch = applyBatchCost(w, batch, 'same', '5');
  expect(batch.rows[0].matches[0].costInput).toBeUndefined();
  expect(w.items[0].cost).toBe(1200);
  expect(batch.rows[1].matches[0].newItem?.cost).toBe(500);
  batch.rows[1].matches[0].dismissedCandidateIds = [];
  batch.rows[1].matches[0].newItem!.confirmedDistinct = true; // Legacy flag cannot bypass genuine ambiguity.
  expect(previewBatch(w, batch)[1].issues.join(' ')).toContain('Possible existing item');
});
it('explicit batch dates replace assumptions and future or impossible dates remain invalid', () => {
  const w = emptyWorkspace();
  const initial = listings(w);
  const batch = setBatchAcquisitionDate(applyBatchCost(w, initial, 'same', '1'), '2026-10-01');
  expect(batch.rows.every((r) => r.matches[0].newItem?.assumedAcquisitionDate === false)).toBe(
    true,
  );
  expect(previewBatch(w, batch).every((p) => p.ready)).toBe(true);
  for (const value of ['2099-01-01', '2026-02-30', ''])
    expect(previewBatch(w, setBatchAcquisitionDate(batch, value)).every((p) => !p.ready)).toBe(
      true,
    );
  expect(initial.rows[0].matches[0].newItem?.assumedAcquisitionDate).toBe(true);
});
it('zero costs are confirmed by final approval receipts; blank costs remain unknown', () => {
  const w = emptyWorkspace();
  let batch = listings(w);
  expect(listingCost(w, batch.rows[0], 0)).toBeNull();
  batch = applyBatchCost(w, batch, 'same', '0');
  const saved = approvalCommands(
    w,
    batch,
    batch.rows.map((r) => r.id),
  ).reduce(applyCommand, w);
  expect(inventoryPipeline(saved).entries.every((e) => e.cost === 0)).toBe(true);
  batch.rows[0].matches[0] = { itemId: saved.items[0].id, newItem: null, confirmZeroCost: false };
  expect(listingCost(saved, batch.rows[0], 0)).toBe(0);
});
it('partial approvals reconcile pending cross-listings to saved inventory without creating another item', () => {
  const w = emptyWorkspace();
  const batch = applyBatchCost(w, listings(w, true), 'same', '5');
  batch.rows[0].facts.lines[0].price = null;
  const ready = previewBatch(w, batch)
    .filter((p) => p.ready)
    .map((p) => p.row.id);
  const saved = approvalCommands(w, batch, ready).reduce(applyCommand, w);
  const pending = reconcileApprovedDrafts(
    { ...batch, rows: batch.rows.filter((r) => !ready.includes(r.id)) },
    saved,
  );
  expect(pending.rows[0].matches[0].newItem).toBeNull();
  expect(pending.rows[0].matches[0].itemId).toBe(
    saved.listings.find((l) => l.marketplace === 'Depop')?.itemId,
  );
  pending.rows[0].facts.lines[0].price = 2650;
  const next = approvalCommands(saved, pending, [pending.rows[0].id]).reduce(applyCommand, saved);
  expect(next.items).toHaveLength(3);
  expect(next.listings).toHaveLength(4);
});
it('duplicate marketplace screenshots do not create or allocate a second physical item', () => {
  const w = emptyWorkspace(),
    batch = listings(w, true);
  batch.rows[1].facts.marketplace = 'Vinted';
  const costed = applyBatchCost(w, batch, 'same', '5');
  expect(eligiblePhysicalDrafts(w, costed)).toHaveLength(3);
  const previews = previewBatch(w, costed);
  expect(previews[1].ready).toBe(false);
  expect(() =>
    approvalCommands(
      w,
      costed,
      costed.rows.map((r) => r.id),
    ),
  ).toThrow();
  const saved = approvalCommands(
    w,
    costed,
    previews.filter((p) => p.ready).map((p) => p.row.id),
  ).reduce(applyCommand, w);
  expect(saved.items).toHaveLength(3);
  expect(saved.listings).toHaveLength(3);
});

it('shared physical drafts approve correctly even if the caller submits row IDs in reverse order', () => {
  const w = emptyWorkspace(),
    batch = applyBatchCost(w, listings(w, true), 'same', '5');
  const saved = approvalCommands(w, batch, batch.rows.map((r) => r.id).reverse()).reduce(
    applyCommand,
    w,
  );
  expect(saved.items).toHaveLength(3);
  expect(saved.listings).toHaveLength(4);
});
it('a proposed new ID cannot claim an existing physical record without matching inventory', () => {
  const w = assistantWorkspace(),
    batch = listings(w);
  batch.rows[0].matches[0].newItem!.id = w.items[0].id;
  batch.rows[0].matches[0].newItem!.cost = 500;
  batch.rows[0].matches[0].dismissedCandidateIds = [w.items[0].id];
  expect(previewBatch(w, batch)[0].issues.join(' ')).toContain('proposed item already exists');
  expect(() => approvalCommands(w, batch, [batch.rows[0].id])).toThrow();
});

it('does not dilute batch costs with contradictory duplicate listing identifiers', () => {
  const w = emptyWorkspace(),
    batch = listings(w);
  batch.rows[1].facts.lines[0].listingId = batch.rows[0].facts.lines[0].listingId;
  expect(eligiblePhysicalDrafts(w, batch)).toHaveLength(2);
  const costed = applyBatchCost(w, batch, 'split', '10.01');
  expect(costed.rows.map((r) => r.matches[0].newItem?.cost)).toEqual([null, null, 501, 500]);
  expect(
    previewBatch(w, costed)
      .slice(0, 2)
      .every((p) => !p.ready),
  ).toBe(true);
});

it('shared brand and size without matching product identity do not require routine duplicate confirmation', () => {
  const w = assistantWorkspace(),
    batch = listings(w);
  const costed = applyBatchCost(w, batch, 'same', '5');
  expect(eligiblePhysicalDrafts(w, batch)).toHaveLength(4);
  expect(previewBatch(w, costed).every((p) => p.ready)).toBe(true);
});

it('a labeled date assumption does not turn an optional historical listing date into a routine blocker', () => {
  const w = emptyWorkspace(),
    batch = applyBatchCost(w, listings(w), 'same', '5');
  for (const row of batch.rows) row.facts.date = '2026-10-01';
  expect(previewBatch(w, batch).every((p) => p.ready)).toBe(true);
  const confirmed = setBatchAcquisitionDate(batch, '2026-10-02');
  expect(previewBatch(w, confirmed).every((p) => !p.ready)).toBe(true);
  const future = structuredClone(batch);
  for (const row of future.rows) row.matches[0].newItem!.purchasedAt = '2099-01-01';
  expect(previewBatch(w, future).every((p) => !p.ready)).toBe(true);
});
