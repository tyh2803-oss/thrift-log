import type { Session, Workspace } from './model';
import { orderPostings, payoutOutstanding, payoutReceived } from './ledger';
export * from './money';
/** Union of timestamp ranges, clipped to the reporting period. Paused time is excluded. */
export function laborMs(sessions: Session[], from = 0, to = Date.now()) {
  const ranges = sessions
    .filter((s) => s.state !== 'Deleted')
    .flatMap((s) =>
      s.segments.map((r) => [
        Math.max(from, Date.parse(r.start)),
        Math.min(to, r.end ? Date.parse(r.end) : Date.now()),
      ]),
    )
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  let total = 0,
    start = 0,
    end = 0;
  for (const [s, e] of ranges) {
    if (s > end) {
      total += end - start;
      start = s;
      end = e;
    } else end = Math.max(end, e);
  }
  return total + end - start;
}
export function metrics(w: Workspace, from = 0, to = Date.now(), showId?: string) {
  const orders = w.orders.filter(
    (o) =>
      Date.parse(o.date) >= from && Date.parse(o.date) <= to && (!showId || o.showId === showId),
  );
  const expenses = w.expenses
    .filter(
      (e) =>
        Date.parse(e.date) >= from && Date.parse(e.date) <= to && (!showId || e.showId === showId),
    )
    .reduce((n, e) => n + e.amount, 0);
  const postings = orderPostings(w, from, to).filter((p) => !showId || p.showId === showId);
  const sum = (key: 'revenue' | 'cogs' | 'fees' | 'direct' | 'gross') =>
    postings.reduce((n, p) => n + p[key], 0);
  const profit = sum('revenue') - sum('cogs') - sum('direct') - expenses;
  const hours =
    laborMs(
      w.sessions.filter((s) => !showId || s.showId === showId),
      from,
      to,
    ) / 3_600_000;
  const sold = postings
    .filter((p) => p.id === p.orderId)
    .reduce((n, p) => n + Math.max(0, p.units), 0);
  const returned = postings.filter((p) => p.id !== p.orderId).reduce((n, p) => n - p.units, 0);
  const unsold = w.items.filter((i) => i.status !== 'Sold' && i.status !== 'Archived');
  return {
    revenue: sum('revenue'),
    profit,
    gross: sum('gross'),
    cogs: sum('cogs'),
    fees: sum('fees'),
    direct: sum('direct'),
    expenses,
    hours,
    hourly: hours > 0 ? profit / hours : null,
    sold,
    returned,
    netSold: sold - returned,
    payoutReceived: payoutReceived(w, from, to),
    margin: sum('revenue') > 0 ? (profit / sum('revenue')) * 100 : 0,
    inventoryCost: unsold.reduce((n, i) => n + i.cost, 0),
    inventoryAsking: unsold.reduce((n, i) => n + i.asking, 0),
    pendingPayout: orders.reduce((n, o) => n + payoutOutstanding(w, o), 0),
  };
}
export const duration = (ms: number) => {
  const minutes = Math.floor(ms / 60000);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
};
