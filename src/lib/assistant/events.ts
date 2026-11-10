import type { DraftRow } from './drafts';
import type { ExtractedRecord } from './schema';
export const eventNames = {
  active_listing: 'Active listing → For Sale',
  completed_sale: 'Completed sale → Sold',
  shipped: 'Shipment → Shipped',
  delivered: 'Delivered → Shipped',
  cancelled: 'Cancellation',
  refunded: 'Refund',
  returned: 'Physical return',
  ambiguous: 'Uncertain — confirm event',
} as const;
export function changeEvent(row: DraftRow, type: keyof typeof eventNames): DraftRow {
  const kind =
    type === 'active_listing'
      ? 'listing'
      : type === 'completed_sale'
        ? 'sale'
        : ['shipped', 'delivered'].includes(type)
          ? 'fulfillment'
          : type === 'cancelled'
            ? 'cancellation'
            : type === 'refunded'
              ? 'refund'
              : type === 'returned'
                ? 'return'
                : 'other';
  const status =
    type === 'active_listing'
      ? 'active'
      : type === 'completed_sale'
        ? 'completed'
        : type === 'ambiguous'
          ? 'unknown'
          : type;
  return {
    ...row,
    facts: {
      ...row.facts,
      kind,
      status: status as ExtractedRecord['status'],
      event: {
        type,
        confidence: row.facts.event?.confidence || 'uncertain',
        evidence: row.facts.event?.evidence || [],
        scope: row.facts.event?.scope || 'unknown',
        carrier: row.facts.event?.carrier || null,
        tracking: row.facts.event?.tracking || null,
        labelCost: row.facts.event?.labelCost ?? null,
        externalEventId: row.facts.event?.externalEventId || null,
        confirmedByUser: type !== 'ambiguous',
      },
    },
  };
}
