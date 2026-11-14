import { z } from 'zod';
import { marketplaces, type Workspace } from '../model';
import { inventoryStages } from '../pipeline';
import { localDay, zoneMidnight } from '../dates';
import { batchSchema, type DraftBatch, type DraftRow } from './drafts';
const text = z.string().max(500).nullable();
const amount = z.number().int().min(0).max(100_000_000).nullable();
export const inventoryToolSchema = z.strictObject({
  changes: z
    .array(
      z.strictObject({
        action: z.enum(['create', 'edit', 'cost', 'stage']),
        proposalId: z.string().uuid().nullable(),
        itemIds: z.array(z.string().uuid()).max(200),
        evidence: z.string().min(1).max(500),
        title: text,
        sku: text,
        brand: text,
        category: text,
        size: text,
        color: text,
        condition: text,
        description: text,
        source: text,
        storage: text,
        notes: text,
        purchaseCost: amount,
        askingPrice: amount,
        acquisitionDate: text,
        acquisitionDateEvidence: text,
        destination: z.enum(inventoryStages).nullable(),
        marketplace: z.enum(marketplaces).nullable(),
        eventDate: text,
        eventDateEvidence: text,
      }),
    )
    .min(1)
    .max(20),
});
export async function prepareInventoryChanges(
  w: Workspace,
  initial: DraftBatch | null,
  raw: unknown,
  transcript: string,
  seen: ReadonlySet<string>,
  now: Date,
  date: (value: string | null, evidence: string | null) => string | null,
  pendingIds: ReadonlySet<string> = new Set(),
) {
  const { changes } = inventoryToolSchema.parse(raw);
  let batch = initial ? structuredClone(initial) : null;
  for (const a of changes) {
    if (!transcript.toLowerCase().includes(a.evidence.toLowerCase()))
      throw new Error('Quote the user’s inventory request.');
    const existing = a.proposalId
      ? batch?.rows.find((r) => r.id === a.proposalId && r.inventoryChange)
      : undefined;
    if (a.proposalId && !existing)
      throw new Error('Read the pending inventory proposal before editing it.');
    const action =
      existing?.inventoryChange?.action === 'create' &&
      ['create', 'edit', 'cost'].includes(a.action)
        ? 'create'
        : a.action;
    const targetIds =
      action === 'create' ? [existing?.inventoryChange?.itemId || crypto.randomUUID()] : a.itemIds;
    if (!targetIds.length || new Set(targetIds).size !== targetIds.length)
      throw new Error('Choose the physical inventory items to change.');
    if (action !== 'create')
      for (const id of targetIds)
        if (!seen.has(id) || (!w.items.some((i) => i.id === id) && !pendingIds.has(id)))
          throw new Error('Search or read each owned inventory item first.');
    if (
      existing &&
      action !== 'stage' &&
      (targetIds.length !== 1 || existing.inventoryChange?.itemId !== targetIds[0])
    )
      throw new Error('Keep the pending proposal linked to its original item.');
    const ids = action === 'stage' ? [targetIds[0]] : targetIds;
    for (const itemId of ids) {
      const old = existing?.inventoryChange;
      const patch = { ...(old?.patch || {}) };
      for (const k of [
        'title',
        'sku',
        'brand',
        'category',
        'size',
        'color',
        'condition',
        'description',
        'source',
        'storage',
        'notes',
      ] as const)
        if (a[k] !== null) patch[k] = a[k];
      if (a.askingPrice !== null) patch.asking = a.askingPrice;
      const acquisition = date(a.acquisitionDate, a.acquisitionDateEvidence);
      if (acquisition) patch.purchasedAt = acquisition;
      if (action === 'create' && !patch.purchasedAt)
        patch.purchasedAt = localDay(now, w.settings.timezone);
      const eventDay = date(a.eventDate, a.eventDateEvidence);
      if (action === 'stage' && a.purchaseCost !== null)
        throw new Error('Use a separate cost proposal for purchase-cost changes.');
      if (action === 'cost' && a.askingPrice !== null)
        throw new Error('Use edit to change asking value.');
      const destination = a.destination ?? old?.move?.destination ?? null;
      const move = destination
        ? {
            id: old?.move?.id || crypto.randomUUID(),
            revision: w.revision,
            destination,
            date: eventDay
              ? new Date(zoneMidnight(eventDay, w.settings.timezone)).toISOString()
              : old?.move?.date || now.toISOString(),
            confirmConsequences: false,
            items: (action === 'stage' ? targetIds : [itemId]).map((id) => ({
              itemId: id,
              ...(destination === 'for-sale'
                ? {
                    listing: {
                      marketplace:
                        a.marketplace ??
                        old?.move?.items.find((i) => i.itemId === id)?.listing?.marketplace ??
                        null,
                      price:
                        a.askingPrice ??
                        old?.move?.items.find((i) => i.itemId === id)?.listing?.price ??
                        (w.items.find((i) => i.id === id)?.asking || null),
                    },
                  }
                : {}),
            })),
          }
        : null;
      if (action === 'stage' && !move) throw new Error('Choose the destination pipeline stage.');
      if (action === 'create' && move && ['sold', 'shipped'].includes(move.destination))
        throw new Error(
          'Create the item first, then prepare its actual sale with price, date and fees before shipping.',
        );
      if (
        action === 'stage' &&
        move?.destination === 'sold' &&
        targetIds.some(
          (id) =>
            !w.orders.some(
              (o) => o.status === 'Completed' && o.lines.some((l) => l.itemId === id),
            ) &&
            !batch?.rows.some(
              (r) =>
                r.included && r.facts.kind === 'sale' && r.matches.some((m) => m.itemId === id),
            ),
        )
      )
        throw new Error(
          'Use prepare_changes with action sale for new sales. Collect actual sale price, marketplace, date and charges; never use asking value as proceeds.',
        );
      if (
        (action === 'cost' || action === 'stage') &&
        Object.keys(patch).some((k) => k !== 'asking')
      )
        throw new Error(
          'Use edit for item details; cost and stage actions target existing records.',
        );
      const row: DraftRow = {
        id: existing?.id || crypto.randomUUID(),
        sourceHash: 'conversation',
        recordIndex: 0,
        included: true,
        intent: a.evidence,
        matches: [],
        acknowledgedWarnings: false,
        inventoryChange: {
          invalidFields: (old?.invalidFields || []).filter(
            (f) =>
              !(a.purchaseCost !== null && f === 'purchaseCost') &&
              !(a.askingPrice !== null && (f === 'asking' || f.startsWith('listingPrice-'))),
          ),
          action,
          itemId,
          patch: action === 'stage' ? {} : patch,
          purchaseCost: a.purchaseCost ?? old?.purchaseCost ?? null,
          costOperationId: old?.costOperationId || crypto.randomUUID(),
          confirmCostCorrection: false,
          assumedAcquisitionDate:
            action === 'create' && !acquisition && (old?.assumedAcquisitionDate ?? true),
          move,
        },
        facts: {
          kind: 'other',
          status: 'unknown',
          marketplace: null,
          currency: 'USD',
          date: null,
          externalOrderId: null,
          lines: [],
          fees: null,
          processing: null,
          shipping: null,
          shippingCollected: null,
          discount: null,
          refund: null,
          other: null,
          warnings: [],
        },
      };
      if (existing)
        batch = { ...batch!, rows: batch!.rows.map((r) => (r.id === existing.id ? row : r)) };
      else
        batch = batch
          ? { ...batch, rows: [...batch.rows, row] }
          : { id: crypto.randomUUID(), revision: w.revision, screenshots: [], rows: [row] };
    }
  }
  if (batch && batch.rows.length > 300)
    throw new Error('Approve or discard some pending proposals before adding more.');
  return batchSchema.parse(batch);
}
