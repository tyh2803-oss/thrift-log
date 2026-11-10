import { orderPostings, returnedItemIds } from './ledger';
import { allocate } from './money';
import { lineFulfillment, type FulfillmentState } from './fulfillment-state';
import type { Item, Listing, Order, Workspace } from './model';
export const pipelineStages = ['unlisted', 'for-sale', 'sold', 'shipped'] as const;
export type PipelineStage = (typeof pipelineStages)[number];
export type PipelineMetric = 'cost' | 'sale' | 'profit';
export const stageNames: Record<PipelineStage, string> = {
  unlisted: 'Unlisted',
  'for-sale': 'For Sale',
  sold: 'Sold',
  shipped: 'Shipped',
};
export const readPipelineStage = (value: string | null): PipelineStage | null =>
  pipelineStages.includes(value as PipelineStage) ? (value as PipelineStage) : null;
export type PipelineEntry = {
  item: Item;
  stage: PipelineStage;
  order: Order | null;
  listings: Listing[];
  cost: number | null;
  saleValue: number | null;
  profit: number | null;
  provisional: boolean;
  fulfillment: FulfillmentState | null;
  fulfilledAt: string | null;
  reserved: boolean;
};
export type PipelineValue = {
  value: number | null;
  missing: number;
  provisional: number;
  label: string;
  count: number;
};
export type PipelineGroup = {
  stage: PipelineStage;
  entries: PipelineEntry[];
  count: number;
  orders: number;
  activeListings: number;
  handedOver: number;
  reserved: number;
  markets: { name: string; count: number }[];
};
export type PipelineSnapshot = {
  groups: Record<PipelineStage, PipelineGroup>;
  entries: PipelineEntry[];
  restocking: Item[];
  review: Item[];
  archived: number;
};
/** One loaded workspace, one posting pass. No writes, network requests or period filtering. */
export function inventoryPipeline(w: Workspace): PipelineSnapshot {
  const listingsByItem = new Map<string, Listing[]>();
  for (const l of w.listings)
    if (l.status === 'Active') {
      const rows = listingsByItem.get(l.itemId) || [];
      rows.push(l);
      listingsByItem.set(l.itemId, rows);
    }
  const returned = new Map(w.orders.map((o) => [o.id, returnedItemIds(w, o.id)]));
  const activeOrders = new Map<string, Order[]>(),
    latestOrders = new Map<string, Order>();
  for (const order of w.orders)
    for (const line of order.lines) {
      const latest = latestOrders.get(line.itemId);
      if (
        !latest ||
        Date.parse(latest.date) < Date.parse(order.date) ||
        (latest.date === order.date && latest.id < order.id)
      )
        latestOrders.set(line.itemId, order);
      if (order.status === 'Completed' && !returned.get(order.id)!.has(line.itemId)) {
        const rows = activeOrders.get(line.itemId) || [];
        rows.push(order);
        activeOrders.set(line.itemId, rows);
      }
    }
  const reserved = new Set(
    w.shows.filter((s) => s.status !== 'Ended').flatMap((s) => s.lineup.map((l) => l.itemId)),
  );
  const financial = new Map<string, { revenue: number; cogs: number; direct: number }>();
  for (const p of orderPostings(w)) {
    if (!p.itemId) continue;
    const key = `${p.orderId}:${p.itemId}`;
    const sums = financial.get(key) || { revenue: 0, cogs: 0, direct: 0 };
    sums.revenue += p.revenue;
    sums.cogs += p.cogs;
    sums.direct += p.direct;
    financial.set(key, sums);
  }
  const originalNonMerch = new Map<string, number>();
  const ambiguousMerch = new Set<string>();
  for (const o of w.orders) {
    const shares = allocate(
      o.shippingCollected + o.tips,
      o.lines.map((l) => l.price),
    );
    o.lines.forEach((l, i) => originalNonMerch.set(`${o.id}:${l.itemId}`, shares[i]));
    // The ledger does not categorize refunds/adjustments as merchandise vs shipping/tips.
    if (
      (o.shippingCollected > 0 || o.tips > 0) &&
      (o.refund > 0 ||
        o.adjustment !== 0 ||
        w.financialEvents.some(
          (e) =>
            e.orderId === o.id && ['Refund', 'Revenue adjustment', 'Reversal'].includes(e.kind),
        ))
    )
      ambiguousMerch.add(o.id);
  }
  const confirmed = new Set(w.orders.filter((o) => o.amountsConfirmed).map((o) => o.id)),
    freeCosts = new Set<string>();
  // Historical assistant receipts prove explicit zeros without changing legacy records.
  for (const receipt of w.imports) {
    if (receipt.mapping.format !== 'assistant-v1') continue;
    try {
      const audit = JSON.parse(receipt.rawCsv);
      const facts = audit.corrected;
      for (const m of audit.matches || []) {
        if (
          m.newItem?.cost === 0 &&
          (m.newItem.confirmedDistinct ||
            (audit.authorization?.kind === 'final-approval' &&
              audit.authorization.newItemIds?.includes(m.newItem.id)))
        )
          freeCosts.add(m.newItem.id);
        if (m.itemId && (m.confirmZeroCost || m.costOverride === 0)) freeCosts.add(m.itemId);
      }
      const o = w.orders.find((o) => o.id === receipt.id);
      if (
        o &&
        facts?.kind === 'sale' &&
        o.marketplace === facts.marketplace &&
        [
          'fees',
          'processing',
          'shipping',
          'shippingCollected',
          'discount',
          'refund',
          'other',
        ].every((k) => facts[k] !== null && facts[k] === o[k as keyof Order]) &&
        o.packaging === 0 &&
        facts.lines?.length === o.lines.length &&
        facts.lines.every((l: { price: number }, i: number) => l.price === o.lines[i].price)
      )
        confirmed.add(o.id);
    } catch {
      /* Non-assistant or older provenance is not proof of known zero amounts. */
    }
  }
  const entries: PipelineEntry[] = [],
    restocking: Item[] = [],
    review: Item[] = [];
  let archived = 0;
  for (const item of w.items) {
    if (item.status === 'Archived') {
      archived++;
      continue;
    }
    const live = activeOrders.get(item.id) || [],
      active = listingsByItem.get(item.id) || [];
    if (live.length > 1) {
      review.push(item);
      continue;
    }
    const order = live[0];
    if (order) {
      const line = order.lines.find((l) => l.itemId === item.id)!,
        f = financial.get(`${order.id}:${item.id}`)!;
      const fulfillment = lineFulfillment(order, item.id);
      const knownCost = line.costBasis > 0 || confirmed.has(order.id);
      const cost = knownCost ? line.costBasis : null;
      entries.push({
        item,
        stage: fulfillment.status === 'Unfulfilled' ? 'sold' : 'shipped',
        order,
        listings: active,
        cost,
        saleValue: ambiguousMerch.has(order.id)
          ? null
          : f.revenue - (originalNonMerch.get(`${order.id}:${item.id}`) || 0),
        profit: knownCost ? f.revenue - f.cogs - f.direct : null,
        provisional: !confirmed.has(order.id),
        fulfillment: fulfillment.status,
        fulfilledAt: fulfillment.date,
        reserved: false,
      });
      continue;
    }
    if (active.length) {
      const prices = active.map((l) => l.price).filter((p) => p > 0);
      const price = prices.length ? Math.min(...prices) : item.asking > 0 ? item.asking : null;
      const cost = item.cost > 0 || freeCosts.has(item.id) ? item.cost : null;
      entries.push({
        item,
        stage: 'for-sale',
        order: null,
        listings: active,
        cost,
        saleValue: price,
        profit:
          price !== null && cost !== null && w.settings.estimatedSellingExpenses !== null
            ? price - cost - w.settings.estimatedSellingExpenses
            : null,
        provisional: false,
        fulfillment: null,
        fulfilledAt: null,
        reserved: reserved.has(item.id),
      });
      continue;
    }
    if (item.status === 'Returned' && latestOrders.get(item.id)?.status !== 'Cancelled') {
      restocking.push(item);
      continue;
    }
    if (item.status === 'Sold') {
      review.push(item);
      continue;
    }
    const cost = item.cost > 0 || freeCosts.has(item.id) ? item.cost : null,
      price = item.asking > 0 ? item.asking : null;
    entries.push({
      item,
      stage: 'unlisted',
      order: null,
      listings: [],
      cost,
      saleValue: price,
      profit:
        price !== null && cost !== null && w.settings.estimatedSellingExpenses !== null
          ? price - cost - w.settings.estimatedSellingExpenses
          : null,
      provisional: false,
      fulfillment: null,
      fulfilledAt: null,
      reserved: reserved.has(item.id),
    });
  }
  const groups = Object.fromEntries(
    pipelineStages.map((stage) => {
      const rows = entries.filter((e) => e.stage === stage),
        markets = new Map<string, number>();
      for (const e of rows) {
        if (e.order) markets.set(e.order.marketplace, (markets.get(e.order.marketplace) || 0) + 1);
        else
          for (const l of e.listings)
            markets.set(l.marketplace, (markets.get(l.marketplace) || 0) + 1);
      }
      return [
        stage,
        {
          stage,
          entries: rows,
          count: rows.length,
          orders: new Set(rows.flatMap((e) => (e.order ? [e.order.id] : []))).size,
          activeListings: rows.reduce((n, e) => n + e.listings.length, 0),
          handedOver: rows.filter((e) =>
            ['Handed over', 'Fulfilled in person'].includes(e.fulfillment || ''),
          ).length,
          reserved: rows.filter((e) => e.reserved).length,
          markets: [...markets].map(([name, count]) => ({ name, count })),
        },
      ];
    }),
  ) as Record<PipelineStage, PipelineGroup>;
  return { groups, entries, restocking, review, archived };
}
export function pipelineValue(group: PipelineGroup, metric: PipelineMetric): PipelineValue {
  const field = metric === 'cost' ? 'cost' : metric === 'sale' ? 'saleValue' : 'profit';
  const known = group.entries.filter((e) => e[field] !== null),
    missing = group.count - known.length;
  const provisional = metric === 'profit' ? group.entries.filter((e) => e.provisional).length : 0;
  const unsold = group.stage === 'unlisted' || group.stage === 'for-sale';
  const label =
    metric === 'cost'
      ? unsold
        ? 'Acquisition cost'
        : 'Sale cost basis'
      : metric === 'sale'
        ? group.stage === 'unlisted'
          ? 'Expected sale value'
          : group.stage === 'for-sale'
            ? 'Asking value'
            : 'Net merchandise sales'
        : unsold
          ? 'Potential Profit'
          : provisional || missing
            ? 'Provisional Profit'
            : 'Realized Profit';
  return {
    value: known.length || group.count === 0 ? known.reduce((n, e) => n + e[field]!, 0) : null,
    missing,
    provisional,
    label,
    count: group.count,
  };
}
