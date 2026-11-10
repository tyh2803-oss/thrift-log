import { it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { normalizeVision, emptyClothing } from '../src/lib/assistant/vision';
import { createBatch, removeDraft } from '../src/lib/assistant/drafts';
import {
  assistantWorkspace,
  extractedLine,
  extractedSale,
  visionExtraction,
} from './helpers/assistant';
it('keeps four supported cards and drops phantom fifth, partial edges and repeated crop views', () => {
  const lines = [0, 1, 2, 3].map((i) =>
    extractedLine({ title: `Distinct jacket ${i}`, listingId: `card-${i}`, price: (i + 1) * 1000 }),
  );
  const partial = { ...emptyClothing(), partial: true };
  const input = visionExtraction([
    extractedSale({
      kind: 'listing',
      status: 'active',
      lines: [
        ...lines,
        extractedLine({ title: 'Untitled item', brand: null, price: null }),
        extractedLine({ title: 'Cropped jeans', clothing: partial }),
        lines[0],
      ],
    }),
  ]);
  input.records[0].lines[5].clothing.partial = true;
  const result = normalizeVision(input);
  expect(result.records).toHaveLength(4);
  expect(result.notes).toHaveLength(3);
  const batch = createBatch(
    [{ hash: 'c'.repeat(64), name: 'actual-pixels-not-supplied.png', extraction: result }],
    assistantWorkspace(),
  );
  expect(batch.rows).toHaveLength(4);
  const removed = removeDraft(batch, batch.rows[1].id);
  expect(removed.rows.map((r) => r.recordIndex)).toEqual([0, 2, 3]);
  expect(batch.rows).toHaveLength(4);
});
it('does not reinterpret a shipment mentioning sale prices as another sale', () => {
  const input = visionExtraction();
  input.records[0].event = {
    type: 'shipped',
    confidence: 'clear',
    evidence: ['Parcel accepted by carrier'],
    scope: 'order',
    carrier: 'USPS',
    tracking: 'TEST-123',
    labelCost: null,
    externalEventId: null,
  };
  const result = normalizeVision(input);
  expect(result.records[0].kind).toBe('fulfillment');
  expect(result.records[0].status).toBe('shipped');
});

import { approvalCommands, previewBatch } from '../src/lib/assistant/planner';
import { applyCommand } from '../src/lib/commands';
import { fulfillmentCommands } from '../src/lib/assistant/lifecycle';
import { orderTotals } from '../src/lib/money';
import { lineFulfillment } from '../src/lib/fulfillment-state';
import { correctBatch } from '../src/lib/assistant/corrections';
import { prepareSpokenFulfillment, appendConversationRow } from '../src/lib/assistant/conversation';
const imageBatch = (
  w: ReturnType<typeof assistantWorkspace>,
  records: ReturnType<typeof extractedSale>[],
) =>
  createBatch(
    records.map((r, i) => ({
      hash: createHash('sha256').update(JSON.stringify(r)).digest('hex'),
      name: `screen-${i}.png`,
      extraction: { message: '', records: [r] },
    })),
    w,
  );
function soldWorkspace() {
  const w = assistantWorkspace();
  const b = imageBatch(w, [extractedSale({ lines: [extractedLine({ sku: w.items[0].sku })] })]);
  return approvalCommands(w, b, [b.rows[0].id]).reduce(applyCommand, w);
}
const event = (type: 'shipped' | 'delivered' | 'refunded' | 'returned' | 'cancelled' = 'shipped') =>
  extractedSale({
    kind:
      type === 'shipped' || type === 'delivered'
        ? 'fulfillment'
        : type === 'refunded'
          ? 'refund'
          : type === 'returned'
            ? 'return'
            : 'cancellation',
    status: type,
    date: '2026-11-09',
    event: {
      type,
      confidence: 'clear',
      evidence: ['Visible event confirmation'],
      scope: 'order',
      tracking: 'TRACK-1',
      carrier: 'Carrier',
      labelCost: null,
      externalEventId: null,
    },
  });
it('approves sale then shipment across mixed input order without creating another sale or charging shipping twice', () => {
  const w = assistantWorkspace(),
    before = structuredClone(w);
  const batch = imageBatch(w, [
    event(),
    extractedSale({ lines: [extractedLine({ sku: w.items[0].sku })] }),
  ]);
  expect(previewBatch(w, batch).every((p) => p.ready)).toBe(true);
  expect(w).toEqual(before);
  expect(() => approvalCommands(w, batch, [batch.rows[0].id])).toThrow();
  const saved = approvalCommands(
    w,
    batch,
    batch.rows.map((r) => r.id),
  ).reduce(applyCommand, w);
  expect(saved.orders).toHaveLength(1);
  expect(saved.items).toHaveLength(1);
  expect(saved.orders[0].fulfillment).toBe('Shipped');
  expect(saved.orders[0].shipping).toBe(300);
  expect(orderTotals(saved.orders[0]).profit).toBe(2600);
  expect(saved.shipments).toHaveLength(0); // Unknown label cost stays unknown, no fabricated zero package.
  expect(
    saved.imports.some((i) => JSON.parse(i.rawCsv).corrected.event?.tracking === 'TRACK-1'),
  ).toBe(true);
  expect(previewBatch(saved, imageBatch(saved, [event()]))[0].ready).toBe(false);
});
it('keeps delivered items fulfilled and preserves individual shipment dates', () => {
  let w = soldWorkspace();
  const id = w.orders[0].id,
    itemId = w.items[0].id;
  w = fulfillmentCommands(w, {
    id: crypto.randomUUID(),
    orderId: id,
    itemIds: [itemId],
    status: 'Shipped',
    date: '2026-11-09T12:00:00Z',
  }).reduce(applyCommand, w);
  const batch = imageBatch(w, [event('delivered')]);
  batch.rows[0].facts.date = '2026-11-10T01:00:00Z';
  w = approvalCommands(w, batch, [batch.rows[0].id]).reduce(applyCommand, w);
  expect(lineFulfillment(w.orders[0], itemId).status).toBe('Delivered');
  expect(() =>
    fulfillmentCommands(w, {
      id: crypto.randomUUID(),
      orderId: id,
      itemIds: [itemId],
      status: 'Shipped',
      date: new Date().toISOString(),
    }),
  ).toThrow('already fulfilled');
});
it('requires explicit scope for multi-item orders and updates only the selected piece', () => {
  const base = soldWorkspace();
  const second = {
    ...base.items[0],
    id: crypto.randomUUID(),
    sku: 'SECOND',
    status: 'Sold' as const,
  };
  base.items.push(second);
  base.orders[0].lines.push({ itemId: second.id, price: 1000, costBasis: 1200 });
  const b = imageBatch(base, [event()]);
  b.rows[0].facts.event!.scope = 'unknown';
  expect(previewBatch(base, b)[0].ready).toBe(false);
  b.rows[0].targetItemIds = [second.id];
  const saved = approvalCommands(base, b, [b.rows[0].id]).reduce(applyCommand, base);
  expect(lineFulfillment(saved.orders[0], second.id).status).toBe('Shipped');
  expect(lineFulfillment(saved.orders[0], base.items[0].id).status).toBe('Unfulfilled');
  expect(saved.orders[0].fulfillment).toBe('Unfulfilled');
});
it('updates a grouped package only after explicit confirmation and reuses its identity and label costs', () => {
  let w = soldWorkspace();
  const first = w.orders[0];
  const item = { ...w.items[0], id: crypto.randomUUID(), sku: 'GROUP', status: 'Sold' as const };
  w.items.push(item);
  const second = {
    ...first,
    id: crypto.randomUUID(),
    externalId: 'group-2',
    lines: [{ ...first.lines[0], itemId: item.id }],
    importKey: 'group-2',
  };
  w.orders.push(second);
  const parcel = {
    id: crypto.randomUUID(),
    marketplace: 'Vinted' as const,
    date: '2026-11-09T12:00:00Z',
    orderIds: [first.id, second.id],
    carrier: 'Existing',
    tracking: 'OLD',
    status: 'Preparing' as const,
    labelCost: 500,
    allocatedShipping: false,
    notes: '',
  };
  w = applyCommand(w, { type: 'shipment', value: parcel });
  const request = {
    id: crypto.randomUUID(),
    orderId: first.id,
    itemIds: [first.lines[0].itemId],
    status: 'Shipped' as const,
    date: new Date().toISOString(),
  };
  expect(() => fulfillmentCommands(w, request)).toThrow('other orders');
  w = fulfillmentCommands(w, { ...request, confirmPackage: true }).reduce(applyCommand, w);
  expect(w.shipments).toHaveLength(1);
  expect(w.shipments[0]).toEqual({ ...parcel, status: 'Shipped' });
  expect(w.orders.every((o) => o.fulfillment === 'Shipped')).toBe(true);
  expect(w.financialEvents).toHaveLength(0);
});
it('uses handover for in-person sales and never invents a shipping charge', () => {
  const w = soldWorkspace();
  w.orders[0].marketplace = 'In person';
  const saved = fulfillmentCommands(w, {
    id: crypto.randomUUID(),
    orderId: w.orders[0].id,
    itemIds: [w.items[0].id],
    status: 'Handed over',
    date: new Date().toISOString(),
  }).reduce(applyCommand, w);
  expect(lineFulfillment(saved.orders[0], w.items[0].id).status).toBe('Handed over');
  expect(saved.shipments).toHaveLength(0);
  expect(saved.orders[0].shipping).toBe(300);
});
it('identifies refunds and physical returns separately and uses dated ledger validation', () => {
  let w = soldWorkspace();
  const refund = imageBatch(w, [event('refunded')]);
  refund.rows[0].facts.refund = 500;
  w = approvalCommands(w, refund, [refund.rows[0].id]).reduce(applyCommand, w);
  expect(w.orders).toHaveLength(1);
  expect(w.financialEvents[0]).toMatchObject({ kind: 'Refund', amount: 500, itemIds: [] });
  expect(w.items[0].status).toBe('Sold');
  const returned = imageBatch(w, [event('returned')]);
  expect(previewBatch(w, returned)[0].ready).toBe(false);
  returned.rows[0].confirmPhysicalReturn = true;
  w = approvalCommands(w, returned, [returned.rows[0].id]).reduce(applyCommand, w);
  expect(w.items[0].status).toBe('Returned');
  expect(w.orders).toHaveLength(1);
  expect(previewBatch(w, imageBatch(w, [event('refunded')]))[0].ready).toBe(false);
});
it('recognizes batch-wide instructions, cost corrections, draft removal and sale intent without committing', () => {
  const w = assistantWorkspace();
  const b = imageBatch(w, [
    extractedSale({
      kind: 'listing',
      status: 'active',
      lines: [extractedLine({ sku: w.items[0].sku })],
    }),
    extractedSale({
      kind: 'listing',
      status: 'active',
      marketplace: 'eBay',
      lines: [extractedLine({ sku: w.items[0].sku })],
    }),
  ]);
  expect(correctBatch(b, 'Approve everything', w).message).toContain('Approve All Ready');
  const cost = correctBatch(b, 'The second item cost me $8.', w);
  expect(cost.batch.rows[1].matches[0].costOverride).toBe(800);
  const removed = correctBatch(cost.batch, 'Remove the first item', w);
  expect(removed.batch.rows).toHaveLength(1);
  expect(removed.batch.rows[0].recordIndex).toBe(0);
  const listed = correctBatch(b, 'Add all four to listed', w);
  expect(listed.changed).toBe(true);
  const sale = correctBatch(b, 'The second item sold.', w);
  expect(sale.batch.rows[1].facts).toMatchObject({
    kind: 'sale',
    status: 'completed',
    date: null,
    fees: null,
  });
  expect(sale.batch.rows[1].facts.lines[0].price).toBeNull();
  expect(w.orders).toHaveLength(0);
});
it('prepares a saved-item shipment conversation without losing unrelated pending records', () => {
  const w = soldWorkspace();
  const result = prepareSpokenFulfillment(w, 'Mark the Blue Carhartt Workwear Jacket shipped');
  expect(result?.row).toBeDefined();
  const batch = appendConversationRow(null, w, result!.row!);
  expect(previewBatch(w, batch)[0].ready).toBe(true);
  const saved = approvalCommands(w, batch, [batch.rows[0].id]).reduce(applyCommand, w);
  expect(saved.orders).toHaveLength(1);
  expect(saved.orders[0].fulfillment).toBe('Shipped');
  expect(JSON.parse(saved.imports.at(-1)!.rawCsv).origin).toBe('conversation');
});
it('cancels an unfulfilled sale through existing commands and restores available physical inventory', () => {
  const w = soldWorkspace(),
    b = imageBatch(w, [event('cancelled')]);
  const saved = approvalCommands(w, b, [b.rows[0].id]).reduce(applyCommand, w);
  expect(saved.orders[0].status).toBe('Cancelled');
  expect(saved.items[0].status).toBe('Ready to List');
  expect(saved.listings.every((l) => l.status === 'Ended')).toBe(true);
});
it('leaves ordinary pending offers out of completed-sale operations', () => {
  const input = visionExtraction([extractedSale({ status: 'offer' })]);
  const r = normalizeVision(input).records[0];
  expect(r.kind).toBe('other');
  expect(r.event?.type).toBe('ambiguous');
});
it('upgrades old tab drafts by omitting unsupported listing rows while preserving valid corrections', async () => {
  const { sanitizeBatch } = await import('../src/lib/assistant/drafts');
  const w = assistantWorkspace(),
    b = imageBatch(w, [
      extractedSale({
        kind: 'listing',
        status: 'active',
        lines: [extractedLine({ sku: w.items[0].sku })],
      }),
    ]);
  b.rows[0].matches[0].notes = 'Preserved owner correction';
  const phantom = structuredClone(b.rows[0]);
  phantom.id = crypto.randomUUID();
  phantom.recordIndex = 1;
  phantom.facts.lines[0].title = 'Untitled item';
  b.rows.push(phantom);
  const cleaned = sanitizeBatch(b);
  expect(cleaned.rows).toHaveLength(1);
  expect(cleaned.rows[0]).toEqual(b.rows[0]);
  expect(b.rows).toHaveLength(2);
  expect(previewBatch(w, b)[1].ready).toBe(false);
});
it('removes a blank placeholder from an order event without inventing product identities', () => {
  const input = visionExtraction([event()]);
  const empty = extractedLine({
    title: null,
    brand: null,
    size: null,
    color: null,
    category: null,
    condition: null,
    price: null,
  });
  input.records[0].lines.push({ ...empty, clothing: input.records[0].lines[0].clothing });
  const normalized = normalizeVision(input);
  expect(normalized.records[0].lines).toHaveLength(1);
  input.records[0].lines = [{ ...empty, clothing: input.records[0].lines[0].clothing }];
  const onlyOrder = normalizeVision(input);
  expect(onlyOrder.records[0].lines).toHaveLength(0);
  const w = soldWorkspace();
  expect(previewBatch(w, imageBatch(w, onlyOrder.records))[0].ready).toBe(true);
});
it('records a completed refund with a physical return only when explicitly included, without repeating an existing refund', () => {
  const w = soldWorkspace(),
    b = imageBatch(w, [event('returned')]);
  b.rows[0].confirmPhysicalReturn = true;
  b.rows[0].applyRefund = true;
  b.rows[0].facts.refund = 500;
  b.rows[0].facts.event!.externalEventId = 'RMA-1';
  const saved = approvalCommands(w, b, [b.rows[0].id]).reduce(applyCommand, w);
  expect(saved.financialEvents.map((e) => e.kind)).toEqual(['Refund', 'Return']);
  expect(saved.items[0].status).toBe('Returned');
  expect(saved.orders).toHaveLength(1);
  const refund = imageBatch(w, [event('refunded')]);
  refund.rows[0].facts.refund = 500;
  refund.rows[0].facts.event!.externalEventId = 'RMA-1';
  const alreadyRefunded = approvalCommands(w, refund, [refund.rows[0].id]).reduce(applyCommand, w);
  expect(previewBatch(alreadyRefunded, b)[0].ready).toBe(false);
  b.rows[0].applyRefund = false;
  expect(previewBatch(alreadyRefunded, b)[0].ready).toBe(true);
});
it('does not block a fully specified sale on optional clothing observations but retains financial warnings', () => {
  const w = assistantWorkspace(),
    b = imageBatch(w, [
      extractedSale({
        lines: [extractedLine({ sku: w.items[0].sku })],
        warnings: ['Vintage age is unverified.', 'Material composition is not visible.'],
      }),
    ]);
  expect(previewBatch(w, b)[0].ready).toBe(true);
  b.rows[0].facts.warnings.push('The seller shipping amount is ambiguous.');
  expect(previewBatch(w, b)[0].ready).toBe(false);
});
it('keeps one current listing view per physical item and marketplace while permitting cross-listing', () => {
  const w = assistantWorkspace();
  const first = extractedSale({
    kind: 'listing',
    status: 'active',
    lines: [extractedLine({ sku: w.items[0].sku, price: 4800 })],
  });
  const second = extractedSale({
    ...first,
    lines: [extractedLine({ sku: w.items[0].sku, price: 4900 })],
  });
  const b = imageBatch(w, [first, second]);
  expect(previewBatch(w, b).filter((p) => p.ready)).toHaveLength(1);
  b.rows[1].facts.marketplace = 'eBay';
  expect(previewBatch(w, b).filter((p) => p.ready)).toHaveLength(2);
});
it('preserves valid line-level edits when upgrading an older multi-product draft with an empty extra line', async () => {
  const { sanitizeBatch } = await import('../src/lib/assistant/drafts');
  const w = assistantWorkspace(),
    b = imageBatch(w, [
      extractedSale({
        kind: 'listing',
        status: 'active',
        lines: [extractedLine({ sku: w.items[0].sku })],
      }),
    ]);
  b.rows[0].matches[0].notes = 'Keep this edited cost and match';
  b.rows[0].facts.lines.push(extractedLine({ title: 'Unknown product', brand: null, price: 20 }));
  b.rows[0].matches.push({ itemId: null, newItem: null, confirmZeroCost: false });
  const saved = sanitizeBatch(b);
  expect(saved.rows).toHaveLength(1);
  expect(saved.rows[0].facts.lines).toHaveLength(1);
  expect(saved.rows[0].matches[0]).toEqual(b.rows[0].matches[0]);
  expect(saved.rows[0].recordIndex).toBe(b.rows[0].recordIndex);
});
