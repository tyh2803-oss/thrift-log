import { blockingWarnings } from './warnings';
import { applyCommand } from '../commands';
import { lineFulfillment, setItemFulfillment } from '../fulfillment-state';
import { returnedItemIds } from '../ledger';
import {
  financialEventSchema,
  shipmentSchema,
  type Command,
  type Order,
  type Workspace,
} from '../model';
import type { DraftRow } from './drafts';

export const isLifecycle = (kind: DraftRow['facts']['kind']) =>
  ['fulfillment', 'cancellation', 'refund', 'return'].includes(kind);
export function orderCandidates(w: Workspace, row: DraftRow): Order[] {
  const r = row.facts;
  const orders = w.orders.filter((o) => !r.marketplace || o.marketplace === r.marketplace);
  if (row.orderId) return orders.filter((o) => o.id === row.orderId);
  if (r.externalOrderId) {
    const exact = orders.filter((o) => o.externalId === r.externalOrderId);
    if (exact.length) return exact;
  }
  const tracking = r.event?.tracking;
  if (tracking) {
    const ids = w.shipments
      .filter((s) => s.tracking === tracking && (!r.marketplace || s.marketplace === r.marketplace))
      .flatMap((s) => s.orderIds);
    if (ids.length) return orders.filter((o) => ids.includes(o.id));
  }
  const ids = row.matches.map((m) => m.itemId).filter(Boolean);
  return orders.filter(
    (o) =>
      o.status === 'Completed' &&
      o.lines.some((l) => ids.includes(l.itemId) && !returnedItemIds(w, o.id).has(l.itemId)),
  );
}
export function fulfillmentCommands(
  w: Workspace,
  request: {
    id: string;
    orderId: string;
    itemIds: string[];
    status: 'Shipped' | 'Delivered' | 'Handed over';
    date: string;
    confirmPackage?: boolean;
    tracking?: string | null;
    carrier?: string | null;
    labelCost?: number | null;
  },
): Command[] {
  const order = w.orders.find((o) => o.id === request.orderId);
  if (!order || order.status !== 'Completed') throw new Error('Select an existing completed sale.');
  if (
    !request.itemIds.length ||
    request.itemIds.some(
      (id) => !order.lines.some((l) => l.itemId === id) || returnedItemIds(w, order.id).has(id),
    )
  )
    throw new Error('Select the sold physical items still belonging to this order.');
  if (
    Date.parse(request.date) < Date.parse(order.date) ||
    !Number.isFinite(Date.parse(request.date)) ||
    Date.parse(request.date) > Date.now() + 300000
  )
    throw new Error('Use an actual fulfillment date on or after the sale.');
  const parcel = w.shipments.find((s) => s.orderIds.includes(order.id));
  const inPerson = order.marketplace === 'In person';
  const status = inPerson ? 'Handed over' : request.status;
  if (!inPerson && status === 'Handed over')
    throw new Error('Choose a shipped or delivered state for an online order.');
  if (
    request.itemIds.every((id) => {
      const s = lineFulfillment(order, id).status;
      return (
        s === 'Delivered' ||
        s === status ||
        (status === 'Handed over' && s === 'Fulfilled in person')
      );
    })
  )
    throw new Error('These items are already fulfilled in this state.');
  let commands: Command[];
  if (parcel) {
    if (
      Date.parse(request.date) <
      Math.max(
        Date.parse(parcel.date),
        ...parcel.orderIds.map((id) => Date.parse(w.orders.find((o) => o.id === id)!.date)),
      )
    )
      throw new Error('Fulfillment cannot predate its linked package or grouped sales.');
    if (inPerson)
      throw new Error('Reconcile the existing shipment before recording an in-person handover.');
    if (parcel.orderIds.length > 1 && !request.confirmPackage)
      throw new Error(
        'This package contains other orders. Confirm the whole package before updating it.',
      );
    if (
      request.itemIds.length !==
      order.lines.filter((l) => !returnedItemIds(w, order.id).has(l.itemId)).length
    )
      throw new Error(
        'This order is in a whole-order package. Update the package instead of a partial item.',
      );
    commands = [
      {
        type: 'shipment',
        value: {
          ...parcel,
          status: status === 'Delivered' ? 'Delivered' : 'Shipped',
          tracking: request.tracking || parcel.tracking,
          carrier: request.carrier || parcel.carrier,
        },
      },
    ];
  } else if (
    !inPerson &&
    request.labelCost != null &&
    request.itemIds.length === order.lines.length &&
    !order.itemFulfillments?.length
  ) {
    commands = [
      {
        type: 'shipment',
        value: shipmentSchema.parse({
          id: request.id,
          marketplace: order.marketplace,
          orderIds: [order.id],
          date: request.date,
          status,
          tracking: request.tracking || '',
          carrier: request.carrier || '',
          labelCost: request.labelCost,
          allocatedShipping: false,
          notes: 'Approved fulfillment. Label cost is observed, not added to order expenses.',
        }),
      },
    ];
  } else {
    let next = order;
    for (const id of request.itemIds) {
      if (
        lineFulfillment(order, id).status === 'Delivered' ||
        lineFulfillment(order, id).status === status
      )
        continue;
      next = setItemFulfillment(next, id, status, request.date);
    }
    commands = [{ type: 'order', value: next }];
  }
  commands.reduce(applyCommand, w);
  return commands;
}
export function lifecyclePreview(w: Workspace, row: DraftRow, date: string | null) {
  const issues: string[] = [],
    commands: Command[] = [];
  const r = row.facts,
    candidates = orderCandidates(w, row);
  const event = r.event;
  const expected: Record<string, string[]> = {
    fulfillment: ['shipped', 'delivered'],
    cancellation: ['cancelled'],
    refund: ['refunded'],
    return: ['returned'],
  };
  if (event && !expected[r.kind]?.includes(event.type))
    issues.push(
      'Event classification conflicts with the proposed operation. Confirm what happened.',
    );
  if (!r.marketplace) issues.push('Choose the marketplace.');
  if (!event || (event.confidence !== 'clear' && !event.confirmedByUser))
    issues.push('Confirm what happened before recording this event.');
  if (!date) issues.push('Enter the actual event date.');
  if (
    (r.kind === 'refund' || (r.kind === 'return' && row.applyRefund)) &&
    blockingWarnings(r).length &&
    !row.acknowledgedWarnings
  )
    issues.push('Review financial extraction warnings before posting the adjustment.');
  if (r.kind === 'fulfillment' && !['shipped', 'delivered'].includes(r.status))
    issues.push('Confirm shipped or delivered status.');
  if (r.kind === 'refund' && r.currency !== 'USD') issues.push('Confirm the refund amount is USD.');
  const order = candidates.length === 1 ? candidates[0] : undefined;
  if (!order) issues.push('Choose the existing order; this event will not create a sale.');

  if (issues.length || !order || !date) return { issues, commands, order };
  try {
    const remaining = order.lines
      .filter((l) => !returnedItemIds(w, order.id).has(l.itemId))
      .map((l) => l.itemId);
    const selected =
      row.targetItemIds ??
      (event?.scope === 'order' && !!r.externalOrderId && r.externalOrderId === order.externalId
        ? remaining
        : event?.scope === 'items'
          ? row.matches
              .map((m) => m.itemId)
              .filter((id): id is string => !!id && remaining.includes(id))
          : remaining.length === 1
            ? remaining
            : []);
    if (r.kind === 'fulfillment') {
      commands.push(
        ...fulfillmentCommands(w, {
          id: row.id,
          orderId: order.id,
          itemIds: selected,
          status:
            r.status === 'delivered'
              ? 'Delivered'
              : order.marketplace === 'In person'
                ? 'Handed over'
                : 'Shipped',
          date,
          confirmPackage: row.confirmPackage,
          tracking: event?.tracking,
          carrier: event?.carrier,
          labelCost: r.currency === 'USD' ? event?.labelCost : null,
        }),
      );
    } else if (r.kind === 'cancellation') {
      if (
        order.status !== 'Completed' ||
        w.shipments.some((s) => s.orderIds.includes(order.id)) ||
        order.lines.some((l) => lineFulfillment(order, l.itemId).status !== 'Unfulfilled')
      )
        throw new Error(
          'This order is fulfilled or already canceled. Reconcile it through its existing order/ledger.',
        );
      commands.push({ type: 'order', value: { ...order, status: 'Cancelled' } });
      const restored = commands.reduce(applyCommand, w);
      for (const line of order.lines) {
        const item = restored.items.find((i) => i.id === line.itemId);
        if (item?.status === 'Returned')
          commands.push({ type: 'item', value: { ...item, status: 'Ready to List' } });
      }
    } else {
      const physical = r.kind === 'return';
      if (physical && (!row.confirmPhysicalReturn || !selected.length))
        throw new Error(
          'Confirm receipt of the selected physical items. A refund alone does not restock inventory.',
        );
      if (!physical && (r.refund === null || r.refund <= 0))
        throw new Error('Enter the verified refund amount.');
      const amount = physical ? 0 : r.refund!;
      const duplicate = w.financialEvents.some(
        (e) =>
          e.orderId === order.id &&
          e.kind === (physical ? 'Return' : 'Refund') &&
          (event?.externalEventId
            ? e.externalId === event.externalEventId ||
              (physical && e.externalId === `${event.externalEventId}:physical`)
            : e.date.slice(0, 10) === date.slice(0, 10) &&
              e.amount === amount &&
              (!physical || selected.some((id) => e.itemIds.includes(id)))),
      );
      if (duplicate)
        throw new Error(
          'This adjustment appears to be recorded. Reconcile the original ledger event.',
        );
      if (physical && row.applyRefund) {
        if (r.currency !== 'USD' || r.refund === null || r.refund <= 0)
          throw new Error(
            'Confirm the completed refund amount in USD before including it with this return.',
          );
        if (
          w.financialEvents.some(
            (e) =>
              e.orderId === order.id &&
              e.kind === 'Refund' &&
              (event?.externalEventId
                ? e.externalId === event.externalEventId
                : e.date.slice(0, 10) === date.slice(0, 10) && e.amount === r.refund),
          )
        )
          throw new Error(
            'This refund appears to be recorded. Leave it out and approve only the physical return.',
          );
        const refundId = row.id.slice(0, -1) + (parseInt(row.id.slice(-1), 16) ^ 1).toString(16);
        commands.push({
          type: 'financialEvent',
          value: financialEventSchema.parse({
            id: refundId,
            orderId: order.id,
            date,
            kind: 'Refund',
            amount: r.refund,
            itemIds: [],
            externalId:
              event?.externalEventId || `assistant:refund:${order.id}:${date}:${r.refund}`,
            reason: 'Verified refund explicitly included with approved physical return.',
            reversesId: null,
            category: 'Other',
          }),
        });
      }
      commands.push({
        type: 'financialEvent',
        value: financialEventSchema.parse({
          id: row.id,
          orderId: order.id,
          date,
          kind: physical ? 'Return' : 'Refund',
          amount,
          itemIds: physical ? selected : [],
          externalId: event?.externalEventId
            ? physical
              ? `${event.externalEventId}:physical`
              : event.externalEventId
            : `assistant:${r.kind}:${order.id}:${date}:${amount}`,
          reason: 'Approved screenshot event; original sale preserved.',
          reversesId: null,
          category: 'Other',
        }),
      });
    }
    commands.reduce(applyCommand, w);
  } catch (e) {
    issues.push(e instanceof Error ? e.message : 'Could not validate this event.');
  }
  return { issues, commands: issues.length ? [] : commands, order };
}
