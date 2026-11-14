import { it, expect } from 'vitest';
import { createBusinessTools } from '../src/lib/assistant/business-tools';
import {
  previewBatchAsync,
  approvalCommandsAsync,
  alreadyApproved,
} from '../src/lib/assistant/planner';
import { applyCommand } from '../src/lib/commands';
import { emptyWorkspace, type Workspace } from '../src/lib/model';
import { inventoryPipeline } from '../src/lib/pipeline';
import { metrics } from '../src/lib/finance';
import { confirmedFreeInventory } from '../src/lib/assistant/listing-review';
import { inventoryChange } from './helpers/inventory-assistant';
import { soldCostFixture } from './helpers/purchase-costs';
const empty = { batch: null, historyBatch: null };
async function prepared(w: Workspace, change: ReturnType<typeof inventoryChange>, text?: string) {
  const tools = createBusinessTools(w, empty, text || String(change.evidence), null);
  for (const id of change.itemIds as string[])
    await tools.execute('get_record', { kind: 'item', id });
  await tools.execute('prepare_inventory_changes', { changes: [change] });
  return tools.drafts.batch!;
}
async function save(w: Workspace, batch: Awaited<ReturnType<typeof prepared>>) {
  return (
    await approvalCommandsAsync(
      w,
      batch,
      batch.rows.map((r) => r.id),
    )
  ).reduce(applyCommand, w);
}
it('prepares the actual Carhartt request as one new item, keeps worth out of revenue and commits only on approval', async () => {
  const w = emptyWorkspace(),
    before = structuredClone(w);
  const batch = await prepared(w, inventoryChange());
  expect(w).toEqual(before);
  expect(batch.rows[0].inventoryChange).toMatchObject({
    purchaseCost: 300,
    assumedAcquisitionDate: true,
    patch: { asking: 50000, title: 'Carhartt Detroit denim jacket' },
  });
  expect((await previewBatchAsync(w, batch))[0].ready).toBe(true);
  const saved = await save(w, batch);
  expect(saved.items).toHaveLength(1);
  expect(saved.items[0]).toMatchObject({
    cost: 300,
    asking: 50000,
    status: 'Purchased',
    brand: 'Carhartt',
    category: 'Jackets',
    source: 'Bins',
  });
  expect(saved.orders).toHaveLength(0);
  expect(saved.listings).toHaveLength(0);
  expect(metrics(saved).revenue).toBe(0);
  expect(alreadyApproved(saved, batch, [batch.rows[0].id])).toBe(true);
});
it('supports non-clothing items, confirmed zero and missing costs without inventing optional details', async () => {
  const w = emptyWorkspace();
  const batch = await prepared(
    w,
    inventoryChange({
      title: 'Bookshelf',
      brand: null,
      category: 'Furniture',
      source: null,
      purchaseCost: null,
      askingPrice: null,
    }),
  );
  expect((await previewBatchAsync(w, batch))[0].issues[0]).toContain('purchase cost');
  batch.rows[0].inventoryChange!.purchaseCost = 0;
  const saved = await save(w, batch);
  expect(saved.items[0]).toMatchObject({
    title: 'Bookshelf',
    category: 'Furniture',
    cost: 0,
    size: '',
    brand: '',
  });
  expect(confirmedFreeInventory(saved, saved.items[0].id)).toBe(true);
  expect(inventoryPipeline(saved).entries[0].cost).toBe(0);
});
it('updates a pending new item without allocating another physical ID or cost operation', async () => {
  const w = emptyWorkspace(),
    tools = createBusinessTools(
      w,
      empty,
      'I just got a Detroit denim Carhartt jacket worth about 500 from the bins I paid 3\nActually I paid 4',
      null,
    );
  await tools.execute('prepare_inventory_changes', { changes: [inventoryChange()] });
  const old = structuredClone(tools.drafts.batch!.rows[0]);
  await tools.execute('prepare_inventory_changes', {
    changes: [
      inventoryChange({
        action: 'edit',
        proposalId: old.id,
        itemIds: [old.inventoryChange!.itemId],
        evidence: 'Actually I paid 4',
        title: null,
        brand: null,
        category: null,
        source: null,
        purchaseCost: 400,
        askingPrice: null,
      }),
    ],
  });
  expect(tools.drafts.batch!.rows).toHaveLength(1);
  expect(tools.drafts.batch!.rows[0].inventoryChange).toMatchObject({
    action: 'create',
    itemId: old.inventoryChange!.itemId,
    costOperationId: old.inventoryChange!.costOperationId,
    purchaseCost: 400,
    patch: { asking: 50000 },
  });
  expect((await save(w, tools.drafts.batch!)).items).toHaveLength(1);
});
it('edits owned details and corrects saved sale costs only after confirmation, preserving original lines and fees', async () => {
  const w = await soldCostFixture(1200),
    before = structuredClone(w.orders[0]);
  const batch = await prepared(
    w,
    inventoryChange({
      action: 'edit',
      itemIds: [w.items[0].id],
      evidence: 'Correct my jacket cost to 3 and put it on shelf B',
      title: null,
      brand: null,
      category: null,
      source: null,
      purchaseCost: 300,
      askingPrice: null,
      storage: 'Shelf B',
    }),
  );
  expect((await previewBatchAsync(w, batch))[0].issues[0]).toContain('Confirm correcting');
  batch.rows[0].inventoryChange!.confirmCostCorrection = true;
  const saved = await save(w, batch);
  expect(saved.items[0]).toMatchObject({ cost: 300, storage: 'Shelf B' });
  expect(saved.orders[0]).toEqual(before);
  expect(saved.financialEvents.filter((e) => e.kind === 'Cost basis adjustment')).toHaveLength(1);
  expect(metrics(saved).profit - metrics(w).profit).toBe(900);
});
it('moves For Sale → Unlisted and restores For Sale using canonical listing rules', async () => {
  let w = await save(emptyWorkspace(), await prepared(emptyWorkspace(), inventoryChange()));
  const id = w.items[0].id;
  let batch = await prepared(
    w,
    inventoryChange({
      action: 'stage',
      itemIds: [id],
      evidence: 'List my jacket on Depop for 500',
      title: null,
      brand: null,
      category: null,
      source: null,
      purchaseCost: null,
      askingPrice: 50000,
      destination: 'for-sale',
      marketplace: 'Depop',
    }),
  );
  w = await save(w, batch);
  expect(inventoryPipeline(w).entries[0].stage).toBe('for-sale');
  batch = await prepared(
    w,
    inventoryChange({
      action: 'stage',
      itemIds: [id],
      evidence: 'Move the jacket back to unlisted',
      title: null,
      brand: null,
      category: null,
      source: null,
      purchaseCost: null,
      askingPrice: null,
      destination: 'unlisted',
    }),
  );
  expect((await previewBatchAsync(w, batch))[0].issues[0]).toContain('Confirm');
  batch.rows[0].inventoryChange!.move!.confirmConsequences = true;
  w = await save(w, batch);
  expect(inventoryPipeline(w).entries[0].stage).toBe('unlisted');
  expect(w.listings[0].status).toBe('Ended');
});
it('uses canonical Sold → Shipped → Sold → Unlisted reversals without duplicate sales and retains ledger history', async () => {
  let w = await soldCostFixture(1200);
  const id = w.items[0].id;
  const move = async (destination: string, confirm = false) => {
    const batch = await prepared(
      w,
      inventoryChange({
        action: 'stage',
        itemIds: [id],
        evidence: `Move jacket to ${destination}`,
        title: null,
        brand: null,
        category: null,
        source: null,
        purchaseCost: null,
        askingPrice: null,
        destination,
      }),
    );
    batch.rows[0].inventoryChange!.move!.confirmConsequences = confirm;
    return batch;
  };
  w = await save(w, await move('shipped'));
  expect(inventoryPipeline(w).entries[0].stage).toBe('shipped');
  const batch = await move('sold');
  expect((await previewBatchAsync(w, batch))[0].ready).toBe(false);
  w = await save(w, await move('sold', true));
  expect(inventoryPipeline(w).entries[0].stage).toBe('sold');
  w = await save(w, await move('unlisted', true));
  expect(inventoryPipeline(w).entries[0].stage).toBe('unlisted');
  expect(w.orders).toHaveLength(1);
  expect(w.financialEvents.length).toBeGreaterThan(0);
  expect(metrics(w).revenue).toBe(0);
  expect(metrics(w).profit).toBe(0);
});
it('rejects unread/foreign IDs, invented evidence, paid reversals and future acquisition dates', async () => {
  const w = await soldCostFixture(1200),
    tools = createBusinessTools(w, empty, 'edit jacket', null);
  await expect(
    tools.execute('prepare_inventory_changes', {
      changes: [
        inventoryChange({
          action: 'edit',
          itemIds: [crypto.randomUUID()],
          evidence: 'edit jacket',
        }),
      ],
    }),
  ).rejects.toThrow('owned');
  await expect(
    tools.execute('prepare_inventory_changes', { changes: [inventoryChange()] }),
  ).rejects.toThrow('Quote');
  const batch = await prepared(
    w,
    inventoryChange({
      action: 'stage',
      itemIds: [w.items[0].id],
      evidence: 'undo jacket sale',
      title: null,
      brand: null,
      category: null,
      source: null,
      purchaseCost: null,
      askingPrice: null,
      destination: 'unlisted',
    }),
  );
  w.orders[0].payout = 'Paid';
  batch.rows[0].inventoryChange!.move!.confirmConsequences = true;
  expect((await previewBatchAsync(w, batch))[0].issues[0]).toContain('payout');
  const create = await prepared(emptyWorkspace(), inventoryChange());
  create.rows[0].inventoryChange!.patch.purchasedAt = '2099-01-01';
  expect((await previewBatchAsync(emptyWorkspace(), create))[0].issues[0]).toContain('future');
});
it('canonical stage traces replay exactly, preserve the source snapshot and do not repeat on retry', async () => {
  const { applyPipelineMove } = await import('../src/lib/pipeline-moves');
  const w = await soldCostFixture(1200),
    before = structuredClone(w),
    trace: import('../src/lib/model').Command[] = [];
  const request = {
    id: crypto.randomUUID(),
    revision: w.revision,
    date: new Date().toISOString(),
    destination: 'unlisted' as const,
    confirmConsequences: true,
    items: [{ itemId: w.items[0].id }],
  };
  const result = await applyPipelineMove(w, request, trace);
  expect(result.failures).toHaveLength(0);
  expect(trace.reduce(applyCommand, w)).toEqual(result.workspace);
  expect(w).toEqual(before);
  const again: typeof trace = [];
  expect((await applyPipelineMove(result.workspace, request, again)).replayed).toBe(true);
  expect(again).toHaveLength(0);
});
it('mixed natural sale and stage proposals create one sale and ship the same physical item atomically', async () => {
  const { businessWorkspace, saleChange } = await import('./helpers/business-assistant');
  const { localDay } = await import('../src/lib/dates');
  const w = businessWorkspace(),
    text =
      'I sold the Harley tee today for 35 with fees 2 and no other selling amounts. Ship it now.';
  const tools = createBusinessTools(w, empty, text, null);
  const id = w.items[0].id;
  await tools.execute('get_record', { kind: 'item', id });
  await tools.execute('prepare_changes', {
    changes: [
      saleChange(id, {
        identityEvidence: 'Harley tee',
        date: localDay(new Date(), w.settings.timezone),
        dateEvidence: 'today',
        fees: 200,
        processing: 0,
        shipping: 0,
        shippingCollected: 0,
        discount: 0,
        refund: 0,
        other: 0,
      }),
    ],
  });
  await tools.execute('prepare_inventory_changes', {
    changes: [
      inventoryChange({
        action: 'stage',
        itemIds: [id],
        evidence: 'Ship it now.',
        title: null,
        brand: null,
        category: null,
        source: null,
        purchaseCost: null,
        askingPrice: null,
        destination: 'shipped',
      }),
    ],
  });
  const b = tools.drafts.batch!;
  const previews = await previewBatchAsync(w, b);
  expect(
    previews.every((p) => p.ready),
    JSON.stringify(previews.map((p) => p.issues)),
  ).toBe(true);
  const saved = await save(w, b);
  expect(saved.orders).toHaveLength(1);
  expect(saved.items).toHaveLength(w.items.length);
  expect(inventoryPipeline(saved).entries.find((e) => e.item.id === id)?.stage).toBe('shipped');
  expect(metrics(saved).revenue).toBe(3500);
});
it('batch costs and acquisition dates apply to new text items without changing saved inventory', async () => {
  const { applyBatchCost, setBatchAcquisitionDate, eligiblePhysicalDrafts } =
    await import('../src/lib/assistant/review-bulk');
  const w = emptyWorkspace(),
    tools = createBusinessTools(w, empty, String(inventoryChange().evidence), null);
  await tools.execute('prepare_inventory_changes', {
    changes: [
      inventoryChange({ purchaseCost: null }),
      inventoryChange({ title: 'Small bookshelf', category: 'Furniture', purchaseCost: null }),
    ],
  });
  const batch = tools.drafts.batch!;
  expect(eligiblePhysicalDrafts(w, batch)).toHaveLength(2);
  const costed = setBatchAcquisitionDate(applyBatchCost(w, batch, 'split', '5.01'), '2026-11-01');
  expect(
    costed.rows
      .map((r) => r.inventoryChange!.purchaseCost)
      .reduce<number>((s, c) => s + (c ?? 0), 0),
  ).toBe(501);
  expect(
    costed.rows.every(
      (r) =>
        r.inventoryChange?.patch.purchasedAt === '2026-11-01' &&
        !r.inventoryChange.assumedAcquisitionDate,
    ),
  ).toBe(true);
  expect((await save(w, costed)).items).toHaveLength(2);
  expect(w.items).toHaveLength(0);
});
it('can create and internally list an item in one approval, archive unsold stock and restore it', async () => {
  let w = emptyWorkspace();
  let batch = await prepared(
    w,
    inventoryChange({
      evidence: 'Add jacket cost 3 and list on Depop for 500',
      destination: 'for-sale',
      marketplace: 'Depop',
    }),
  );
  expect((await previewBatchAsync(w, batch))[0].ready).toBe(true);
  w = await save(w, batch);
  expect(w.items).toHaveLength(1);
  expect(w.listings).toHaveLength(1);
  expect(inventoryPipeline(w).entries[0].stage).toBe('for-sale');
  expect(w.orders).toHaveLength(0);
  batch = await prepared(
    w,
    inventoryChange({
      action: 'stage',
      itemIds: [w.items[0].id],
      evidence: 'archive the unsold jacket',
      title: null,
      brand: null,
      category: null,
      source: null,
      purchaseCost: null,
      askingPrice: null,
      destination: 'archived',
    }),
  );
  batch.rows[0].inventoryChange!.move!.confirmConsequences = true;
  w = await save(w, batch);
  expect(w.items[0].status).toBe('Archived');
  batch = await prepared(
    w,
    inventoryChange({
      action: 'stage',
      itemIds: [w.items[0].id],
      evidence: 'restore the jacket to unlisted',
      title: null,
      brand: null,
      category: null,
      source: null,
      purchaseCost: null,
      askingPrice: null,
      destination: 'unlisted',
    }),
  );
  w = await save(w, batch);
  expect(inventoryPipeline(w).entries[0].stage).toBe('unlisted');
  expect(w.items[0].cost).toBe(300);
});
it('can create a new physical item, record its actual sale and ship it in one explicitly approved batch', async () => {
  const { saleChange } = await import('./helpers/business-assistant');
  const { localDay } = await import('../src/lib/dates');
  const w = emptyWorkspace(),
    text =
      String(inventoryChange().evidence) +
      '\nI sold that jacket today for 35, fees 2, no other selling charges. Ship it now.';
  const tools = createBusinessTools(w, empty, text, null);
  await tools.execute('prepare_inventory_changes', { changes: [inventoryChange()] });
  const id = tools.drafts.batch!.rows[0].inventoryChange!.itemId;
  const record = (await tools.execute('get_record', { kind: 'item', id })) as {
    pending: boolean;
    purchaseCost: number;
  };
  expect(record.pending).toBe(true);
  expect(record.purchaseCost).toBe(300);
  await tools.execute('prepare_changes', {
    changes: [
      saleChange(id, {
        identityEvidence: 'that jacket',
        date: localDay(new Date(), w.settings.timezone),
        dateEvidence: 'today',
        fees: 200,
        processing: 0,
        shipping: 0,
        shippingCollected: 0,
        discount: 0,
        refund: 0,
        other: 0,
      }),
    ],
  });
  await tools.execute('prepare_inventory_changes', {
    changes: [
      inventoryChange({
        action: 'stage',
        itemIds: [id],
        evidence: 'Ship it now.',
        title: null,
        brand: null,
        category: null,
        source: null,
        purchaseCost: null,
        askingPrice: null,
        destination: 'shipped',
      }),
    ],
  });
  const batch = tools.drafts.batch!,
    previews = await previewBatchAsync(w, batch);
  expect(
    previews.every((p) => p.ready),
    JSON.stringify(previews.map((p) => p.issues)),
  ).toBe(true);
  expect(w.items).toHaveLength(0);
  const saved = await save(w, batch);
  expect(saved.items).toHaveLength(1);
  expect(saved.orders).toHaveLength(1);
  expect(inventoryPipeline(saved).entries[0].stage).toBe('shipped');
  expect(metrics(saved).profit).toBe(3000);
});
it('partial approval keeps a pending sale/shipment usable at the confirmed revision without creating inventory twice', async () => {
  const { saleChange } = await import('./helpers/business-assistant');
  const { localDay } = await import('../src/lib/dates');
  const { reconcileApprovedDrafts } = await import('../src/lib/assistant/review-bulk');
  const w = emptyWorkspace(),
    text = String(inventoryChange().evidence) + '\nI sold that jacket today for 35. Ship it now.';
  const tools = createBusinessTools(w, empty, text, null);
  await tools.execute('prepare_inventory_changes', { changes: [inventoryChange()] });
  const batch = tools.drafts.batch!,
    createId = batch.rows[0].id,
    id = batch.rows[0].inventoryChange!.itemId;
  await tools.execute('get_record', { kind: 'item', id });
  await tools.execute('prepare_changes', {
    changes: [
      saleChange(id, {
        identityEvidence: 'that jacket',
        date: localDay(new Date(), w.settings.timezone),
        dateEvidence: 'today',
      }),
    ],
  });
  await tools.execute('prepare_inventory_changes', {
    changes: [
      inventoryChange({
        action: 'stage',
        itemIds: [id],
        evidence: 'Ship it now.',
        title: null,
        brand: null,
        category: null,
        source: null,
        purchaseCost: null,
        askingPrice: null,
        destination: 'shipped',
      }),
    ],
  });
  const all = tools.drafts.batch!,
    first = (await approvalCommandsAsync(w, all, [createId])).reduce(applyCommand, w);
  expect(first.items).toHaveLength(1);
  expect(first.orders).toHaveLength(0);
  const pending = reconcileApprovedDrafts(
    { ...all, revision: first.revision, rows: all.rows.filter((r) => r.id !== createId) },
    first,
  );
  const sale = pending.rows.find((r) => r.facts.kind === 'sale')!;
  Object.assign(sale.facts, {
    fees: 0,
    processing: 0,
    shipping: 0,
    shippingCollected: 0,
    discount: 0,
    refund: 0,
    other: 0,
  });
  expect((await previewBatchAsync(first, pending)).every((p) => p.ready)).toBe(true);
  const final = (
    await approvalCommandsAsync(
      first,
      pending,
      pending.rows.map((r) => r.id),
    )
  ).reduce(applyCommand, first);
  expect(final.items).toHaveLength(1);
  expect(final.orders).toHaveLength(1);
  expect(inventoryPipeline(final).entries[0].stage).toBe('shipped');
});
it('does not turn an unknown asking value into a free marketplace listing', async () => {
  let w = emptyWorkspace();
  w = await save(w, await prepared(w, inventoryChange({ askingPrice: null })));
  const batch = await prepared(
    w,
    inventoryChange({
      action: 'stage',
      itemIds: [w.items[0].id],
      evidence: 'move my jacket to For Sale on Depop',
      title: null,
      brand: null,
      category: null,
      source: null,
      purchaseCost: null,
      askingPrice: null,
      destination: 'for-sale',
      marketplace: 'Depop',
    }),
  );
  const preview = (await previewBatchAsync(w, batch))[0];
  expect(preview.ready).toBe(false);
  expect(preview.issues[0]).toContain('asking price');
  expect(w.listings).toHaveLength(0);
});
