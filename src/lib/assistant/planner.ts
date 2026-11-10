import { listingAmount, listingCost } from './listing-review';
import { blockingWarnings } from './warnings';
import { isLifecycle, lifecyclePreview } from './lifecycle';
import { matchInventory } from './matching';
import { listingEvidenceIssue, requireMarketplaceReview } from './vision';
import { clothingDescription } from './clothing';
import { applyCommand } from '../commands';
import { zoneMidnight } from '../dates';
import { itemIsSold } from '../ledger';
import { orderSchema, itemSchema, listingSchema, type Command, type Workspace } from '../model';
import { orderTotals, lineProfits } from '../money';
import { batchSchema, type DraftBatch, type DraftRow } from './drafts';

export const saleAmounts = [
  'fees',
  'processing',
  'shipping',
  'shippingCollected',
  'discount',
  'refund',
  'other',
] as const;
export const amountLabels: Record<(typeof saleAmounts)[number], string> = {
  fees: 'Marketplace fees',
  processing: 'Processing fees',
  shipping: 'Seller-paid shipping',
  shippingCollected: 'Shipping received by seller',
  discount: 'Discount',
  refund: 'Refund',
  other: 'Packaging / other direct costs',
};
export type Preview = {
  relatedOrder?: Workspace['orders'][number];
  row: DraftRow;
  ready: boolean;
  issues: string[];
  duplicateId: string | null;
  duplicateKind: 'order' | 'import' | 'listing' | null;
  costs: (number | null)[];
  totals: ReturnType<typeof orderTotals> | null;
  profits: ReturnType<typeof lineProfits>;
  commands: Command[];
};
export function importDate(value: string | null, zone: string): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const utc = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(+utc) || utc.toISOString().slice(0, 10) !== value) return null;
    return new Date(zoneMidnight(value, zone)).toISOString();
  }
  return /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
}
function importedSource(w: Workspace, row: DraftRow) {
  if (row.sourceHash === 'conversation') return undefined;
  return w.imports.find((i) => {
    if (i.mapping.format !== 'assistant-v1') return false;
    try {
      const audit = JSON.parse(i.rawCsv) as { rows: { sourceHash: string; recordIndex: number }[] };
      return audit.rows.some(
        (r) => r.sourceHash === row.sourceHash && r.recordIndex === row.recordIndex,
      );
    } catch {
      return false;
    }
  });
}
export function previewRow(w: Workspace, row: DraftRow): Preview {
  const issues: string[] = [],
    commands: Command[] = [];
  const r = row.facts,
    date = importDate(r.date, w.settings.timezone);
  let duplicateId: string | null = null,
    duplicateKind: Preview['duplicateKind'] = null;
  if (isLifecycle(r.kind)) {
    const event = lifecyclePreview(w, row, date);
    if (importedSource(w, row))
      event.issues.push(
        'This screenshot record has already been imported. Reconcile the saved event instead.',
      );
    if (requireMarketplaceReview(r))
      event.issues.push('Confirm the uncertain screenshot marketplace.');
    return {
      row,
      relatedOrder: event.order,
      ready: !event.issues.length && !!event.commands.length,
      issues: event.issues,
      duplicateId: event.order?.id || null,
      duplicateKind: event.order ? 'order' : null,
      costs: [],
      totals: null,
      profits: [],
      commands: event.issues.length ? [] : event.commands,
    };
  }
  if (!r.lines.length)
    issues.push(
      'No supported physical products were identified. Use a complete product screenshot or manual entry.',
    );
  if (r.kind === 'listing' && r.lines.some((line) => listingEvidenceIssue(line)))
    issues.push(
      'This region does not establish a complete distinct listing. Use a complete product card.',
    );
  if (r.event && r.event.confidence !== 'clear' && !r.event.confirmedByUser)
    issues.push('Confirm the screenshot lifecycle event.');
  if (!r.marketplace) issues.push('Choose the marketplace.');
  if (requireMarketplaceReview(r))
    issues.push('Confirm the uncertain or conflicting screenshot marketplace.');
  if (r.currency !== 'USD')
    issues.push('Confirm the amounts are USD. Currency conversion is not supported.');
  if ((r.kind === 'sale' && !date) || (r.date && !date))
    issues.push('Enter a valid date (YYYY-MM-DD or timestamp with timezone).');
  if (date && Date.parse(date) > Date.now() + 300000)
    issues.push('The record date cannot be in the future.');
  if (r.kind === 'other') issues.push('This screenshot is not a sale or active listing.');
  if (r.kind === 'sale' && blockingWarnings(r).length && !row.acknowledgedWarnings)
    issues.push('Review and acknowledge the extraction warnings.');
  if (row.matches.length !== r.lines.length)
    issues.push('Every physical line needs an inventory match.');
  const costs: (number | null)[] = [],
    itemIds: string[] = [];
  row.matches.forEach((match, i) => {
    const line = r.lines[i];
    if (!line) return;
    let item = w.items.find((v) => v.id === match.itemId);
    if (match.itemId && match.newItem)
      issues.push(`Line ${i + 1}: choose existing or new inventory, not both.`);
    for (const raw of [match.costInput, match.priceInput]) {
      if (raw !== undefined && listingAmount(raw).error)
        issues.push(`Line ${i + 1}: ${listingAmount(raw).error}`);
    }
    if (match.costCorrection && match.costInput !== undefined && !match.costInput.trim())
      issues.push(`Line ${i + 1}: enter the proposed acquisition cost or cancel its correction.`);
    const proposed = match.newItem;
    const storedCost = match.costOverride ?? item?.cost;
    const cost =
      r.kind === 'listing'
        ? listingCost(w, row, i)
        : item
          ? storedCost === 0 && !match.confirmZeroCost && match.costOverride == null
            ? null
            : storedCost!
          : (proposed?.cost ?? null);
    if (item && match.costOverride != null && match.costOverride !== item.cost) {
      item = { ...item, cost: match.costOverride };
      commands.push({ type: 'item', value: item });
    }
    costs.push(cost);
    if (!item && proposed) {
      if (w.items.some((v) => v.id === proposed.id))
        issues.push(`Line ${i + 1}: this proposed item already exists. Select it from inventory.`);
      const candidates = matchInventory(w, r, line);
      if (candidates.some((c) => c.exact))
        issues.push(
          `Line ${i + 1}: an exact inventory identifier already exists. Select that item instead of creating a duplicate.`,
        );
      if (!proposed.confirmedDistinct)
        issues.push(
          `Line ${i + 1}: confirm this is a new physical item after checking possible matches.`,
        );
      const purchasedAt = importDate(proposed.purchasedAt, w.settings.timezone);
      if (!purchasedAt) issues.push(`Line ${i + 1}: enter the acquisition date for new inventory.`);
      if (purchasedAt && Date.parse(purchasedAt) > (date ? Date.parse(date) : Date.now()))
        issues.push(`Line ${i + 1}: acquisition cannot be after the sale/listing date.`);
      if (!line.title?.trim()) issues.push(`Line ${i + 1}: a new inventory item needs a title.`);
      const parsed = itemSchema.safeParse({
        id: proposed.id,
        sku: proposed.sku,
        title: line.title || '',
        brand: line.brand || '',
        size: line.size || '',
        color: line.color || '',
        category: line.category || 'Other',
        condition: line.condition || '',
        description: clothingDescription(line.description, line.clothing),
        cost: cost ?? 0,
        asking: line.price ?? 0,
        purchasedAt: purchasedAt || new Date(0).toISOString(),
        status: 'Purchased',
        createdAt: new Date().toISOString(),
        notes: match.notes || 'Added through approved screenshot import.',
      });
      if (parsed.success) {
        item = parsed.data;
        commands.push({ type: 'item', value: parsed.data });
      } else
        issues.push(
          `Line ${i + 1}: check the new item SKU, title and attribute lengths (up to 500 characters).`,
        );
    }
    if (!item) issues.push(`Line ${i + 1}: select an inventory item or create one.`);
    if (cost === null && (r.kind !== 'listing' || !match.itemId))
      issues.push(
        `Line ${i + 1}: purchase cost is unknown${item?.cost === 0 ? '; confirm free inventory if zero is correct' : ''}.`,
      );
    if (item) {
      itemIds.push(item.id);
      if (item.status === 'Archived')
        issues.push(`Line ${i + 1}: archived inventory needs review.`);
    }
    if (line.price === null) issues.push(`Line ${i + 1}: enter the merchandise price.`);
  });
  if (new Set(itemIds).size !== itemIds.length)
    issues.push('A physical item appears more than once in this record.');
  const prior = importedSource(w, row);
  if (prior) {
    duplicateId = prior.id;
    duplicateKind = 'import';
    issues.push('This screenshot record has already been imported.');
  }
  let totals: Preview['totals'] = null,
    profits: Preview['profits'] = [];
  if (r.kind === 'sale') {
    if (r.status !== 'completed')
      issues.push(
        'Only confirmed completed sales can be recorded. Offers, pending payments and refunds require review.',
      );
    saleAmounts.forEach((key) => {
      if (r[key] === null)
        issues.push(
          `${amountLabels[key]} is unknown. Enter the amount or explicitly confirm zero.`,
        );
    });
    if (r.refund !== null && r.refund > 0)
      issues.push('Reconcile refunds through the dated ledger on the original order.');
    const existing = w.orders.find(
      (o) =>
        o.marketplace === r.marketplace &&
        !!r.externalOrderId &&
        o.externalId === r.externalOrderId,
    );
    if (existing) {
      duplicateId = existing.id;
      duplicateKind = 'order';
      issues.push(
        'This sale appears to already be recorded. View the original order to reconcile it.',
      );
    }
    row.matches.forEach((m, i) => {
      if (m.itemId && itemIsSold(w, m.itemId)) {
        const sold = w.orders.find(
          (o) =>
            o.lines.some((l) => l.itemId === m.itemId) &&
            itemIsSold({ ...w, orders: [o] }, m.itemId!),
        );
        if (!duplicateId && sold) {
          duplicateId = sold.id;
          duplicateKind = 'order';
        }
        issues.push(
          `Line ${i + 1}: this physical item has already sold. Reconcile the original order or physical return first.`,
        );
      }
    });
    if (
      r.lines.every((l) => l.price !== null) &&
      costs.length === r.lines.length &&
      costs.every((c) => c !== null) &&
      r.marketplace
    ) {
      // Null selling amounts are zero only in this explicitly provisional estimate, never in a ready operation.
      const parsed = orderSchema.safeParse({
        id: row.id,
        marketplace: r.marketplace,
        externalId: r.externalOrderId || '',
        date: date || new Date(0).toISOString(),
        showId: null,
        lines: r.lines.map((l, i) => ({
          itemId: row.matches[i]?.itemId || row.matches[i]?.newItem?.id || row.id,
          price: l.price!,
          costBasis: costs[i]!,
        })),
        fees: r.fees ?? 0,
        processing: r.processing ?? 0,
        shipping: r.shipping ?? 0,
        shippingCollected: r.shippingCollected ?? 0,
        discount: r.discount ?? 0,
        refund: r.refund ?? 0,
        other: r.other ?? 0,
        packaging: 0,
        feeCredit: 0,
        adjustment: 0,
        tips: 0,
        type: 'Sale',
        status: 'Completed',
        fulfillment: 'Unfulfilled',
        payout: 'Pending',
        provenance: 'Screenshot assistant',
        amountsConfirmed: saleAmounts.every((key) => r[key] !== null),
        importKey: `assistant:${row.id}`,
      });
      if (parsed.success) {
        totals = orderTotals(parsed.data);
        profits = lineProfits(parsed.data);
        commands.push({ type: 'order', value: parsed.data });
      } else issues.push('Check the order identifier and required financial fields.');
    }
  } else if (r.kind === 'listing') {
    if (r.status !== 'active')
      issues.push('Only active marketplace listings can be imported here.');
    r.lines.forEach((line, i) => {
      const match = row.matches[i],
        itemId = match?.itemId || match?.newItem?.id;
      if (!itemId || !r.marketplace || line.price === null) return;
      const byId = w.listings.filter(
        (l) =>
          l.marketplace === r.marketplace &&
          ((line.listingId && l.externalId === line.listingId) || (line.url && l.url === line.url)),
      );
      const sameItem = w.listings.filter(
        (l) => l.itemId === itemId && l.marketplace === r.marketplace,
      );
      const existing =
        byId.length === 1 ? byId[0] : sameItem.length === 1 ? sameItem[0] : undefined;
      if (byId.length > 1 || (sameItem.length > 1 && !byId.length))
        issues.push(
          `Line ${i + 1}: more than one marketplace listing matches. Reconcile the existing listings first.`,
        );
      if (existing && existing.itemId !== itemId)
        issues.push(
          `Line ${i + 1}: that marketplace listing is linked to a different inventory item.`,
        );
      if (existing?.externalId && line.listingId && existing.externalId !== line.listingId)
        issues.push(
          `Line ${i + 1}: the existing listing has a different external ID. Reconcile it before updating.`,
        );
      const listedAt = date || existing?.listedAt || new Date().toISOString();

      if (
        !(
          match?.costOverride != null &&
          match.costOverride !== w.items.find((item) => item.id === itemId)?.cost
        ) &&
        existing?.status === 'Active' &&
        existing.price === line.price &&
        (!line.listingId || existing.externalId === line.listingId) &&
        (!line.url || existing.url === line.url)
      ) {
        duplicateId = existing.id;
        duplicateKind = 'listing';
        issues.push(
          `Line ${i + 1}: this listing is already recorded with the same price and identifiers.`,
        );
      }
      const suffix = ((parseInt(row.id.slice(-8), 16) ^ i) >>> 0).toString(16).padStart(8, '0');
      const parsed = listingSchema.safeParse({
        id: existing?.id || row.id.slice(0, -8) + suffix,
        itemId,
        marketplace: r.marketplace,
        price: line.price,
        originalPrice: existing?.originalPrice ?? line.price,
        externalId: line.listingId || existing?.externalId || '',
        url: line.url || existing?.url || '',
        listedAt: listedAt || new Date(0).toISOString(),
        status: 'Active',
        format: existing?.format || 'Fixed price',
        lastSync: existing?.lastSync ?? null,
      });
      if (parsed.success) commands.push({ type: 'listing', value: parsed.data });
      else issues.push(`Line ${i + 1}: check listing identifiers and use an HTTPS URL.`);
    });
  }
  if (!issues.length)
    try {
      commands.reduce(applyCommand, w);
    } catch (e) {
      issues.push(e instanceof Error ? e.message : 'Record validation failed.');
    }
  return {
    row,
    ready: !issues.length && !!commands.length,
    issues,
    duplicateId,
    duplicateKind,
    costs,
    totals,
    profits,
    commands: issues.length ? [] : commands,
  };
}
export function previewBatch(w: Workspace, input: DraftBatch) {
  const batch = batchSchema.parse(input);
  let next = w;
  const seen = new Map<string, string>();
  const listingTargets = new Set<string>();
  const corrections = new Map<string, Set<number>>();
  for (const row of batch.rows.filter((r) => r.included))
    for (const m of row.matches) {
      if (m.itemId && m.costOverride != null) {
        const values = corrections.get(m.itemId) || new Set<number>();
        values.add(m.costOverride);
        corrections.set(m.itemId, values);
      }
    }
  const rank = (row: DraftRow) =>
    row.facts.kind === 'listing' ? 0 : row.facts.kind === 'sale' ? 1 : 2;
  const planned = new Map<string, Preview>();
  for (const row of [...batch.rows].sort((a, b) => rank(a) - rank(b))) {
    const preview = previewRow(next, row);
    if (row.matches.some((m) => m.itemId && (corrections.get(m.itemId)?.size || 0) > 1)) {
      preview.issues.push(
        'Conflicting acquisition-cost corrections for the same physical item. Use one cost before approving.',
      );
      preview.ready = false;
      preview.commands = [];
    }
    if (
      batch.marketplaceContext &&
      row.facts.marketplace !== batch.marketplaceContext &&
      !row.facts.marketplaceIdentification?.confirmedByUser
    ) {
      preview.issues.push(
        `Your request mentions ${batch.marketplaceContext}, but screenshot evidence differs or is unclear. Confirm the marketplace in Edit.`,
      );
      preview.ready = false;
      preview.commands = [];
    }
    if (
      batch.context &&
      (row.facts.kind !== 'listing' ||
        row.facts.lines.length !== 1 ||
        !next.items.some((i) => i.id === batch.context!.itemId) ||
        row.matches.some(
          (m) =>
            m.itemId !== batch.context!.itemId ||
            m.newItem ||
            (m.costOverride != null && !m.costCorrection),
        ))
    ) {
      preview.issues.push(
        'This scan must link one listing to the selected existing item, preserving its inventory details.',
      );
      preview.ready = false;
      preview.commands = [];
    }
    if (row.included && row.facts.kind === 'listing' && preview.ready) {
      const keys = row.matches.map((m) => `${row.facts.marketplace}:${m.itemId || m.newItem?.id}`);
      if (keys.some((key) => listingTargets.has(key))) {
        preview.issues.push(
          'Another included screenshot already proposes this physical item on the same marketplace. Keep one current listing view.',
        );
        preview.ready = false;
        preview.commands = [];
      } else keys.forEach((key) => listingTargets.add(key));
    }
    const key =
      row.facts.kind === 'sale' && row.facts.externalOrderId
        ? `${row.facts.marketplace}:${row.facts.externalOrderId}`
        : '';
    if (row.included && key && seen.has(key)) {
      preview.issues.push(
        'Another included screenshot has this order ID. Keep one complete order and exclude the repeated screenshot.',
      );
      preview.ready = false;
    }
    if (row.included && key) seen.set(key, row.id);
    if (row.included && preview.ready) next = preview.commands.reduce(applyCommand, next);
    planned.set(row.id, preview);
  }
  return batch.rows.map((row) => planned.get(row.id)!);
}

/** Only explicit row IDs may produce commands; a single invalid selected row rejects the batch. */
export function approvalCommands(
  w: Workspace,
  input: DraftBatch,
  rowIds: string[],
  at = new Date().toISOString(),
): Command[] {
  const batch = batchSchema.parse(input);
  if (!rowIds.length || new Set(rowIds).size !== rowIds.length)
    throw new Error('Select at least one ready record, without duplicates.');
  const previews = previewBatch(w, {
    ...batch,
    rows: batch.rows.map((row) => ({ ...row, included: row.included && rowIds.includes(row.id) })),
  });
  const commands: Command[] = [];
  const rank = (id: string) => {
    const kind = batch.rows.find((r) => r.id === id)?.facts.kind;
    return kind === 'listing' ? 0 : kind === 'sale' ? 1 : 2;
  };
  for (const id of [...rowIds].sort((a, b) => rank(a) - rank(b))) {
    const p = previews.find((p) => p.row.id === id);
    if (!p || !p.row.included || !p.ready)
      throw new Error(
        p?.issues.join(' ') || 'A selected row is no longer ready. Review the batch again.',
      );
    const row = p.row;
    const screenshot = batch.screenshots.find((s) => s.hash === row.sourceHash);
    if (
      row.sourceHash === 'conversation'
        ? !isLifecycle(row.facts.kind)
        : !screenshot || !screenshot.extraction.records[row.recordIndex]
    )
      throw new Error('The original screenshot extraction is missing.');
    commands.push(...p.commands, {
      type: 'import',
      value: {
        id: row.id,
        filename: `${row.sourceHash === 'conversation' ? 'assistant-action' : 'screenshots'}-${batch.id}.json`,
        kind: row.facts.kind === 'listing' ? 'Listings' : 'Sales',
        importedAt: at,
        rawCsv: JSON.stringify({
          version: 1,
          batchId: batch.id,
          rows: [{ sourceHash: row.sourceHash, recordIndex: row.recordIndex }],
          screenshot: {
            hash: screenshot?.hash,
            name: screenshot?.name,
            reference: screenshot?.reference,
            identification: screenshot?.extraction.identification,
            processing: screenshot?.processing,
          },
          extracted: screenshot?.extraction.records[row.recordIndex] || null,
          origin: row.sourceHash === 'conversation' ? 'conversation' : 'screenshot',
          intent: row.intent,
          corrected: row.facts,
          listingDateInferred:
            row.facts.kind === 'listing' &&
            !row.facts.date &&
            !p.commands.some(
              (c) => c.type === 'listing' && w.listings.some((l) => l.id === c.value.id),
            ),
          eventTarget: {
            orderId: row.orderId,
            itemIds: row.targetItemIds,
            confirmPackage: row.confirmPackage,
            confirmPhysicalReturn: row.confirmPhysicalReturn,
            applyRefund: row.applyRefund,
          },
          matches: row.matches,
          context: batch.context,
          marketplaceContext: batch.marketplaceContext,
        }),
        mapping: { format: 'assistant-v1', batchId: batch.id },
        recordIds: p.commands.flatMap((c) => ('id' in c.value ? [c.value.id] : [])),
      },
    });
  }
  commands.reduce(applyCommand, w);
  return commands;
}
export function alreadyApproved(w: Workspace, batch: DraftBatch, rowIds: string[]) {
  return (
    rowIds.length > 0 &&
    rowIds.every((id) =>
      w.imports.some(
        (i) => i.id === id && i.mapping.format === 'assistant-v1' && i.mapping.batchId === batch.id,
      ),
    )
  );
}
