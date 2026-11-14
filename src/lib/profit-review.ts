import type { Workspace } from './model';
import { orderPostings } from './ledger';
import { historyUnknownCosts, whatnotFinancialPending } from './cost-knowledge';

/** Use the same dated postings and net returned units as the dashboard's metrics. */
export function profitReview(w: Workspace, range: [number, number]) {
  const postings = orderPostings(w, ...range),
    unknown = historyUnknownCosts(w),
    positions = new Map<string, { itemId: string; units: number }>(),
    fees = new Set<string>();
  for (const p of postings) {
    if (whatnotFinancialPending(w, p.orderId)) fees.add(p.orderId);
    if (!p.itemId || !unknown.get(p.orderId)?.has(p.itemId)) continue;
    const key = `${p.orderId}:${p.itemId}`;
    const position = positions.get(key) || { itemId: p.itemId, units: 0 };
    position.units += p.units;
    positions.set(key, position);
  }
  return {
    itemIds: [
      ...new Set([...positions.values()].filter((p) => p.units !== 0).map((p) => p.itemId)),
    ],
    feeOrderIds: [...fees],
  };
}
