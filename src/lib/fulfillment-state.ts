import type { Order } from './model';
export type FulfillmentState =
  'Unfulfilled' | 'Shipped' | 'Delivered' | 'Handed over' | 'Fulfilled in person';
export function lineFulfillment(
  order: Order,
  itemId: string,
): { status: FulfillmentState; date: string | null } {
  if (order.itemFulfillments?.length) {
    const entry = order.itemFulfillments.find((e) => e.itemId === itemId);
    return { status: entry?.status ?? 'Unfulfilled', date: entry?.date ?? null };
  }
  return {
    status:
      order.fulfillment === 'Unfulfilled'
        ? 'Unfulfilled'
        : order.marketplace === 'In person'
          ? 'Fulfilled in person'
          : order.fulfillment,
    date: null,
  };
}
export function fulfillmentRollup(order: Order): Order['fulfillment'] {
  if (!order.itemFulfillments?.length) return order.fulfillment;
  const statuses = order.lines.map(
    (l) => order.itemFulfillments!.find((e) => e.itemId === l.itemId)?.status ?? 'Unfulfilled',
  );
  return statuses.some((s) => s === 'Unfulfilled')
    ? 'Unfulfilled'
    : statuses.every((s) => s === 'Delivered')
      ? 'Delivered'
      : 'Shipped';
}
export function setItemFulfillment(
  order: Order,
  itemId: string,
  status: 'Unfulfilled' | 'Shipped' | 'Delivered' | 'Handed over',
  date: string,
): Order {
  const entries = order.lines.map((l) => {
    const current = lineFulfillment(order, l.itemId);
    return {
      itemId: l.itemId,
      status:
        l.itemId === itemId
          ? status
          : current.status === 'Fulfilled in person'
            ? ('Handed over' as const)
            : current.status,
      date: l.itemId === itemId ? (status === 'Unfulfilled' ? null : date) : current.date,
    };
  });
  const next = {
    ...order,
    itemFulfillments: entries.every((e) => e.status === 'Unfulfilled') ? [] : entries,
  };
  return {
    ...next,
    fulfillment: entries.every((e) => e.status === 'Unfulfilled')
      ? 'Unfulfilled'
      : fulfillmentRollup(next),
  };
}
