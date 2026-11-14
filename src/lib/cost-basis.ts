import type { Order, Workspace } from './model';
/** Original sale lines stay immutable; explicit corrections supply the revised acquisition basis. */
export function correctedCostBasis(w: Workspace, order: Order, itemId: string) {
  const original = order.lines.find((l) => l.itemId === itemId)?.costBasis ?? 0;
  return (
    original +
    w.financialEvents
      .filter(
        (e) =>
          e.orderId === order.id && e.kind === 'Cost basis adjustment' && e.costItemId === itemId,
      )
      .reduce((sum, e) => sum + e.amount, 0)
  );
}
export function hasCostConfirmation(w: Workspace, orderId: string, itemId: string) {
  return w.financialEvents.some(
    (e) => e.orderId === orderId && e.kind === 'Cost basis adjustment' && e.costItemId === itemId,
  );
}
