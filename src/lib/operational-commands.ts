import type { Command, Workspace } from './model';
import { currentOrderTotals, itemIsSold, paidForOrder, returnedItemIds } from './ledger';
import { allocate } from './money';
function atLeastSale(date: string, sale: string) {
  if (Date.parse(date) < Date.parse(sale))
    throw new Error('The event cannot occur before its sale.');
  if (Date.parse(date) > Date.now() + 300000)
    throw new Error('Record actual events with a date that is not in the future.');
}
function immutable<T extends { id: string }>(rows: T[], entry: T) {
  const previous = rows.find((r) => r.id === entry.id);
  if (!previous) return false;
  if (JSON.stringify(previous) !== JSON.stringify(entry))
    throw new Error(
      'Posted financial records are immutable. Reverse the original and record a correction.',
    );
  return true;
}
export function applyOperational(
  w: Workspace,
  c: Extract<Command, { type: 'financialEvent' | 'payout' | 'shipment' }>,
) {
  if (c.type === 'financialEvent') {
    const e = c.value;
    if (immutable(w.financialEvents, e)) return;
    const order = w.orders.find((o) => o.id === e.orderId);
    if (!order) throw new Error('Order was not found.');
    atLeastSale(e.date, order.date);
    if (
      e.externalId &&
      w.financialEvents.some((r) => r.orderId === e.orderId && r.externalId === e.externalId)
    )
      throw new Error('This adjustment has already been recorded.');
    if (new Set(e.itemIds).size !== e.itemIds.length)
      throw new Error('A physical return may include each item once.');
    if (e.kind === 'Reversal') {
      const original = w.financialEvents.find(
        (r) => r.id === e.reversesId && r.orderId === e.orderId,
      );
      if (
        !original ||
        original.kind === 'Reversal' ||
        w.financialEvents.some((r) => r.reversesId === original.id)
      )
        throw new Error('Select an unreversed original event from this order.');
      if (Date.parse(e.date) < Date.parse(original.date))
        throw new Error('A reversal cannot predate its original event.');
      if (e.amount !== 0 || e.itemIds.length)
        throw new Error(
          'Reversals calculate their amounts and inventory effects from the original record.',
        );
      if (original.itemIds.some((id) => itemIsSold(w, id, order.id)))
        throw new Error(
          'A returned piece has been resold. Its physical return cannot be reversed.',
        );
    } else {
      if (e.reversesId) throw new Error('Only reversal events may reference an original event.');
      if (e.kind === 'Return' ? e.amount !== 0 || !e.itemIds.length : e.amount === 0)
        throw new Error(
          'Enter a nonzero adjustment, or select pieces for a zero-dollar physical return.',
        );
      if (e.kind === 'Refund' && (e.amount < 0 || order.status === 'Cancelled'))
        throw new Error('Refunds must be positive and relate to a recognized sale.');
      if (!['Refund', 'Return'].includes(e.kind) && e.itemIds.length)
        throw new Error('Only refunds and returns may restore physical inventory.');
      const returned = returnedItemIds(w, order.id);
      for (const id of e.itemIds)
        if (
          order.status !== 'Completed' ||
          !order.lines.some((l) => l.itemId === id) ||
          returned.has(id) ||
          itemIsSold(w, id, order.id)
        )
          throw new Error('This piece is not available to return from this order.');
    }
    w.financialEvents.push(e);
    const totals = currentOrderTotals(w, order);
    if (totals.fees < 0) throw new Error('Fee credits exceed all fees recorded on this order.');
    const active = w.financialEvents.filter(
      (r) =>
        r.orderId === order.id &&
        !r.reversesId &&
        !w.financialEvents.some((v) => v.reversesId === r.id),
    );
    const refunds =
      order.refund + active.filter((r) => r.kind === 'Refund').reduce((n, r) => n + r.amount, 0);
    const paid =
      order.lines.reduce((n, l) => n + l.price, 0) -
      order.discount +
      order.shippingCollected +
      order.tips +
      active.filter((r) => r.kind === 'Revenue adjustment').reduce((n, r) => n + r.amount, 0);
    if (refunds > Math.max(0, paid))
      throw new Error(
        'Cumulative refunds exceed customer revenue. Reverse or correct the relevant event.',
      );
    const original = e.reversesId ? w.financialEvents.find((r) => r.id === e.reversesId)! : e;
    for (const id of original.itemIds) {
      const item = w.items.find((i) => i.id === id)!;
      item.status = itemIsSold(w, id) ? 'Sold' : 'Returned';
      if (item.status !== 'Sold')
        w.listings = w.listings.map((l) =>
          l.itemId === id && ['Sold', 'Needs delisting'].includes(l.status)
            ? { ...l, status: 'Ended' }
            : l,
        );
    }
  } else if (c.type === 'payout') {
    const p = c.value;
    if (immutable(w.payouts, p)) return;
    if (new Set(p.allocations.map((a) => a.orderId)).size !== p.allocations.length)
      throw new Error('Combine each order allocation into one amount.');
    if (p.allocations.reduce((n, a) => n + a.amount, 0) !== p.amount)
      throw new Error('Payout allocations must add up to the exact cash receipt.');
    if (p.reversalOf) {
      const original = w.payouts.find((r) => r.id === p.reversalOf && !r.reversalOf);
      if (!original || w.payouts.some((r) => r.reversalOf === original.id))
        throw new Error('This payout cannot be reversed again.');
      if (
        p.marketplace !== original.marketplace ||
        p.amount !== original.amount ||
        JSON.stringify(p.allocations) !== JSON.stringify(original.allocations)
      )
        throw new Error('A payout reversal must exactly reverse the original allocations.');
      atLeastSale(p.date, original.date);
    } else {
      if (
        w.payouts.some(
          (r) => !r.reversalOf && r.marketplace === p.marketplace && r.reference === p.reference,
        )
      )
        throw new Error('This payout reference already exists.');
      for (const a of p.allocations) {
        const order = w.orders.find((o) => o.id === a.orderId);
        if (!order || order.marketplace !== p.marketplace)
          throw new Error('A payout may only include orders from its marketplace.');
        atLeastSale(p.date, order.date);
        if (
          a.amount >
          Math.max(0, currentOrderTotals(w, order).netProceeds - paidForOrder(w, order.id))
        )
          throw new Error('The cash allocation exceeds this order’s remaining net proceeds.');
      }
    }
    w.payouts.push(p);
  } else {
    const s = c.value;
    const old = w.shipments.find((r) => r.id === s.id);
    if (new Set(s.orderIds).size !== s.orderIds.length)
      throw new Error('Each order belongs in a package once.');
    if (
      old?.allocatedShipping &&
      (s.labelCost !== old.labelCost ||
        JSON.stringify(s.orderIds) !== JSON.stringify(old.orderIds) ||
        !s.allocatedShipping)
    )
      throw new Error(
        'Allocated shipping costs are posted. Correct the financial ledger instead of changing the original label allocation.',
      );
    if (old && JSON.stringify(s.orderIds) !== JSON.stringify(old.orderIds))
      throw new Error(
        'A package’s order membership is fixed after creation. Create the correct package before posting it.',
      );
    const orders = s.orderIds.map((id) => w.orders.find((o) => o.id === id));
    for (const order of orders) {
      if (!order || order.marketplace !== s.marketplace || order.status !== 'Completed')
        throw new Error('Group recognized orders from one marketplace into a shipment.');
      if (
        !old &&
        (!order.lines.length ||
          order.lines.every((l) => returnedItemIds(w, order.id).has(l.itemId)))
      )
        throw new Error('This order has no physical pieces remaining to ship.');
      if (w.shipments.some((p) => p.id !== s.id && p.orderIds.includes(order.id)))
        throw new Error('This order already belongs to another package.');
      if (Date.parse(s.date) < Date.parse(order.date))
        throw new Error('A package cannot predate its orders.');
    }
    if (s.allocatedShipping && !old?.allocatedShipping) {
      const shares = allocate(
        s.labelCost,
        orders.map((o) => o!.lines.reduce((n, l) => n + l.price, 0)),
      );
      orders.forEach((order, i) => {
        const event = w.financialEvents.find(
          (e) => e.orderId === order!.id && e.externalId === `shipment:${s.id}:${order!.id}`,
        );
        if (
          order!.shipping !== 0 ||
          w.financialEvents.some(
            (e) =>
              e.orderId === order!.id &&
              e.category === 'Shipping' &&
              e.kind === 'Direct cost adjustment' &&
              e.id !== event?.id,
          )
        )
          throw new Error(
            'Shipping is already recorded on an order. Link the package without adding the label cost again.',
          );
        if (
          shares[i] > 0 &&
          (!event ||
            event.amount !== shares[i] ||
            event.category !== 'Shipping' ||
            event.kind !== 'Direct cost adjustment')
        )
          throw new Error(
            'Post the exact shipping allocation before marking the package cost allocated.',
          );
      });
    }
    w.shipments = old ? w.shipments.map((r) => (r.id === s.id ? s : r)) : [...w.shipments, s];
    w.orders = w.orders.map((o) =>
      s.orderIds.includes(o.id)
        ? { ...o, fulfillment: s.status === 'Preparing' ? 'Unfulfilled' : s.status }
        : o,
    );
  }
}
