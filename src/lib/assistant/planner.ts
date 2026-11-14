import { listingAmount, listingCost } from './listing-review';
import { blockingWarnings } from './warnings';
import { isLifecycle, lifecyclePreview } from './lifecycle';
import { listingEvidenceIssue, requireMarketplaceReview } from './vision';
import { clothingDescription } from './clothing';
import { applyCommand } from '../commands';
import { zoneMidnight } from '../dates';
import { itemIsSold } from '../ledger';
import { orderSchema, itemSchema, listingSchema, type Command, type Workspace } from '../model';
import { orderTotals, lineProfits } from '../money';
import { batchSchema, type DraftBatch, type DraftRow } from './drafts';
import { unsoldStageCommands } from '../unsold-stage';

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

export function previewRow(
  w: Workspace,
  row: DraftRow,
  identity: { inventory: Workspace; createdDraftIds: ReadonlySet<string> } = {
    inventory: w,
    createdDraftIds: new Set(),
  },
): Preview {
  const issues: string[] = [],
    commands: Command[] = [];
  const r = row.facts,
    date = importDate(r.date, w.settings.timezone);
  let duplicateId: string | null = null,
    duplicateKind: Preview['duplicateKind'] = null;
  if (row.inventoryStage) {
    try {
      if (
        row.sourceHash !== 'conversation' ||
        !row.intent?.trim() ||
        row.matches.length !== 1 ||
        !row.matches[0].itemId ||
        row.matches[0].newItem
      )
        throw new Error(
          'A status proposal must identify one existing physical item and its request.',
        );
      commands.push(
        ...unsoldStageCommands(
          w,
          row.matches[0].itemId,
          row.inventoryStage,
          !!row.confirmStatusImpact,
        ),
      );
      commands.reduce(applyCommand, w);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : 'Review the status change.');
    }
    return {
      row,
      ready: !issues.length && !!commands.length,
      issues,
      duplicateId,
      duplicateKind,
      costs: [],
      totals: null,
      profits: [],
      commands: issues.length ? [] : commands,
    };
  }
  if (row.sourceHash === 'conversation' && row.matches.some((match) => match.newItem))
    issues.push(
      'Text commands must match existing inventory. Use inventory or file import to create a new physical item.',
    );
  if (isLifecycle(r.kind)) {
    const event = lifecyclePreview(w, row, date);
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
    let item = w.items.find(
      (v) =>
        v.id === match.itemId || (v.id === match.newItem?.id && identity.createdDraftIds.has(v.id)),
    );
    if (match.itemId && match.newItem)
      issues.push(`Line ${i + 1}: choose existing or new inventory, not both.`);
    for (const [field, raw] of [
      ['purchase cost', match.costInput],
      ['listing price', match.priceInput],
    ] as const) {
      if (raw !== undefined && listingAmount(raw).error)
        issues.push(`Line ${i + 1}: ${field} — ${listingAmount(raw).error}`);
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
      const purchasedAt = importDate(proposed.purchasedAt, w.settings.timezone);
      if (!purchasedAt) issues.push(`Line ${i + 1}: enter the acquisition date for new inventory.`);
      // An explicitly labeled listing-date assumption is provisional, not historical evidence.
      // Confirmed acquisition dates and every sale retain the chronological safeguard.
      const acquisitionDeadline =
        r.kind === 'listing' && proposed.assumedAcquisitionDate
          ? Date.now()
          : date
            ? Date.parse(date)
            : Date.now();
      if (purchasedAt && Date.parse(purchasedAt) > acquisitionDeadline)
        issues.push(`Line ${i + 1}: acquisition cannot be after the sale/listing date.`);
      if (!line.title?.trim()) issues.push(`Line ${i + 1}: a new inventory item needs a title.`);
      const parsed = itemSchema.safeParse({
        id: proposed.id,
        sku: w.items.some((v) => v.sku.toLowerCase() === proposed.sku.toLowerCase())
          ? `AI-${proposed.id}`
          : proposed.sku,
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
        notes: [
          proposed.assumedAcquisitionDate
            ? `Acquisition date ${proposed.purchasedAt} was assumed and accepted at import approval.`
            : '',
          match.notes || 'Added through approved screenshot import.',
        ]
          .filter(Boolean)
          .join(' ')
          .slice(0, 500),
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
        `Line ${i + 1}: purchase cost is unknown${match.itemId && item?.cost === 0 ? '; confirm free inventory if zero is correct' : ''}.`,
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
        externalId: existing ? '' : r.externalOrderId || '',
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
        byId.find((l) => l.itemId === itemId) ||
        sameItem.find((l) => l.status === 'Active') ||
        sameItem[0];
      const sourceId = line.listingId || '';
      const externalId =
        existing?.externalId ||
        (w.listings.some((l) => l.marketplace === r.marketplace && l.externalId === sourceId)
          ? ''
          : sourceId);
      const listedAt = date || existing?.listedAt || new Date().toISOString();

      const suffix = ((parseInt(row.id.slice(-8), 16) ^ i) >>> 0).toString(16).padStart(8, '0');
      const parsed = listingSchema.safeParse({
        id: existing?.id || row.id.slice(0, -8) + suffix,
        itemId,
        marketplace: r.marketplace,
        price: line.price,
        originalPrice: existing?.originalPrice ?? line.price,
        externalId,
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
  const createdDraftIds = new Set<string>();
  const draftValues = new Map<string, Set<string>>();
  for (const row of batch.rows.filter((r) => r.included && r.facts.kind === 'listing'))
    for (const m of row.matches)
      if (m.newItem) {
        const values = draftValues.get(m.newItem.id) || new Set<string>();
        values.add(JSON.stringify([m.newItem.sku, m.newItem.cost, m.newItem.purchasedAt]));
        draftValues.set(m.newItem.id, values);
      }
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
    const preview = previewRow(next, row, { inventory: w, createdDraftIds });
    if (row.matches.some((m) => m.newItem && (draftValues.get(m.newItem.id)?.size || 0) > 1)) {
      preview.issues.push(
        'Cross-listings disagree on purchase cost, SKU or acquisition date. Use one value for this physical item.',
      );
      preview.ready = false;
      preview.commands = [];
    }
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
        `Your request mentions ${batch.marketplaceContext}, but screenshot evidence differs or is unclear. Confirm the marketplace on the listing card or in Edit.`,
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
    if (row.included && preview.ready) {
      for (const command of preview.commands)
        if (command.type === 'item' && !w.items.some((item) => item.id === command.value.id))
          createdDraftIds.add(command.value.id);
      next = preview.commands.reduce(applyCommand, next);
    }
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
  for (const id of [...rowIds].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      batch.rows.findIndex((r) => r.id === a) - batch.rows.findIndex((r) => r.id === b),
  )) {
    const p = previews.find((p) => p.row.id === id);
    if (!p || !p.row.included || !p.ready)
      throw new Error(p?.issues[0] || 'A selected row is no longer ready. Review the batch again.');
    const row = p.row;
    const screenshot = batch.screenshots.find((s) => s.hash === row.sourceHash);
    if (
      row.sourceHash === 'conversation'
        ? !(
            isLifecycle(row.facts.kind) ||
            row.inventoryStage ||
            (['sale', 'listing'].includes(row.facts.kind) &&
              !!row.intent?.trim() &&
              row.matches.every((m) => m.itemId && !m.newItem))
          )
        : !screenshot || !screenshot.extraction.records[row.recordIndex]
    )
      throw new Error('The original screenshot extraction is missing.');
    commands.push(...p.commands, {
      type: 'import',
      value: {
        id: row.id,
        filename: `${row.sourceHash === 'conversation' ? 'assistant-action' : 'screenshots'}-${batch.id}.json`,
        kind: row.inventoryStage
          ? 'Inventory'
          : row.facts.kind === 'listing'
            ? 'Listings'
            : 'Sales',
        importedAt: at,
        rawCsv: JSON.stringify({
          version: 1,
          batchId: batch.id,
          rows: [{ sourceHash: row.sourceHash, recordIndex: row.recordIndex }],
          screenshot: {
            hash: screenshot?.hash,
            name: screenshot?.name,
            reference: screenshot?.reference,
            chatFileId: screenshot?.chatFileId,
            identification: screenshot?.extraction.identification,
            processing: screenshot?.processing,
          },
          extracted: screenshot?.extraction.records[row.recordIndex] || null,
          origin: row.sourceHash === 'conversation' ? 'conversation' : 'screenshot',
          intent: row.intent,
          inventoryStage: row.inventoryStage,
          confirmStatusImpact: row.confirmStatusImpact,
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
          authorization: {
            kind: 'final-approval',
            newItemIds: row.matches.flatMap((m) => (m.newItem ? [m.newItem.id] : [])),
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
