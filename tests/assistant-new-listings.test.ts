import { it, expect } from 'vitest';
import { fiveUnknownListings, assistantWorkspace, extractedLine } from './helpers/assistant';
import { emptyWorkspace } from '../src/lib/model';
import { approvalCommands, previewBatch, alreadyApproved } from '../src/lib/assistant/planner';
import { changeListingCost } from '../src/lib/assistant/listing-review';
import { createBatch, sanitizeBatch } from '../src/lib/assistant/drafts';
import { inventoryPipeline } from '../src/lib/pipeline';
import { applyCommand } from '../src/lib/commands';

it('proposes five unsaved items and needs only costs before final approval creates inventory', () => {
  const w = emptyWorkspace(),
    batch = fiveUnknownListings(w);
  const ids = batch.rows.map((r) => r.id);
  expect(w.items).toHaveLength(0);
  expect(previewBatch(w, batch).filter((p) => p.ready)).toHaveLength(0);
  expect(new Set(batch.rows.map((r) => r.matches[0].newItem!.id)).size).toBe(5);
  for (const preview of previewBatch(w, batch)) {
    expect(preview.issues.join(' ')).toContain('purchase cost is unknown');
    expect(preview.issues).toHaveLength(1);
    expect(preview.row.matches[0].newItem?.assumedAcquisitionDate).toBe(true);
  }
  expect(() => approvalCommands(w, batch, ids)).toThrow();
  for (const row of batch.rows) {
    row.matches[0].newItem!.purchasedAt = '2026-10-01';
    expect(row.matches[0].newItem!.confirmedDistinct).toBe(false);
  }
  expect(previewBatch(w, batch).every((p) => !p.ready && p.issues.length === 1)).toBe(true);
  // An intentional zero differs from the other four missing acquisition costs.
  batch.rows = batch.rows.map((row, index) => changeListingCost(w, row, 0, String(index * 5)));
  expect(previewBatch(w, batch).every((p) => p.ready)).toBe(true);
  const saved = approvalCommands(w, batch, ids).reduce(applyCommand, w);
  expect(saved.items).toHaveLength(5);
  expect(saved.listings).toHaveLength(5);
  expect(saved.items.map((i) => i.cost)).toEqual([0, 500, 1000, 1500, 2000]);
  expect(new Set(saved.listings.map((l) => l.itemId)).size).toBe(5);
  expect(inventoryPipeline(saved).groups['for-sale'].count).toBe(5);
  expect(inventoryPipeline(saved).entries.find((entry) => entry.item.cost === 0)?.cost).toBe(0);
  expect(alreadyApproved(saved, batch, ids)).toBe(true);
  expect(() => approvalCommands(saved, batch, ids)).toThrow();
  expect(previewBatch(w, batch).every((p) => p.ready)).toBe(true); // Planning never mutated the workspace.
  expect(w.items).toHaveLength(0);
});

it('auto-selects only a unique exact match; approximate matches still require an explicit identity choice', () => {
  const w = assistantWorkspace(),
    batch = fiveUnknownListings(w);
  const screenshots = structuredClone(batch.screenshots);
  screenshots[0].extraction.records[0].lines[0] = extractedLine({ listingId: 'listing-1' });
  screenshots[1].extraction.records[0].lines[0] = extractedLine();
  const result = createBatch(screenshots, w);
  expect(result.rows[0].matches[0]).toMatchObject({ itemId: w.items[0].id, newItem: null });
  expect(result.rows[1].matches[0]).toMatchObject({
    itemId: null,
    newItem: { confirmedDistinct: false, cost: null },
  });
  const context = createBatch([screenshots[1]], w, { itemId: w.items[0].id });
  expect(context.rows[0].matches[0]).toMatchObject({ itemId: w.items[0].id, newItem: null });
});

it('imports repeated source listing identifiers without a match gate and preserves them in the audit', () => {
  const w = emptyWorkspace(),
    batch = fiveUnknownListings(w);
  batch.rows = batch.rows.map((row) => changeListingCost(w, row, 0, '12'));
  for (const row of batch.rows) row.matches[0].newItem!.purchasedAt = '2026-10-01';
  batch.rows[1].facts.lines[0].listingId = batch.rows[0].facts.lines[0].listingId;
  expect(previewBatch(w, batch).every((p) => p.ready)).toBe(true);
  const saved = approvalCommands(
    w,
    batch,
    batch.rows.map((r) => r.id),
  ).reduce(applyCommand, w);
  expect(saved.items).toHaveLength(5);
  expect(saved.listings).toHaveLength(5);
  expect(saved.imports).toHaveLength(5);
  expect(JSON.parse(saved.imports[1].rawCsv).corrected.lines[0].listingId).toBe(
    batch.rows[0].facts.lines[0].listingId,
  );
});

it('upgrades older pending cards without losing cost entries or explicit matches', () => {
  const batch = fiveUnknownListings();
  batch.rows[0].matches[0].newItem = null;
  batch.rows[0].matches[0].purchaseCost = 1200;
  batch.rows[0].matches[0].costInput = '12.00';
  const upgraded = sanitizeBatch(batch);
  expect(upgraded.rows[0].matches[0]).toMatchObject({
    costInput: '12.00',
    newItem: { cost: 1200, confirmedDistinct: false },
  });
  expect(upgraded.rows.slice(1)).toEqual(batch.rows.slice(1));
  batch.context = { itemId: crypto.randomUUID() };
  expect(sanitizeBatch(batch).rows[0].matches[0].newItem).toBeNull();
});

it('matching warnings are optional while duplicate-fee and other financial inconsistencies remain blocking', async () => {
  const { blockingWarnings, matchingNotice } = await import('../src/lib/assistant/warnings');
  expect(matchingNotice('Possible existing inventory: select a physical item.')).toBe(true);
  expect(matchingNotice('Duplicate seller fee amount does not match the order total.')).toBe(false);
  const record = fiveUnknownListings(emptyWorkspace()).rows[0].facts;
  record.warnings = [
    'Possible existing inventory.',
    'Duplicate seller fee amount does not match the order total.',
  ];
  expect(blockingWarnings(record)).toEqual([
    'Duplicate seller fee amount does not match the order total.',
  ]);
});
