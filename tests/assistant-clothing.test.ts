import { matchInventory } from '../src/lib/assistant/matching';
import { it, expect, vi } from 'vitest';
import sharp from 'sharp';
vi.mock('server-only', () => ({}));
import {
  normalizeVision,
  requireMarketplaceReview,
  correctedMarketplace,
  emptyClothing,
} from '../src/lib/assistant/vision';
import { visionImages } from '../src/lib/assistant/vision-images';
import { createBatch } from '../src/lib/assistant/drafts';
import { previewBatch, approvalCommands } from '../src/lib/assistant/planner';
import {
  extractedLine,
  extractedSale,
  assistantWorkspace,
  visionExtraction,
} from './helpers/assistant';
import { visionExtractionSchema } from '../src/lib/assistant/schema';
import { applyCommand } from '../src/lib/commands';
it('separates product cards without splitting multi-item sale orders or copying shared charges', () => {
  const lines = [1, 2, 3, 4].map((n) => extractedLine({ title: `Garment ${n}`, price: n * 1000 }));
  const listing = extractedSale({ kind: 'listing', status: 'active', lines });
  const normalized = normalizeVision(visionExtractionSchema.parse(visionExtraction([listing])));
  expect(normalized.records).toHaveLength(4);
  expect(normalized.records.map((r) => r.lines[0].price)).toEqual([1000, 2000, 3000, 4000]);
  const sale = normalizeVision(
    visionExtractionSchema.parse(visionExtraction([extractedSale({ lines, fees: 101 })])),
  );
  expect(sale.records).toHaveLength(1);
  expect(sale.records[0].fees).toBe(101);
  expect(sale.records[0].lines).toHaveLength(4);
});
it('does not silently choose uncertain or conflicting marketplaces, and permits explicit correction', () => {
  const input = visionExtraction();
  input.identification.confidence = 'uncertain';
  const r = normalizeVision(input).records[0];
  expect(r.marketplace).toBeNull();
  expect(requireMarketplaceReview(r)).toBe(true);
  r.marketplace = 'Depop';
  r.marketplaceIdentification = correctedMarketplace(r.marketplaceIdentification, 'Depop');
  expect(requireMarketplaceReview(r)).toBe(false);
  const conflict = visionExtraction();
  conflict.identification.detected = 'eBay';
  expect(normalizeVision(conflict).records[0].marketplace).toBeNull();
});
it('keeps each screenshot classification independent in a mixed batch', () => {
  const records = ['Vinted', 'Depop', 'eBay', 'Whatnot'].map((marketplace, n) => ({
    hash: String(n + 1).repeat(64),
    name: 'unreliable-filename.png',
    extraction: normalizeVision(
      visionExtraction([extractedSale({ marketplace: marketplace as 'Vinted' })]),
    ),
  }));
  const batch = createBatch(records, assistantWorkspace());
  expect(batch.rows.map((r) => r.facts.marketplace)).toEqual([
    'Vinted',
    'Depop',
    'eBay',
    'Whatnot',
  ]);
  expect(new Set(batch.rows.map((r) => r.sourceHash)).size).toBe(4);
});
it('never turns a model vintage claim into owner-confirmed age', () => {
  const input = visionExtraction();
  input.records[0].lines[0].clothing.vintage.classification = 'Vintage confirmed';
  const c = normalizeVision(input).records[0].lines[0].clothing!;
  expect(c.vintage.classification).toBe('Potentially vintage');
  expect(c.vintage.confirmedByUser).toBe(false);
});
it('preserves source pixels and adds bounded overlapping high-resolution detail views', async () => {
  const bytes = await sharp({
    create: { width: 1290, height: 2796, channels: 3, background: 'white' },
  })
    .png()
    .toBuffer();
  const result = await visionImages(bytes, 'image/png');
  expect([result.width, result.height]).toEqual([1290, 2796]);
  expect(result.views).toHaveLength(5);
  expect(Buffer.from(result.views[0].bytes).equals(bytes)).toBe(true);
  expect(result.views.slice(1).every((v) => v.width > 700 && v.height > 1500)).toBe(true);
  const oriented = await sharp({
    create: { width: 1200, height: 2600, channels: 3, background: 'white' },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  expect(await visionImages(oriented, 'image/jpeg')).toMatchObject({ width: 2600, height: 1200 });
});
it('saves corrected visual detail and original text only through approved commands', () => {
  const w = assistantWorkspace(),
    clothing = emptyClothing();
  clothing.visibleText = 'Original listing words';
  clothing.garmentType = 'Hooded jacket';
  clothing.design = 'Readable team lettering';
  clothing.vintage.classification = 'Potentially vintage';
  clothing.vintage.evidence = ['Collegiate silhouette'];
  const record = extractedSale({
    kind: 'listing',
    status: 'active',
    externalOrderId: null,
    date: '2026-11-08',
    lines: [
      extractedLine({
        sku: 'NEW-VISUAL-ITEM',
        listingId: 'NEW-VISUAL',
        title: 'Navy Team Hooded Jacket',
        clothing,
      }),
    ],
  });
  const batch = createBatch(
    [{ hash: 'f'.repeat(64), name: 'cards.png', extraction: { records: [record], message: '' } }],
    w,
  );
  batch.rows[0].matches[0] = {
    itemId: null,
    confirmZeroCost: false,
    newItem: {
      id: crypto.randomUUID(),
      sku: 'NEW-VISUAL-ITEM',
      cost: 1200,
      purchasedAt: '2026-10-01',
      confirmedDistinct: true,
    },
  };
  batch.rows[0].matches[0].dismissedCandidateIds = matchInventory(w, record, record.lines[0]).map(
    (c) => c.item.id,
  );
  const before = JSON.stringify(w);
  expect(previewBatch(w, batch)[0].ready).toBe(true);
  expect(JSON.stringify(w)).toBe(before);
  const saved = approvalCommands(w, batch, [batch.rows[0].id]).reduce(applyCommand, w);
  expect(saved.items.at(-1)!.description).toContain('Potentially vintage');
  expect(JSON.parse(saved.imports.at(-1)!.rawCsv).corrected.lines[0].clothing.visibleText).toBe(
    'Original listing words',
  );
});

it('links a contextual listing without matching or changing the physical inventory record', () => {
  const w = assistantWorkspace();
  const before = structuredClone(w.items[0]);
  const record = extractedSale({
    kind: 'listing',
    status: 'active',
    marketplace: 'eBay',
    externalOrderId: null,
    lines: [extractedLine({ title: 'Unrelated screenshot words', brand: null, price: 6500 })],
  });
  const context = { itemId: w.items[0].id };
  const batch = createBatch(
    [{ hash: 'd'.repeat(64), name: 'listing.png', extraction: { records: [record], message: '' } }],
    w,
    context,
  );
  expect(batch.rows[0].matches[0].itemId).toBe(context.itemId);
  expect(previewBatch(w, batch)[0].ready).toBe(true);
  expect(w.items[0]).toEqual(before);
  const saved = approvalCommands(w, batch, [batch.rows[0].id]).reduce(applyCommand, w);
  expect(saved.items).toHaveLength(1);
  expect(saved.items[0]).toEqual(before);
  expect(saved.listings).toHaveLength(3);
  batch.rows[0].matches[0].costOverride = 1;
  expect(previewBatch(w, batch)[0].ready).toBe(false);
  expect(() => approvalCommands(w, batch, [batch.rows[0].id])).toThrow('preserving');
});
it('requires an explicit card selection for multi-product contextual scans and rejects new inventory', () => {
  const w = assistantWorkspace();
  const listing = extractedSale({ kind: 'listing', status: 'active', lines: [extractedLine()] });
  const batch = createBatch(
    [
      {
        hash: 'c'.repeat(64),
        name: 'cards.png',
        extraction: { records: [listing, listing], message: '' },
      },
    ],
    w,
    { itemId: w.items[0].id },
  );
  expect(batch.rows.every((r) => !r.included && r.matches[0].itemId === null)).toBe(true);
  batch.rows[0].included = true;
  expect(() => approvalCommands(w, batch, [batch.rows[0].id])).toThrow();
});
it('blocks uncertain sources without making optional vintage age a financial blocker', () => {
  const w = assistantWorkspace();
  const record = extractedSale({
    marketplaceIdentification: { detected: null, confidence: 'unrecognized', evidence: [] },
    lines: [extractedLine({ sku: w.items[0].sku, clothing: emptyClothing() })],
  });
  const batch = createBatch(
    [{ hash: 'a'.repeat(64), name: 'cropped.png', extraction: { records: [record], message: '' } }],
    w,
  );
  expect(previewBatch(w, batch)[0].ready).toBe(false);
  batch.rows[0].facts.marketplaceIdentification = correctedMarketplace(
    record.marketplaceIdentification,
    'Vinted',
  );
  expect(previewBatch(w, batch)[0].ready).toBe(true);
  const vintage = batch.rows[0].facts.lines[0].clothing!.vintage;
  vintage.classification = 'Vintage confirmed';
  vintage.ageEvidence = 'Verified dated manufacturing label';
  expect(previewBatch(w, batch)[0].ready).toBe(true);
  vintage.confirmedByUser = true;
  expect(previewBatch(w, batch)[0].ready).toBe(true);
});

it('uses a single explicit marketplace only as context, and flags contrary screenshot evidence', async () => {
  const { marketplaceContextFromText } = await import('../src/lib/assistant/vision');
  expect(marketplaceContextFromText('Add these Depop listings')).toBe('Depop');
  expect(marketplaceContextFromText('Vinted and Depop screenshots')).toBeUndefined();
  expect(marketplaceContextFromText('unknown marketplace')).toBeUndefined();
  const w = assistantWorkspace();
  const record = normalizeVision(
    visionExtraction([extractedSale({ lines: [extractedLine({ sku: w.items[0].sku })] })]),
  );
  const batch = createBatch(
    [{ hash: 'f'.repeat(64), name: 'sale.png', extraction: record }],
    w,
    undefined,
    'Depop',
  );
  expect(batch.rows[0].facts.marketplace).toBe('Vinted');
  expect(previewBatch(w, batch)[0].ready).toBe(false);
  batch.rows[0].facts.marketplaceIdentification = correctedMarketplace(
    batch.rows[0].facts.marketplaceIdentification,
    'Vinted',
  );
  expect(previewBatch(w, batch)[0].ready).toBe(true);
});
