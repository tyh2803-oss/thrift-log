import { applyCommand } from '../commands';
import { zoneMidnight } from '../dates';
import { itemIsSold } from '../ledger';
import { orderSchema, type Command, type Item, type Order, type Workspace } from '../model';
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
  const issues: string[] = [];
  const commands: Command[] = [];
  const r = row.facts;
  const date = importDate(r.date, w.settings.timezone);
  let duplicateId: string | null = null,
    duplicateKind: Preview['duplicateKind'] = null;
  if (!r.marketplace) issues.push('Choose the marketplace.');
  if (r.currency !== 'USD')
    issues.push('Confirm the amounts are USD. Currency conversion is not supported.');
  if (!date) issues.push('Enter a valid date (YYYY-MM-DD or timestamp with timezone).');
  if (date && Date.parse(date) > Date.now() + 300000)
    issues.push('The record date cannot be in the future.');
  if (r.kind === 'other') issues.push('This screenshot is not a sale or active listing.');
  if (r.warnings.length && !row.acknowledgedWarnings)
    issues.push('Review and acknowledge the extraction warnings.');
  if (row.matches.length !== r.lines.length)
    issues.push('Every physical line needs an inventory match.');
  const costs: (number | null)[] = [];
  const items: (Item | undefined)[] = [];
  row.matches.forEach((match, i) => {
    const line = r.lines[i];
    if (!line) return;
    const item = w.items.find((item) => item.id === match.itemId);
    items.push(item);
    // Zero in legacy inventory is potentially missing; require an explicit free-item confirmation.
    const cost = item
      ? item.cost === 0 && !match.confirmZeroCost
        ? null
        : item.cost
      : (match.newItem?.cost ?? null);
    costs.push(cost);
    if (!item)
      issues.push(
        `Line ${i + 1}: select an inventory item${r.kind === 'listing' ? ' or create one' : ''}.`,
      );
    if (cost === null)
      issues.push(
        `Line ${i + 1}: purchase cost is unknown${item?.cost === 0 ? '; confirm free inventory if zero is correct' : ''}.`,
      );
    if (item && ['Archived'].includes(item.status))
      issues.push(`Line ${i + 1}: archived inventory needs review.`);
    if (line.price === null) issues.push(`Line ${i + 1}: enter the merchandise price.`);
  });
  if (row.matches.some((m) => m.newItem))
    issues.push('New inventory creation is not yet available at this checkpoint.');
  const itemIds = row.matches.map((m) => m.itemId).filter(Boolean);
  if (new Set(itemIds).size !== itemIds.length)
    issues.push('A physical item appears more than once in this record.');
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
    const prior = importedSource(w, row);
    if (prior && !duplicateId) {
      duplicateId = prior.id;
      duplicateKind = 'import';
      issues.push('This screenshot record has already been imported.');
    }
    row.matches.forEach((m, i) => {
      if (m.itemId && itemIsSold(w, m.itemId)) {
        const sold = w.orders.find(
          (o) =>
            o.status === 'Completed' &&
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
  } else if (r.kind === 'listing')
    issues.push('Listing approval is not yet available at this checkpoint.');
  let totals: Preview['totals'] = null,
    profits: Preview['profits'] = [];
  const allPrices = r.lines.every((l) => l.price !== null);
  if (
    r.kind === 'sale' &&
    allPrices &&
    costs.length === r.lines.length &&
    costs.every((c) => c !== null) &&
    r.marketplace
  ) {
    // Missing selling amounts are zero only for this explicitly provisional estimate, never for a commit.
    const order: Order = orderSchema.parse({
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
      importKey: `assistant:${row.id}`,
    });
    totals = orderTotals(order);
    profits = lineProfits(order);
    if (!issues.length) {
      try {
        applyCommand(w, { type: 'order', value: order });
        commands.push({ type: 'order', value: order });
      } catch (e) {
        issues.push(e instanceof Error ? e.message : 'Sale validation failed.');
      }
    }
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
    commands,
  };
}
export function previewBatch(w: Workspace, input: DraftBatch) {
  const batch = batchSchema.parse(input);
  let next = w;
  const seen = new Map<string, string>();
  return batch.rows.map((row) => {
    const preview = previewRow(next, row);
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
    return preview;
  });
}
