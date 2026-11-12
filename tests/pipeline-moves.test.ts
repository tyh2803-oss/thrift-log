import { expect, it } from 'vitest';
import { assistantWorkspace } from './helpers/assistant';
import { applyPipelineMove, type PipelineMove } from '../src/lib/pipeline-moves';
import { confirmedFreeInventory } from '../src/lib/assistant/listing-review';
import { inventoryPipeline, pipelineValue } from '../src/lib/pipeline';
import { metrics } from '../src/lib/finance';
import { applyCommand } from '../src/lib/commands';
import { orderSchema } from '../src/lib/model';
import { currentOrderTotals } from '../src/lib/ledger';
const date = '2026-11-10T12:00:00Z';
const sale = (patch: Partial<NonNullable<PipelineMove['items'][number]['sale']>> = {}) => ({
  marketplace: 'Vinted' as const,
  date: '2026-11-09T12:00:00Z',
  price: 4500,
  purchaseCost: 1200,
  fees: 400,
  processing: 0,
  shipping: 300,
  shippingCollected: 0,
  discount: 0,
  other: 0,
  ...patch,
});
export function move(
  w: ReturnType<typeof assistantWorkspace>,
  destination: PipelineMove['destination'],
  patch: Partial<PipelineMove> = {},
): PipelineMove {
  return {
    id: crypto.randomUUID(),
    revision: w.revision,
    destination,
    date,
    confirmConsequences: true,
    items: [{ itemId: w.items[0].id }],
    ...patch,
  };
}
it('unlists and relists internally, preserves external IDs, and never invents an actual sale price', async () => {
  const w = assistantWorkspace(),
    before = structuredClone(w);
  const hidden = await applyPipelineMove(w, move(w, 'unlisted'));
  expect(hidden.workspace.listings.every((l) => l.status === 'Ended')).toBe(true);
  expect(inventoryPipeline(hidden.workspace).groups.unlisted.count).toBe(1);
  const listed = await applyPipelineMove(
    hidden.workspace,
    move(hidden.workspace, 'for-sale', {
      items: [{ itemId: w.items[0].id, listing: { marketplace: 'Vinted', price: 5000 } }],
    }),
  );
  expect(listed.workspace.listings).toHaveLength(2);
  expect(listed.workspace.listings[0].externalId).toBe(before.listings[0].externalId);
  const invalid = await applyPipelineMove(
    listed.workspace,
    move(listed.workspace, 'sold', {
      items: [{ itemId: w.items[0].id, sale: sale({ price: null }) }],
    }),
  );
  expect(invalid.successIds).toHaveLength(0);
  expect(invalid.failures).toHaveLength(1);
  expect(invalid.workspace.orders).toHaveLength(0);
  expect(w).toEqual(before);
});
it('sale, shipment, shipping correction and dated sale undo persist history without duplicate revenue or cost', async () => {
  const w = assistantWorkspace();
  const request = move(w, 'sold', { items: [{ itemId: w.items[0].id, sale: sale() }] });
  const sold = await applyPipelineMove(w, request);
  expect(sold.failures).toEqual([]);
  expect(sold.workspace.orders).toHaveLength(1);
  expect(metrics(sold.workspace).revenue).toBe(4500);
  expect(metrics(sold.workspace).profit).toBe(2600);
  const replay = await applyPipelineMove(sold.workspace, request);
  expect(replay.replayed).toBe(true);
  expect(replay.workspace.orders).toHaveLength(1);
  const shipped = await applyPipelineMove(sold.workspace, move(sold.workspace, 'shipped'));
  expect(inventoryPipeline(shipped.workspace).groups.shipped.count).toBe(1);
  const corrected = await applyPipelineMove(shipped.workspace, move(shipped.workspace, 'sold'));
  expect(inventoryPipeline(corrected.workspace).groups.sold.count).toBe(1);
  expect(corrected.workspace.orders).toHaveLength(1);
  const restored = await applyPipelineMove(
    corrected.workspace,
    move(corrected.workspace, 'unlisted'),
  );
  expect(restored.failures).toEqual([]);
  expect(inventoryPipeline(restored.workspace).groups.unlisted.count).toBe(1);
  expect(metrics(restored.workspace).revenue).toBe(0);
  expect(metrics(restored.workspace).profit).toBe(0);
  expect(metrics(restored.workspace).netSold).toBe(0);
  expect(currentOrderTotals(restored.workspace, restored.workspace.orders[0]).cogs).toBe(0);
  expect(restored.workspace.orders[0].lines[0].price).toBe(4500);
  expect(restored.workspace.orders[0].fees).toBe(400);
  expect(restored.workspace.orders[0].fulfillment).toBe('Unfulfilled');
  expect(restored.workspace.financialEvents).toHaveLength(3);
  expect(
    metrics(restored.workspace, Date.parse('2026-11-09'), Date.parse('2026-11-09T23:59:59Z'))
      .revenue,
  ).toBe(4500);
  const repeated = await applyPipelineMove(
    restored.workspace,
    move(restored.workspace, 'unlisted'),
  );
  expect(repeated.unchangedIds).toHaveLength(1);
  expect(repeated.workspace.financialEvents).toHaveLength(3);
});
it('bulk commits only valid groups and records partial failures for a safe exact retry', async () => {
  const w = assistantWorkspace();
  w.items.push({ ...w.items[0], id: crypto.randomUUID(), sku: 'SECOND', status: 'Ready to List' });
  const request = move(w, 'sold', {
    items: [
      { itemId: w.items[0].id, sale: sale() },
      { itemId: w.items[1].id, sale: sale({ price: null }) },
    ],
  });
  const result = await applyPipelineMove(w, request);
  expect(result.successIds).toEqual([w.items[0].id]);
  expect(result.failures[0].itemId).toBe(w.items[1].id);
  expect(result.workspace.orders).toHaveLength(1);
  const retry = await applyPipelineMove(result.workspace, request);
  expect(retry.replayed).toBe(true);
  expect(retry.failures).toEqual(result.failures);
  const fixed = await applyPipelineMove(
    result.workspace,
    move(result.workspace, 'sold', {
      items: [{ itemId: w.items[1].id, sale: sale({ price: 3000 }) }],
    }),
  );
  expect(fixed.workspace.orders).toHaveLength(2);
  await expect(
    applyPipelineMove(result.workspace, { ...request, destination: 'unlisted' }),
  ).rejects.toThrow('retry changed');
  await expect(
    applyPipelineMove(result.workspace, { ...request, id: crypto.randomUUID() }),
  ).rejects.toThrow('Workspace changed');
});
it('requires one explicit confirmation for consequential moves and preserves known acquisition costs', async () => {
  const w = assistantWorkspace();
  const blocked = await applyPipelineMove(w, move(w, 'unlisted', { confirmConsequences: false }));
  expect(blocked.successIds).toHaveLength(0);
  expect(blocked.workspace.listings[0].status).toBe('Active');
  const cost = await applyPipelineMove(
    w,
    move(w, 'sold', { items: [{ itemId: w.items[0].id, sale: sale({ purchaseCost: 1 }) }] }),
  );
  expect(cost.failures[0].message).toContain('acquisition cost');
  expect(cost.workspace.items[0].cost).toBe(1200);
});
it('partial item shipping works, but whole-order financial corrections require the complete related selection', async () => {
  let w = assistantWorkspace();
  w.items.push({ ...w.items[0], id: crypto.randomUUID(), sku: 'BUNDLE-2' });
  w = applyCommand(w, {
    type: 'order',
    value: orderSchema.parse({
      id: crypto.randomUUID(),
      ...sale(),
      marketplace: 'Vinted',
      date: '2026-11-09T12:00:00Z',
      externalId: 'BUNDLE',
      showId: null,
      lines: w.items.map((i) => ({ itemId: i.id, price: 2250, costBasis: i.cost })),
      packaging: 0,
      refund: 0,
      feeCredit: 0,
      adjustment: 0,
      tips: 0,
      type: 'Sale',
      status: 'Completed',
      fulfillment: 'Unfulfilled',
      payout: 'Pending',
      amountsConfirmed: true,
    }),
  });
  const partial = await applyPipelineMove(w, move(w, 'shipped'));
  expect(partial.failures).toEqual([]);
  expect(inventoryPipeline(partial.workspace).groups.shipped.count).toBe(1);
  expect(inventoryPipeline(partial.workspace).groups.sold.count).toBe(1);
  const rejected = await applyPipelineMove(partial.workspace, move(partial.workspace, 'unlisted'));
  expect(rejected.failures[0].message).toContain('whole order');
  expect(metrics(rejected.workspace).revenue).toBe(4500);
  const restored = await applyPipelineMove(
    partial.workspace,
    move(partial.workspace, 'unlisted', { items: w.items.map((i) => ({ itemId: i.id })) }),
  );
  expect(restored.failures).toEqual([]);
  expect(metrics(restored.workspace).profit).toBe(0);
  expect(inventoryPipeline(restored.workspace).groups.unlisted.count).toBe(2);
});
it('package moves require all linked pieces and retain allocated label history', async () => {
  let w = assistantWorkspace();
  const result = await applyPipelineMove(
    w,
    move(w, 'sold', { items: [{ itemId: w.items[0].id, sale: sale() }] }),
  );
  w = result.workspace;
  w = applyCommand(w, {
    type: 'shipment',
    value: {
      id: crypto.randomUUID(),
      marketplace: 'Vinted',
      date,
      orderIds: [w.orders[0].id],
      carrier: 'USPS',
      tracking: 'TRACK',
      status: 'Shipped',
      labelCost: 0,
      allocatedShipping: false,
      notes: '',
    },
  });
  const reset = await applyPipelineMove(w, move(w, 'sold'));
  expect(reset.failures).toEqual([]);
  expect(reset.workspace.shipments[0].status).toBe('Preparing');
  expect(reset.workspace.shipments[0].tracking).toBe('TRACK');
  const undo = await applyPipelineMove(
    w,
    move(w, 'for-sale', {
      items: [{ itemId: w.items[0].id, listing: { marketplace: 'Depop', price: 5500 } }],
    }),
  );
  expect(undo.failures).toEqual([]);
  expect(inventoryPipeline(undo.workspace).groups['for-sale'].count).toBe(1);
  expect(metrics(undo.workspace).profit).toBe(0);
});
it('paid-out sales require cash reconciliation before an accidental sale reversal', async () => {
  const w = assistantWorkspace();
  const sold = await applyPipelineMove(
    w,
    move(w, 'sold', { items: [{ itemId: w.items[0].id, sale: sale() }] }),
  );
  sold.workspace.orders[0].payout = 'Paid';
  const result = await applyPipelineMove(sold.workspace, move(sold.workspace, 'unlisted'));
  expect(result.failures[0].message).toContain('payout');
  expect(metrics(result.workspace).revenue).toBe(4500);
});

it('archives only unsold items, ends internal listings with confirmation, and restores the same physical IDs', async () => {
  const w = assistantWorkspace();
  const blocked = await applyPipelineMove(w, move(w, 'archived', { confirmConsequences: false }));
  expect(blocked.successIds).toEqual([]);
  expect(blocked.workspace.items[0].status).toBe('Listed');
  const archived = await applyPipelineMove(w, move(w, 'archived'));
  expect(archived.workspace.items[0].status).toBe('Archived');
  expect(archived.workspace.listings.every((l) => l.status === 'Ended')).toBe(true);
  const restored = await applyPipelineMove(
    archived.workspace,
    move(archived.workspace, 'unlisted'),
  );
  expect(restored.workspace.items).toHaveLength(1);
  expect(restored.workspace.items[0].id).toBe(w.items[0].id);
  expect(inventoryPipeline(restored.workspace).groups.unlisted.count).toBe(1);
  const sold = await applyPipelineMove(
    w,
    move(w, 'sold', { items: [{ itemId: w.items[0].id, sale: sale() }] }),
  );
  const unsafe = await applyPipelineMove(sold.workspace, move(sold.workspace, 'archived'));
  expect(unsafe.failures[0].message).toContain('Only unsold');
  expect(metrics(unsafe.workspace).revenue).toBe(4500);
});
it('bulk archive and restore preserves costs and supports relisting archived physical items without duplicates', async () => {
  const w = assistantWorkspace();
  w.items.push({ ...w.items[0], id: crypto.randomUUID(), sku: 'SECOND', status: 'Ready to List' });
  const archived = await applyPipelineMove(
    w,
    move(w, 'archived', { items: w.items.map((i) => ({ itemId: i.id })) }),
  );
  expect(archived.successIds).toHaveLength(2);
  const relisted = await applyPipelineMove(
    archived.workspace,
    move(archived.workspace, 'for-sale', {
      items: w.items.map((i) => ({
        itemId: i.id,
        listing: { marketplace: 'Vinted', price: 4500 },
      })),
    }),
  );
  expect(relisted.failures).toEqual([]);
  expect(relisted.workspace.items).toHaveLength(2);
  expect(inventoryPipeline(relisted.workspace).groups['for-sale'].count).toBe(2);
  expect(relisted.workspace.items.map((i) => i.cost)).toEqual([1200, 1200]);
});

it('preserves an explicitly confirmed zero acquisition cost after sale correction, while unknown costs stay unknown', async () => {
  const w = assistantWorkspace();
  w.items[0].cost = 0;
  expect(pipelineValue(inventoryPipeline(w).groups['for-sale'], 'profit').value).toBe(null);
  const sold = await applyPipelineMove(
    w,
    move(w, 'sold', { items: [{ itemId: w.items[0].id, sale: sale({ purchaseCost: 0 }) }] }),
  );
  expect(sold.failures).toEqual([]);
  const restored = await applyPipelineMove(
    sold.workspace,
    move(sold.workspace, 'for-sale', {
      items: [{ itemId: w.items[0].id, listing: { marketplace: 'Vinted', price: 4500 } }],
    }),
  );
  expect(restored.failures).toEqual([]);
  expect(confirmedFreeInventory(restored.workspace, w.items[0].id)).toBe(true);
  expect(
    pipelineValue(inventoryPipeline(restored.workspace).groups['for-sale'], 'profit').value,
  ).toBe(4500);
});

it('rolls back an entire linked sale correction when one relisting row is incomplete, while committing an independent valid item', async () => {
  let w = assistantWorkspace();
  w.items.push({ ...w.items[0], id: crypto.randomUUID(), sku: 'BUNDLE-2' });
  w = applyCommand(w, {
    type: 'order',
    value: orderSchema.parse({
      id: crypto.randomUUID(),
      marketplace: 'Vinted',
      date,
      lines: w.items.map((i) => ({ itemId: i.id, price: 2250, costBasis: i.cost })),
      fees: 400,
      processing: 0,
      shipping: 300,
      shippingCollected: 0,
      discount: 0,
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
    }),
  });
  w = applyCommand(w, {
    type: 'item',
    value: {
      ...assistantWorkspace().items[0],
      id: crypto.randomUUID(),
      sku: 'INDEPENDENT',
      status: 'Ready to List',
    },
  });
  const before = metrics(w);
  const result = await applyPipelineMove(
    w,
    move(w, 'for-sale', {
      items: w.items.map((item, index) => ({
        itemId: item.id,
        listing: { marketplace: 'Vinted', price: index === 1 ? null : 4500 },
      })),
    }),
  );
  expect(result.successIds).toEqual([w.items[2].id]);
  expect(result.failures.map((f) => f.itemId)).toEqual(w.items.slice(0, 2).map((i) => i.id));
  expect(result.workspace.financialEvents).toEqual(w.financialEvents);
  expect(result.workspace.orders).toEqual(w.orders);
  expect(metrics(result.workspace).revenue).toBe(before.revenue);
  expect(metrics(result.workspace).profit).toBe(before.profit);
  expect(inventoryPipeline(result.workspace).groups.sold.count).toBe(2);
  expect(inventoryPipeline(result.workspace).groups['for-sale'].count).toBe(1);
});
