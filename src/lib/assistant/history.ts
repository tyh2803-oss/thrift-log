import { createBatch, newInventoryDraft, type DraftBatch, type DraftRow } from './drafts';
import type { Screenshot, ExtractedRecord } from './schema';
import { confirmedFreeInventory } from './listing-review';
import { importDate } from './planner';
import { itemSchema, orderSchema, type Command, type Workspace } from '../model';
import { applyCommand } from '../commands';
import { itemIsSold } from '../ledger';
import { matchingNotice } from './warnings';
export function historyWarnings(record: ExtractedRecord) {
  return record.warnings.filter((message) => {
    if (matchingNotice(message)) return false;
    const optional =
      /purchase|acquisition|shipping|processing|discount|description|brand|size|colo[u]?r|vintage|order.?id|sku/i.test(
        message,
      );
    const missing =
      /unknown|missing|not provided|not shown|unavailable|not included|not specified|absent/i.test(
        message,
      );
    const conflict = /ambig|conflict|contradict|unread|incomplete|partial|uncertain/i.test(message);
    return !(optional && missing && !conflict);
  });
}
export function createHistoryBatch(sources: Screenshot[], w: Workspace): DraftBatch {
  const batch = createBatch(sources, w);
  const claimed = new Set<string>();
  for (const row of batch.rows) {
    row.matches.forEach((match, index) => {
      const line = row.facts.lines[index];
      match.purchaseCost = line.purchaseCost;
      const item = w.items.find((i) => i.id === match.itemId);
      const saleDate = importDate(row.facts.date, w.settings.timezone);
      const knownCost = item && (item.cost > 0 || confirmedFreeInventory(w, item.id));
      // Exact identifiers may reuse available stock. Each other source line is its own
      // physical item; similarity and previously sold stock never suppress history rows.
      if (
        item &&
        (claimed.has(item.id) ||
          itemIsSold(w, item.id) ||
          (saleDate && Date.parse(item.purchasedAt) > Date.parse(saleDate)) ||
          (knownCost && line.purchaseCost != null && line.purchaseCost !== item.cost))
      ) {
        match.itemId = null;
      }
      if (match.itemId) claimed.add(match.itemId);
      if (!match.itemId) {
        match.newItem = newInventoryDraft(line.sku, line.purchaseCost ?? null);
        match.newItem.purchasedAt = row.facts.date || '';
        match.newItem.assumedAcquisitionDate = true;
      }
    });
  }
  return batch;
}
export function previewHistoryRow(w: Workspace, batch: DraftBatch, row: DraftRow) {
  const issues: string[] = [],
    commands: Command[] = [],
    unknownCostItemIds: string[] = [],
    knownZeroItemIds: string[] = [],
    assumedAcquisitionItemIds: string[] = [];
  const source = batch.screenshots.find((s) => s.hash === row.sourceHash);
  const r = row.facts;
  let trial = w;
  const add = (c: Command) => {
    trial = applyCommand(trial, c);
    commands.push(c);
  };
  try {
    if (!source || !['csv', 'pdf'].includes(source.sourceType || ''))
      throw new Error('A PDF or CSV source is required for history import.');
    if (r.kind !== 'sale' || r.status !== 'completed')
      throw new Error(
        'Only completed sales belong in sale history. Reconcile other events against their original orders.',
      );
    if (w.imports.some((i) => i.id === row.id))
      throw new Error('This approval was already saved. Refresh your workspace.');
    const date = importDate(r.date, w.settings.timezone);
    if (!date || Date.parse(date) > Date.now() + 300000)
      throw new Error('Enter an actual sale date, not a future or ambiguous date.');
    if (r.currency !== 'USD')
      throw new Error('Confirm USD amounts; currency conversion is unsupported.');
    if (!r.marketplace) throw new Error('Choose the marketplace.');
    if (r.fees === null)
      throw new Error('Seller fees are required; enter 0 explicitly for no fees.');
    if (r.refund) throw new Error('Reconcile refunds against the original order before importing.');
    if (!r.lines.length || r.lines.length !== row.matches.length)
      throw new Error('Every physical item needs a name and sale price.');
    const lines = r.lines.map((line, index) => {
      const match = row.matches[index];
      if (!line.title?.trim() || line.price === null)
        throw new Error(`Item ${index + 1}: name and actual sale price are required.`);
      let item = trial.items.find((i) => i.id === match.itemId);
      if (match.itemId && !item) throw new Error('The selected inventory item is unavailable.');
      if (item && match.newItem) throw new Error('Choose existing or new inventory, not both.');
      let cost: number | null;
      if (item) {
        if (Date.parse(item.purchasedAt) > Date.parse(date))
          throw new Error(
            'This sale predates the selected item’s acquisition. Choose the correct item or correct the source date.',
          );
        const recorded = item.cost > 0 || confirmedFreeInventory(trial, item.id) ? item.cost : null;
        if (match.purchaseCost != null && recorded !== null && match.purchaseCost !== recorded)
          throw new Error(
            'This item has a different recorded purchase cost. Correct inventory explicitly before importing.',
          );
        cost = match.purchaseCost ?? recorded;
        if (recorded === null && cost !== null && cost !== item.cost) {
          item = { ...item, cost };
          add({ type: 'item', value: item });
        }
      } else {
        const proposed = match.newItem;
        if (!proposed)
          throw new Error(
            `Item ${index + 1}: match existing inventory or propose a new physical item.`,
          );
        if (trial.items.some((i) => i.id === proposed.id))
          throw new Error(
            'This proposed physical item already exists. Match it instead of overwriting inventory.',
          );
        // Keep unique internal SKUs without rejecting repeated source identifiers.
        // The original SKU remains in the source facts and approval receipt.
        let sku = proposed.sku;
        if (trial.items.some((i) => i.sku.toLowerCase() === sku.toLowerCase())) {
          const base = `HIST-${proposed.id}`;
          sku = base;
          let suffix = 1;
          while (trial.items.some((i) => i.sku.toLowerCase() === sku.toLowerCase()))
            sku = `${base}-${suffix++}`;
        }
        cost = proposed.cost;
        const assumedAcquisition = proposed.assumedAcquisitionDate || !proposed.purchasedAt;
        const acquired = importDate(proposed.purchasedAt || r.date, w.settings.timezone);
        if (!acquired || Date.parse(acquired) > Date.parse(date))
          throw new Error('Acquisition cannot be after the sale.');
        item = itemSchema.parse({
          id: proposed.id,
          sku,
          title: line.title.slice(0, 500),
          brand: line.brand?.slice(0, 500) || '',
          size: line.size?.slice(0, 500) || '',
          color: line.color?.slice(0, 500) || '',
          category: line.category?.slice(0, 500) || 'Other',
          condition: line.condition?.slice(0, 500) || '',
          cost: cost ?? 0,
          asking: line.price,
          purchasedAt: acquired,
          createdAt: new Date().toISOString(),
          status: 'Purchased',
          notes: assumedAcquisition
            ? 'Acquisition date unknown. Sale date is a placeholder from the approved history import, not verified purchase history.'
            : 'Approved sale-history import.',
        });
        add({ type: 'item', value: item });
        if (assumedAcquisition) assumedAcquisitionItemIds.push(item.id);
      }
      if (cost === null) unknownCostItemIds.push(item.id);
      if (cost === 0) knownZeroItemIds.push(item.id);
      return { itemId: item.id, price: line.price, costBasis: cost ?? 0 };
    });
    const order = orderSchema.parse({
      id: row.id,
      marketplace: r.marketplace,
      // Source IDs are retained in the receipt. A repeated ID is not reused as a
      // unique database identifier for this intentionally separate history record.
      externalId:
        r.externalOrderId &&
        !trial.orders.some(
          (o) => o.marketplace === r.marketplace && o.externalId === r.externalOrderId,
        )
          ? r.externalOrderId
          : '',
      date,
      lines,
      fees: r.fees,
      processing: r.processing ?? 0,
      shipping: r.shipping ?? 0,
      shippingCollected: r.shippingCollected ?? 0,
      discount: r.discount ?? 0,
      refund: 0,
      other: r.other ?? 0,
      packaging: r.packaging ?? 0,
      feeCredit: 0,
      adjustment: 0,
      tips: 0,
      showId: r.showId || null,
      type: 'Sale',
      status: 'Completed',
      fulfillment: 'Unfulfilled',
      payout: 'Pending',
      amountsConfirmed:
        !unknownCostItemIds.length &&
        ['processing', 'shipping', 'shippingCollected', 'discount', 'other'].every(
          (k) => r[k as keyof typeof r] !== null,
        ),
      provenance: 'Approved PDF/CSV sale history; only recorded selling costs included.',
      importKey: `assistant:${row.id}`,
    });
    add({ type: 'order', value: order });
    add({
      type: 'import',
      value: {
        id: row.id,
        filename: source.name,
        kind: 'Sales',
        importedAt: new Date().toISOString(),
        mapping: { format: 'assistant-v1', batchId: batch.id, history: 'true' },
        recordIds: [order.id, ...lines.map((l) => l.itemId)],
        rawCsv: JSON.stringify({
          version: 1,
          batchId: batch.id,
          rows: [{ sourceHash: row.sourceHash, recordIndex: row.recordIndex }],
          screenshot: {
            hash: source.hash,
            originalHash: source.originalHash,
            name: source.name,
            sourceType: source.sourceType,
            part: source.part,
            parts: source.parts,
          },
          extracted: source.extraction.records[row.recordIndex],
          corrected: r,
          matches: row.matches,
          authorization: {
            kind: 'final-approval',
            importPolicy: 'all-source-rows',
            newItemIds: row.matches.flatMap((m) => (m.newItem ? [m.newItem.id] : [])),
          },
          unknownCostItemIds,
          knownZeroItemIds,
          assumedAcquisitionItemIds,
        }),
      },
    });
  } catch (e) {
    issues.push(e instanceof Error ? e.message : 'Review required fields.');
  }
  return {
    row,
    issues,
    ready: !issues.length,
    commands: issues.length ? [] : commands,
    unknownCostItemIds,
  };
}
export function previewHistory(w: Workspace, batch: DraftBatch) {
  let next = w;
  return batch.rows.map((row) => {
    const preview = previewHistoryRow(next, batch, row);
    if (row.included && preview.ready) next = preview.commands.reduce(applyCommand, next);
    return preview;
  });
}
export function historyCommands(w: Workspace, batch: DraftBatch, rowIds: string[]) {
  if (
    !rowIds.length ||
    new Set(rowIds).size !== rowIds.length ||
    rowIds.some((id) => !batch.rows.some((r) => r.id === id && r.included))
  )
    throw new Error('Choose valid included history records.');
  const selected = { ...batch, rows: batch.rows.filter((r) => rowIds.includes(r.id)) };
  const previews = previewHistory(w, selected);
  if (previews.some((p) => !p.ready)) throw new Error(previews.find((p) => !p.ready)!.issues[0]);
  return previews.flatMap((p) => p.commands);
}
