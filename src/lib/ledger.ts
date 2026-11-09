import type { FinancialEvent, Order, Workspace } from './model';
import { allocate, orderTotals } from './money';
export type Posting = {
  id: string;
  date: string;
  orderId: string;
  showId: string | null;
  marketplace: Order['marketplace'];
  itemId: string | null;
  revenue: number;
  cogs: number;
  fees: number;
  direct: number;
  gross: number;
  units: number;
};
export function returnedItemIds(w: Workspace, orderId: string, asOf = Infinity) {
  const events = w.financialEvents.filter(
    (e) => e.orderId === orderId && Date.parse(e.date) <= asOf,
  );
  const reversed = new Set(events.filter((e) => e.reversesId).map((e) => e.reversesId));
  return new Set(
    events.filter((e) => !e.reversesId && !reversed.has(e.id)).flatMap((e) => e.itemIds),
  );
}
export function itemIsSold(w: Workspace, itemId: string, exceptOrderId?: string) {
  return w.orders.some(
    (o) =>
      o.id !== exceptOrderId &&
      o.status === 'Completed' &&
      o.lines.some((l) => l.itemId === itemId) &&
      !returnedItemIds(w, o.id).has(itemId),
  );
}
function eventPostings(w: Workspace, event: FinancialEvent): Posting[] {
  const base = event.reversesId ? w.financialEvents.find((e) => e.id === event.reversesId) : event;
  if (!base) return [];
  const order = w.orders.find((o) => o.id === event.orderId);
  if (!order) return [];
  const sign = event.reversesId ? -1 : 1;
  const lines = order.lines.length ? order.lines : [{ itemId: null, price: 0, costBasis: 0 }];
  const targets =
    base.kind === 'Refund' && base.itemIds.length
      ? lines.map((l) => l.itemId !== null && base.itemIds.includes(l.itemId))
      : lines.map(() => true);
  const weights = lines.map((l, i) => (targets[i] ? l.price : 0));
  // A zero-price targeted lot still allocates to the selected physical pieces only.
  const effective = weights.every((v) => v === 0) ? targets.map((v) => (v ? 1 : 0)) : weights;
  const revenue = allocate(
    base.kind === 'Refund' ? -base.amount : base.kind === 'Revenue adjustment' ? base.amount : 0,
    effective,
  );
  const fees = allocate(base.kind === 'Fee adjustment' ? base.amount : 0, effective);
  const direct = allocate(base.kind === 'Direct cost adjustment' ? base.amount : 0, effective);
  return lines.map((line, i) => ({
    id: event.id,
    date: event.date,
    orderId: order.id,
    showId: order.showId,
    marketplace: order.marketplace,
    itemId: line.itemId,
    revenue: sign * revenue[i],
    cogs: line.itemId !== null && base.itemIds.includes(line.itemId) ? -sign * line.costBasis : 0,
    fees: sign * fees[i],
    direct: sign * (direct[i] + fees[i]),
    gross: 0,
    units:
      line.itemId !== null && base.itemIds.includes(line.itemId) && order.type === 'Sale'
        ? -sign
        : 0,
  }));
}
/** Each order contributes its original result on its sale date; later events post on their own dates. */
export function orderPostings(w: Workspace, from = 0, to = Infinity): Posting[] {
  const result: Posting[] = [];
  for (const o of w.orders) {
    if (Date.parse(o.date) < from || Date.parse(o.date) > to) continue;
    const totals = orderTotals(o);
    const lines = o.lines.length ? o.lines : [{ itemId: null, price: 0, costBasis: 0 }];
    const weights = lines.map((l) => l.price);
    const revenue = allocate(totals.revenue, weights),
      direct = allocate(totals.direct, weights),
      fees = allocate(totals.fees, weights);
    lines.forEach((l, i) =>
      result.push({
        id: o.id,
        date: o.date,
        orderId: o.id,
        showId: o.showId,
        marketplace: o.marketplace,
        itemId: l.itemId,
        revenue: revenue[i],
        cogs: o.status === 'Completed' ? l.costBasis : 0,
        fees: fees[i],
        direct: direct[i],
        gross: o.status === 'Cancelled' ? 0 : l.price,
        units: o.type === 'Sale' && o.status === 'Completed' && l.itemId ? 1 : 0,
      }),
    );
  }
  for (const event of w.financialEvents)
    if (Date.parse(event.date) >= from && Date.parse(event.date) <= to)
      result.push(...eventPostings(w, event));
  return result;
}
export function currentOrderTotals(w: Workspace, order: Order) {
  const postings = orderPostings(w).filter((p) => p.orderId === order.id);
  const sum = (key: 'revenue' | 'cogs' | 'fees' | 'direct' | 'gross') =>
    postings.reduce((n, p) => n + p[key], 0);
  return {
    gross: sum('gross'),
    revenue: sum('revenue'),
    cogs: sum('cogs'),
    fees: sum('fees'),
    direct: sum('direct'),
    profit: sum('revenue') - sum('cogs') - sum('direct'),
    netProceeds: sum('revenue') - sum('direct'),
  };
}
export function currentLineProfits(w: Workspace, order: Order) {
  return order.lines.map((l) => {
    const p = orderPostings(w).filter((p) => p.orderId === order.id && p.itemId === l.itemId);
    return {
      itemId: l.itemId,
      profit: p.reduce((n, p) => n + p.revenue - p.cogs - p.direct, 0),
      revenue: p.reduce((n, p) => n + p.revenue, 0),
      cogs: p.reduce((n, p) => n + p.cogs, 0),
    };
  });
}
export function paidForOrder(w: Workspace, orderId: string) {
  return w.payouts.reduce(
    (n, p) =>
      n +
      (p.reversalOf ? -1 : 1) *
        p.allocations.filter((a) => a.orderId === orderId).reduce((t, a) => t + a.amount, 0),
    0,
  );
}
export function payoutOutstanding(w: Workspace, order: Order) {
  const tracked = w.payouts.some((p) => p.allocations.some((a) => a.orderId === order.id));
  if (!tracked && order.payout === 'Paid') return 0;
  return Math.max(0, currentOrderTotals(w, order).netProceeds - paidForOrder(w, order.id));
}
export function payoutStatus(w: Workspace, order: Order) {
  return payoutOutstanding(w, order) === 0 ? 'Paid' : 'Pending';
}
export function payoutReceived(w: Workspace, from = 0, to = Infinity) {
  return w.payouts
    .filter((p) => Date.parse(p.date) >= from && Date.parse(p.date) <= to)
    .reduce((n, p) => n + (p.reversalOf ? -p.amount : p.amount), 0);
}
/** Export allocations, operating costs, and cash receipts separately so column sums stay meaningful. */
export function ledgerExportRows(
  w: Workspace,
  from = 0,
  to = Infinity,
): Record<string, string | number>[] {
  const rows: Record<string, string | number>[] = orderPostings(w, from, to).map((p) => ({
    date: p.date,
    record_type: w.financialEvents.find((e) => e.id === p.id)?.kind || 'Original order',
    record_id: p.id,
    order_id: p.orderId,
    marketplace: p.marketplace,
    sku: w.items.find((i) => i.id === p.itemId)?.sku || '',
    revenue: p.revenue / 100,
    cogs: p.cogs / 100,
    direct_costs: p.direct / 100,
    operating_expense: 0,
    operating_profit: (p.revenue - p.cogs - p.direct) / 100,
    cash_receipt: 0,
  }));
  for (const e of w.expenses.filter((e) => Date.parse(e.date) >= from && Date.parse(e.date) <= to))
    rows.push({
      date: e.date,
      record_type: 'Operating expense',
      record_id: e.id,
      order_id: '',
      marketplace: '',
      sku: '',
      revenue: 0,
      cogs: 0,
      direct_costs: 0,
      operating_expense: e.amount / 100,
      operating_profit: -e.amount / 100,
      cash_receipt: 0,
    });
  for (const p of w.payouts.filter((p) => Date.parse(p.date) >= from && Date.parse(p.date) <= to))
    rows.push({
      date: p.date,
      record_type: p.reversalOf ? 'Payout reversal' : 'Payout receipt',
      record_id: p.id,
      order_id: p.allocations.map((a) => a.orderId).join('|'),
      marketplace: p.marketplace,
      sku: '',
      revenue: 0,
      cogs: 0,
      direct_costs: 0,
      operating_expense: 0,
      operating_profit: 0,
      cash_receipt: (p.reversalOf ? -p.amount : p.amount) / 100,
    });
  return rows.sort((a, b) => Date.parse(String(a.date)) - Date.parse(String(b.date)));
}
