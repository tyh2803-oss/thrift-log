import type { Workspace } from './model';
import { confirmedFreeInventory } from './assistant/listing-review';
import { hasCostConfirmation } from './cost-basis';
const costCache = new WeakMap<
  Workspace,
  {
    imports: Workspace['imports'];
    orders: Workspace['orders'];
    financialEvents: Workspace['financialEvents'];
    eventCount: number;
    importCount: number;
    orderCount: number;
    value: Map<string, Set<string>>;
  }
>();
/** New history imports explicitly distinguish unknown costs from confirmed zero, durably. */
export function historyUnknownCosts(w: Workspace): Map<string, Set<string>> {
  // The workspace provider and command layer install immutable snapshots. Reuse proofs
  // during timer/render ticks instead of reparsing every receipt for every item.
  const cached = costCache.get(w);
  if (
    cached &&
    cached.imports === w.imports &&
    cached.orders === w.orders &&
    cached.financialEvents === w.financialEvents &&
    cached.eventCount === w.financialEvents.length &&
    cached.importCount === w.imports.length &&
    cached.orderCount === w.orders.length
  )
    return cached.value;
  const result = new Map<string, Set<string>>();
  for (const receipt of w.imports) {
    if (
      !['assistant-v1', 'whatnot-v1'].includes(receipt.mapping.format) ||
      receipt.mapping.history !== 'true'
    )
      continue;
    try {
      const audit = JSON.parse(receipt.rawCsv);
      const order = w.orders.find((o) => o.id === receipt.id);
      if (order)
        result.set(
          order.id,
          new Set(
            (audit.unknownCostItemIds || []).filter(
              (id: string) =>
                order.lines.some((l) => l.itemId === id && l.costBasis === 0) &&
                !hasCostConfirmation(w, order.id, id),
            ),
          ),
        );
    } catch {
      /* An unreadable receipt does not turn an explicit unknown into a confirmed zero. */
    }
  }
  costCache.set(w, {
    imports: w.imports,
    orders: w.orders,
    financialEvents: w.financialEvents,
    eventCount: w.financialEvents.length,
    importCount: w.imports.length,
    orderCount: w.orders.length,
    value: result,
  });
  return result;
}
export function historyCostUnknown(w: Workspace, orderId: string, itemId?: string | null) {
  const ids = historyUnknownCosts(w).get(orderId);
  return itemId ? !!ids?.has(itemId) : !!ids?.size;
}
export function assumedHistoryAcquisition(w: Workspace, itemId: string) {
  return w.imports.some((r) => {
    if (r.mapping.history !== 'true') return false;
    try {
      return (
        JSON.parse(r.rawCsv).assumedAcquisitionItemIds?.includes(itemId) &&
        w.items.find((i) => i.id === itemId)?.purchasedAt ===
          w.orders.find((o) => o.id === r.id)?.date
      );
    } catch {
      return false;
    }
  });
}

export function historyInventoryCostUnknown(w: Workspace, itemId: string) {
  return (
    w.items.find((i) => i.id === itemId)?.cost === 0 &&
    !confirmedFreeInventory(w, itemId) &&
    [...historyUnknownCosts(w).values()].some((ids) => ids.has(itemId))
  );
}

const whatnotPendingCache = new WeakMap<Workspace, Set<string>>();
/** Only managed API receipts mark missing seller fees; legacy/manual records are unchanged. */
export function whatnotFinancialPending(w: Workspace, orderId: string) {
  let ids = whatnotPendingCache.get(w);
  if (!ids) {
    ids = new Set<string>();
    for (const receipt of w.imports) {
      if (receipt.mapping.whatnot !== 'true') continue;
      try {
        if (JSON.parse(receipt.rawCsv).whatnotFinancialsPending === true) ids.add(receipt.id);
      } catch {
        ids.add(receipt.id);
      }
    }
    whatnotPendingCache.set(w, ids);
  }
  return ids.has(orderId);
}
