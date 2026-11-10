import type { Workspace } from '../model';
import type { DraftBatch, DraftRow } from './drafts';
import { returnedItemIds } from '../ledger';
/** Resolve a saved physical piece conservatively; prepare only, never commit. */
export function prepareSpokenFulfillment(
  w: Workspace,
  message: string,
): { row?: DraftRow; message: string } | null {
  const match = message
    .trim()
    .match(/^mark\s+(?:the\s+)?(.+?)\s+(shipped|fulfilled|delivered)[.!]?$/i);
  if (!match) return null;
  const name = match[1].toLowerCase();
  const words = name.match(/[a-z0-9]+/g) || [];
  const items = w.items.filter(
    (i) =>
      i.title.toLowerCase().includes(name) ||
      i.sku.toLowerCase() === name ||
      (words.length > 0 &&
        words.every((word) =>
          `${i.title} ${i.brand}`
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .includes(word),
        )),
  );
  if (items.length !== 1)
    return {
      message:
        'Which saved inventory item do you mean? Give its full title or SKU so I can identify one physical piece.',
    };
  const item = items[0];
  const orders = w.orders.filter(
    (o) =>
      o.status === 'Completed' &&
      o.lines.some((l) => l.itemId === item.id) &&
      !returnedItemIds(w, o.id).has(item.id),
  );
  if (orders.length !== 1)
    return {
      message:
        'I could not confirm one saved sale for that item. Approve its sale first or choose the original order.',
    };
  const order = orders[0],
    delivered = match[2].toLowerCase() === 'delivered';
  return {
    message: `Prepared ${delivered ? 'delivery' : order.marketplace === 'In person' ? 'handover' : 'shipment'} for ${item.title}. Review and approve; no additional sale will be created.`,
    row: {
      id: crypto.randomUUID(),
      sourceHash: 'conversation',
      recordIndex: 0,
      included: true,
      acknowledgedWarnings: true,
      intent: message.slice(0, 500),
      orderId: order.id,
      targetItemIds: [item.id],
      matches: [{ itemId: item.id, newItem: null, confirmZeroCost: item.cost === 0 }],
      facts: {
        kind: 'fulfillment',
        status: delivered ? 'delivered' : 'shipped',
        marketplace: order.marketplace,
        currency: 'USD',
        date: new Date().toISOString(),
        externalOrderId: order.externalId || null,
        fees: null,
        processing: null,
        shipping: null,
        shippingCollected: null,
        discount: null,
        refund: null,
        other: null,
        warnings: [],
        event: {
          type: delivered ? 'delivered' : 'shipped',
          confidence: 'uncertain',
          confirmedByUser: true,
          scope: 'items',
          evidence: ['Explicit user request for an existing saved sale'],
          carrier: null,
          tracking: null,
          labelCost: null,
          externalEventId: null,
        },
        lines: [
          {
            title: item.title,
            brand: item.brand,
            size: item.size,
            color: item.color,
            category: item.category,
            condition: item.condition,
            description: item.description,
            sku: item.sku,
            externalProductId: null,
            listingId: null,
            url: null,
            price: null,
          },
        ],
      },
    },
  };
}
export function appendConversationRow(
  batch: DraftBatch | null,
  w: Workspace,
  row: DraftRow,
): DraftBatch {
  return batch
    ? { ...batch, rows: [...batch.rows, row] }
    : { id: crypto.randomUUID(), revision: w.revision, screenshots: [], rows: [row] };
}
