import type { Order } from './model';
export const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export function parseMoney(value: string): number {
  if (!/^-?\d+(\.\d{1,2})?$/.test(value.trim()))
    throw new Error('Enter a dollar amount with at most two decimal places.');
  const [whole, fraction = ''] = value.trim().replace('-', '').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > 100_000_000) throw new Error('Amount is too large.');
  return value.trim().startsWith('-') ? -cents : cents;
}
export function orderTotals(order: Order) {
  const active = order.status !== 'Cancelled';
  const gross = active ? order.lines.reduce((n, l) => n + l.price, 0) : 0;
  const revenue =
    (active ? gross - order.discount + order.shippingCollected + order.tips - order.refund : 0) +
    order.adjustment;
  const cogs = order.status === 'Completed' ? order.lines.reduce((n, l) => n + l.costBasis, 0) : 0;
  const fees = order.fees + order.processing - order.feeCredit;
  const direct = fees + order.shipping + order.packaging + order.other;
  return {
    gross,
    revenue,
    cogs,
    fees,
    direct,
    profit: revenue - cogs - direct,
    netProceeds: revenue - direct,
  };
}
/** Largest remainder allocation: the output always adds up to the exact integer-cent total. */
export function allocate(total: number, weights: number[]) {
  if (!Number.isSafeInteger(total) || weights.some((w) => w < 0 || !Number.isFinite(w)))
    throw new Error('Invalid allocation');
  if (!weights.length) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => Math.abs(total) * (sum ? w / sum : 1 / weights.length));
  const values = raw.map(Math.floor);
  const ranked = raw
    .map((v, i) => ({ i, fraction: v - values[i] }))
    .sort((a, b) => b.fraction - a.fraction || a.i - b.i);
  for (let r = Math.abs(total) - values.reduce((a, b) => a + b, 0), i = 0; i < r; i++)
    values[ranked[i].i]++;
  return values.map((v) => (total < 0 ? -v : v));
}
export function lineProfits(order: Order) {
  const t = orderTotals(order);
  const weights = order.lines.map((l) => l.price);
  const net = allocate(t.netProceeds, weights);
  return order.lines.map((l, i) => ({
    itemId: l.itemId,
    profit: net[i] - (order.status === 'Completed' ? l.costBasis : 0),
    revenue: allocate(t.revenue, weights)[i],
    cogs: order.status === 'Completed' ? l.costBasis : 0,
  }));
}
