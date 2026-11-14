import 'server-only';
import {
  itemSchema,
  orderSchema,
  showSchema,
  type Command,
  type Workspace,
  type Order,
} from '@/lib/model';
import { applyCommand } from '@/lib/commands';
import { lineFulfillment } from '@/lib/fulfillment-state';
import { itemIsSold, currentOrderTotals } from '@/lib/ledger';
import { confirmedFreeInventory } from '@/lib/assistant/listing-review';
import { stableId, payloadHash } from './crypto';
import { parseMoney } from '@/lib/money';
import type { LedgerTransaction } from './reports';
import type {
  OrderSource,
  StoredRecord,
  RecordKind,
  SourceShow,
  ShowAnalytics,
  Resolution,
} from './schema';
export function dollars(m: { amount: string; currency: string }) {
  if (m.currency !== 'USD')
    throw new Error('Only USD is supported; no currency conversion is performed.');
  return parseMoney(m.amount);
}
export function sourceUnits(source: OrderSource) {
  return [...source.items]
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap((item) =>
      Array.from({ length: item.quantity }, (_, i) => ({
        key: `${item.id}:${i}`,
        item,
        price: dollars(item.unit_price),
      })),
    );
}
export class WhatnotPlan {
  w: Workspace;
  changed = false;
  readonly writes = new Map<string, StoredRecord>();
  private records = new Map<string, StoredRecord>();
  constructor(
    readonly userId: string,
    readonly sellerId: string,
    w: Workspace,
    records: StoredRecord[] = [],
  ) {
    this.w = w;
    this.remember(records);
  }
  remember(rows: StoredRecord[]) {
    for (const row of rows) {
      const key = `${row.kind}:${row.external_id}`;
      if (!this.writes.has(key)) this.records.set(key, row);
    }
  }
  record(kind: RecordKind, id: string) {
    return this.records.get(`${kind}:${id}`);
  }
  put(command: Command) {
    this.w = applyCommand(this.w, command);
    this.changed = true;
  }
  save(
    kind: RecordKind,
    id: string,
    payload: unknown,
    state: StoredRecord['state'],
    issue = '',
    local_id: string | null = null,
    resolution?: Resolution,
  ) {
    const before = this.record(kind, id),
      next: StoredRecord = {
        kind,
        external_id: id,
        payload,
        hash: payloadHash(payload),
        state,
        issue,
        local_id,
        resolution: resolution ?? before?.resolution ?? {},
      };
    this.records.set(`${kind}:${id}`, next);
    if (JSON.stringify(before) !== JSON.stringify(next)) this.writes.set(`${kind}:${id}`, next);
    return next;
  }
  private atomic(action: () => void) {
    const before = this.w,
      changed = this.changed,
      records = new Map(this.records),
      writes = new Map(this.writes);
    try {
      action();
    } catch (e) {
      this.w = before;
      this.changed = changed;
      this.records = records;
      this.writes.clear();
      for (const [key, row] of writes) this.writes.set(key, row);
      throw e;
    }
  }
  private receipt(
    order: Order,
    pending: boolean,
    proof?: { unknown: string[]; zero: string[]; assumed: string[] },
  ) {
    const previous = this.w.imports.find((r) => r.id === order.id && r.mapping.whatnot === 'true');
    if (!previous && !proof) return;
    const raw = previous
      ? JSON.parse(previous.rawCsv)
      : {
          version: 1,
          provider: 'Whatnot Seller API v2',
          sellerId: this.sellerId,
          externalOrderId: order.externalId,
          unknownCostItemIds: proof!.unknown,
          knownZeroItemIds: proof!.zero,
          assumedAcquisitionItemIds: proof!.assumed,
        };
    raw.whatnotFinancialsPending = pending;
    const value = previous
      ? { ...previous, rawCsv: JSON.stringify(raw) }
      : {
          id: order.id,
          filename: `Whatnot API order ${order.externalId}`,
          kind: 'Sales' as const,
          importedAt: new Date().toISOString(),
          mapping: { format: 'whatnot-v1', history: 'true', whatnot: 'true' },
          recordIds: [order.id, ...order.lines.map((l) => l.itemId)],
          rawCsv: JSON.stringify(raw),
        };
    if (previous?.rawCsv !== value.rawCsv) this.put({ type: 'import', value });
  }
  show(source: SourceShow, analytics: ShowAnalytics | null) {
    const old = this.record('show', source.id);
    let local = this.w.shows.find((s) => s.id === old?.local_id);
    try {
      const matches = this.w.shows.filter(
        (s) => s.type === 'Whatnot' && s.externalId === source.id,
      );
      if (matches.length > 1)
        throw new Error(
          'Multiple local shows use this Whatnot ID. Correct the show links in Sales.',
        );
      local = local || matches[0];
      if (source.status === 'cancelled' && local) {
        if (local && local.status !== 'Ended') {
          local = { ...local, status: 'Ended' };
          this.put({ type: 'show', value: local });
        }
        this.save(
          'show',
          source.id,
          { source, analytics },
          'ignored',
          'Cancelled on Whatnot; no show activity is invented.',
          local?.id || null,
        );
        return;
      }
      const date = analytics?.start_time || source.scheduled_start_at;
      if (!date) throw new Error('This show has no scheduled or actual start date yet.');
      if (!local) {
        const same = this.w.shows.filter(
          (s) =>
            s.type === 'Whatnot' &&
            !s.externalId &&
            s.name === source.title &&
            Date.parse(s.date) === Date.parse(date),
        );
        if (same.length > 1)
          throw new Error('More than one local show matches this title and start date.');
        local = same[0];
      }
      const next = showSchema.parse({
        ...local,
        id: local?.id || stableId(this.userId, this.sellerId, 'show', source.id),
        name: source.title,
        date,
        type: 'Whatnot',
        status: ['ended', 'cancelled'].includes(source.status)
          ? 'Ended'
          : ['live', 'stopped'].includes(source.status)
            ? 'Live'
            : 'Planned',
        externalId: source.id,
        notes:
          source.status === 'cancelled' && !local
            ? 'Cancelled on Whatnot. Date is the scheduled start, not verified live activity.'
            : local?.notes || '',
        durationMinutes:
          analytics?.calculation_status === 'GENERATED' &&
          analytics.stream_minutes !== null &&
          analytics.stream_minutes >= 0 &&
          analytics.stream_minutes <= 1440
            ? analytics.stream_minutes
            : local?.durationMinutes || 0,
      });
      if (JSON.stringify(local) !== JSON.stringify(next)) this.put({ type: 'show', value: next });
      this.save(
        'show',
        source.id,
        { source, analytics },
        source.status === 'cancelled' ? 'ignored' : 'applied',
        '',
        next.id,
      );
    } catch (e) {
      this.save('show', source.id, { source, analytics }, 'review', message(e), local?.id || null);
    }
  }
  order(source: OrderSource) {
    const { order: api } = source,
      previous = this.record('order', api.id),
      prior = previous?.payload as
        { source?: OrderSource; unitMap?: Record<string, string>; adopted?: boolean } | undefined;
    let local =
      this.w.orders.find((o) => o.id === previous?.local_id) ||
      this.w.orders.find((o) => o.marketplace === 'Whatnot' && o.externalId === api.id);
    const payload: { source: OrderSource; unitMap: Record<string, string>; adopted: boolean } = {
      source,
      unitMap: structuredClone(prior?.unitMap || {}),
      adopted: prior?.adopted ?? !!local,
    };
    const txs = [...this.records.values()].filter(
      (r) => r.kind === 'transaction' && (r.payload as LedgerTransaction).orderId === api.id,
    );
    let earnings = txs
      .map((r) => r.payload as LedgerTransaction)
      .filter((t) => t.type === 'ORDER_EARNINGS');
    try {
      this.atomic(() => {
        if (!local && ['pending', 'failed'].includes(api.status)) {
          this.save(
            'order',
            api.id,
            payload,
            'ignored',
            `Whatnot status is ${api.status}; no completed sale recorded.`,
          );
          return;
        }
        if (!local && api.status === 'cancelled' && !earnings.length) {
          this.save(
            'order',
            api.id,
            payload,
            'ignored',
            'Cancelled before verified earnings; no sale invented.',
          );
          return;
        }
        if (!api.created_at || Date.parse(api.created_at) > Date.now() + 300000)
          throw new Error('An actual, non-future order date is required.');
        const units = sourceUnits(source);
        if (!units.length || units.length > 30)
          throw new Error(
            'This order needs between 1 and 30 identified physical pieces. Use the manual order editor for larger orders.',
          );
        if (source.items.some((i) => i.order_id !== api.id || i.price_includes_tax === true))
          throw new Error(
            'Order items are inconsistent or tax-inclusive. Verify net merchandise prices before importing.',
          );
        const gross = units.reduce((n, u) => n + u.price, 0),
          subtotal = dollars(api.amounts.subtotal),
          discount = api.amounts.applied_discount
            ? dollars(api.amounts.applied_discount.amount)
            : 0;
        if (
          gross !== subtotal ||
          gross < 0 ||
          discount < 0 ||
          discount > gross ||
          dollars(api.amounts.total) !==
            subtotal - discount + dollars(api.amounts.tax) + dollars(api.amounts.shipping)
        )
          throw new Error('Order merchandise, coupon, tax and buyer total do not reconcile.');
        if (api.transaction_type === 'other' || api.transaction_type === null)
          throw new Error(
            'This order has an unsupported transaction type. Confirm the original business event.',
          );
        earnings = earnings.map((tx) => {
          const decision = this.record('transaction', tx.id)?.resolution?.earnings;
          if (!decision || tx.revisionConflict) return tx;
          if (
            earnings.length !== 1 ||
            gross - discount - decision.fees - decision.processing - decision.shipping !== tx.amount
          )
            return {
              ...tx,
              issue: 'The entered seller charges must reconcile exactly to the reported earnings.',
            };
          return {
            ...tx,
            issue: undefined,
            earnings: {
              merchandise: gross,
              discount,
              netMerchandise: gross - discount,
              ...decision,
              quantity: units.length,
              sku: source.items.length === 1 ? source.items[0].purchased_item?.sku || null : null,
              unitCost: tx.earnings?.unitCost ?? null,
            },
          };
        });
        const reconciled =
          earnings.length > 0 &&
          earnings.every((t) => {
            const e = t.earnings;
            return (
              e &&
              !t.issue &&
              t.currency === 'USD' &&
              e.merchandise - e.discount === e.netMerchandise &&
              e.netMerchandise - e.fees - e.processing - e.shipping === t.amount
            );
          }) &&
          earnings.reduce((n, t) => n + t.earnings!.merchandise, 0) === gross &&
          earnings.reduce((n, t) => n + t.earnings!.discount, 0) === discount &&
          earnings.reduce((n, t) => n + t.earnings!.quantity, 0) === units.length;
        if (local) {
          if (
            local.status !== 'Completed' ||
            local.lines.length !== units.length ||
            local.lines.reduce((n, l) => n + l.price, 0) !== gross ||
            local.discount !== discount
          )
            throw new Error(
              'The existing sale differs from Whatnot. Correct it through its dated ledger; it will not be overwritten.',
            );
          const used = new Set<string>();
          for (const u of units) {
            let id = previous?.resolution?.units?.[u.key]?.itemId || payload.unitMap[u.key];
            if (id === 'new')
              throw new Error(
                'An existing sale cannot be assigned a new physical item. Correct its dated ledger instead.',
              );
            if (!id) {
              const matches = local.lines.filter(
                (l) =>
                  l.price === u.price &&
                  !used.has(l.itemId) &&
                  (!u.item.purchased_item?.sku ||
                    this.w.items
                      .find((i) => i.id === l.itemId)
                      ?.sku.trim()
                      .toLowerCase() === u.item.purchased_item.sku.trim().toLowerCase()),
              );
              if (matches.length !== 1)
                throw new Error(
                  'Match the existing sale’s physical pieces before attaching this Whatnot order.',
                );
              id = matches[0].itemId;
            }
            if (!local.lines.some((l) => l.itemId === id && l.price === u.price) || used.has(id))
              throw new Error('The imported order’s item mapping conflicts with its saved sale.');
            used.add(id);
            payload.unitMap[u.key] = id;
          }
        } else {
          const lines: Order['lines'] = [],
            unknown: string[] = [],
            zero: string[] = [],
            assumed: string[] = [],
            used = new Set<string>();
          for (const u of units) {
            const decision = previous?.resolution?.units?.[u.key];
            let item =
              decision && decision.itemId !== 'new'
                ? this.w.items.find((i) => i.id === decision.itemId)
                : undefined;
            if (decision?.itemId !== 'new' && decision?.itemId && !item)
              throw new Error('The selected inventory item is not in this workspace.');
            const exact = this.w.items.filter(
              (i) =>
                i.sku.trim().toLowerCase() === u.item.purchased_item?.sku?.trim().toLowerCase() ||
                [u.item.product_external_id, u.item.variant_external_id].includes(i.id) ||
                this.w.listings.some(
                  (l) =>
                    l.itemId === i.id &&
                    l.marketplace === 'Whatnot' &&
                    [u.item.variant_id, u.item.product_id].includes(l.externalId),
                ),
            );
            if (!decision) {
              const available = exact.filter((i) => !itemIsSold(this.w, i.id) && !used.has(i.id));
              if (available.length === 1) item = available[0];
            }
            const title = u.item.purchased_item?.title || item?.title;
            if (!title)
              throw new Error('An item name is missing. Add it in Whatnot, then refresh.');
            const related = (reconciled ? earnings : []).filter(
              (t) =>
                t.earnings &&
                ((t.earnings.sku &&
                  t.earnings.sku.trim().toLowerCase() ===
                    u.item.purchased_item?.sku?.trim().toLowerCase()) ||
                  (!t.earnings.sku &&
                    source.items.length === 1 &&
                    t.earnings.quantity === u.item.quantity)),
            );
            const costs = [
              ...new Set(related.map((t) => t.earnings!.unitCost).filter((c) => c !== null)),
            ];
            const supplied = decision?.cost ?? (costs.length === 1 ? costs[0] : null);
            let cost: number | null;
            if (item) {
              if (
                used.has(item.id) ||
                itemIsSold(this.w, item.id) ||
                Date.parse(item.purchasedAt) > Date.parse(api.created_at!)
              )
                throw new Error(
                  'The selected physical item is already allocated, sold, or acquired after this sale.',
                );
              const recorded =
                item.cost > 0 || confirmedFreeInventory(this.w, item.id) ? item.cost : null;
              if (recorded !== null && supplied !== null && recorded !== supplied)
                throw new Error(
                  'Whatnot’s purchase cost differs from recorded inventory. The existing cost is preserved.',
                );
              cost = recorded ?? supplied;
              if (recorded === null && cost !== null && cost !== item.cost) {
                item = { ...item, cost };
                this.put({ type: 'item', value: item });
              }
            } else {
              // Titles and seller SKUs can repeat across genuinely separate auction pieces.
              // Only a unique available exact match is reused. Otherwise the provider's
              // stable order + physical-unit identity defines a new item; retries reuse it.
              cost = supplied;
              const id = stableId(this.userId, this.sellerId, 'unit', api.id, u.key);
              if (this.w.items.some((i) => i.id === id))
                throw new Error(
                  'This Whatnot physical unit already exists; refresh its saved mapping.',
                );
              item = itemSchema.parse({
                id,
                sku: `WN-${id}`,
                title,
                cost: cost ?? 0,
                asking: u.price,
                purchasedAt: api.created_at,
                createdAt: new Date().toISOString(),
                status: 'Purchased',
                notes:
                  'Whatnot API import. Purchase date unknown; sale date is a storage placeholder, not verified purchase history.',
              });
              this.put({ type: 'item', value: item });
              assumed.push(id);
            }
            if (api.transaction_type === 'giveaway' && (cost === null || u.price !== 0))
              throw new Error(
                'Giveaways need confirmed purchase cost (0 if free) and zero merchandise proceeds.',
              );
            if (cost === null) unknown.push(item.id);
            if (cost === 0) zero.push(item.id);
            used.add(item.id);
            payload.unitMap[u.key] = item.id;
            lines.push({ itemId: item.id, price: u.price, costBasis: cost ?? 0 });
          }
          const show = api.show_id
            ? this.w.shows.find((s) => s.type === 'Whatnot' && s.externalId === api.show_id)
            : null;
          if (api.show_id && !show)
            throw new Error(
              'The associated Whatnot show needs a valid date or review before this sale can be attached.',
            );
          local = orderSchema.parse({
            id: stableId(this.userId, this.sellerId, 'order', api.id),
            marketplace: 'Whatnot',
            externalId: api.id,
            date: api.created_at,
            lines,
            discount,
            shippingCollected: 0,
            fees: 0,
            processing: 0,
            shipping: 0,
            packaging: 0,
            other: 0,
            refund: 0,
            feeCredit: 0,
            adjustment: 0,
            tips: 0,
            showId: show?.id || null,
            type: api.transaction_type === 'giveaway' ? 'Giveaway' : 'Sale',
            status: 'Completed',
            fulfillment: 'Unfulfilled',
            payout: 'Pending',
            amountsConfirmed: false,
            provenance:
              'Whatnot Seller API: buyer shipping and tax excluded; seller costs awaiting verified financial report.',
            importKey: `whatnot:${this.sellerId}:order:${api.id}`,
          });
          this.put({ type: 'order', value: local });
          payload.adopted = false;
          this.receipt(local, true, { unknown, zero, assumed });
        }
        const levels = units.map((u) => {
          const shipment = source.shipments.find((s) => s.id === u.item.shipment_id);
          const status = shipment?.status,
            id = payload.unitMap[u.key],
            old = lineFulfillment(local!, id);
          const observed =
            status === 'delivered'
              ? 'Delivered'
              : status && ['dropped_off', 'in_transit'].includes(status)
                ? 'Shipped'
                : null;
          // Never erase a recorded handover date or infer a backwards transition from a
          // replacement/created/cancelled label. API status timestamps are not handover dates.
          const oldStatus = old.status === 'Fulfilled in person' ? 'Handed over' : old.status;
          const next = oldStatus === 'Delivered' || !observed ? oldStatus : observed;
          return { itemId: id, status: next, date: next === oldStatus ? old.date : null };
        });
        const packageExists = this.w.shipments.some((s) => s.orderIds.includes(local!.id));
        if (!packageExists) {
          const fulfillment = levels.every((l) => l.status === 'Delivered')
            ? 'Delivered'
            : levels.some((l) => l.status === 'Unfulfilled')
              ? 'Unfulfilled'
              : 'Shipped';
          if (
            JSON.stringify(local!.itemFulfillments || []) !== JSON.stringify(levels) ||
            local!.fulfillment !== fulfillment
          ) {
            local = { ...local!, fulfillment, itemFulfillments: levels };
            this.put({ type: 'order', value: local });
          }
        }
        let issue = '';
        if (earnings.length && !reconciled)
          issue =
            'The financial report does not reconcile to this order’s merchandise and coupon. Original records are preserved.';
        if (reconciled) {
          if (payload.adopted) {
            const totals = currentOrderTotals(this.w, local!);
            const fees = earnings.reduce(
                (n, t) => n + t.earnings!.fees + t.earnings!.processing,
                0,
              ),
              shipping = earnings.reduce((n, t) => n + t.earnings!.shipping, 0);
            if (
              totals.fees !== fees ||
              local!.shipping !== shipping ||
              local!.shippingCollected !== 0
            )
              issue =
                'Recorded seller costs differ from Whatnot’s financial report. Review the original sale ledger.';
          }
          for (const tx of earnings) {
            if (issue) break;
            if (!payload.adopted) {
              this.event(
                local!,
                'Fee adjustment',
                tx.earnings!.fees + tx.earnings!.processing,
                tx,
                ':fees',
              );
              this.event(local!, 'Direct cost adjustment', tx.earnings!.shipping, tx, ':shipping');
            }
            this.save(
              'transaction',
              tx.id,
              this.record('transaction', tx.id)?.payload || tx,
              'applied',
              '',
              local!.id,
            );
          }
        }
        const refundPosted = txs.some(
          (t) =>
            (t.payload as LedgerTransaction).type === 'ORDER_REFUND' &&
            this.record('transaction', t.external_id)?.state === 'applied',
        );
        if (
          ['cancelled', 'failed', 'pending'].includes(api.status) &&
          !(api.status === 'cancelled' && refundPosted)
        )
          issue =
            'Whatnot changed this order’s payment/cancellation status. Reconcile its actual refund using the financial report; no physical return is assumed.';
        const unresolved = txs.some(
          (t) =>
            t.kind === 'transaction' &&
            this.record('transaction', t.external_id)?.state !== 'applied',
        );
        this.receipt(local!, !reconciled || !!issue || unresolved);
        this.save('order', api.id, payload, issue ? 'review' : 'applied', issue, local!.id);
      });
    } catch (e) {
      this.save(
        'order',
        api.id,
        payload,
        'review',
        message(e),
        this.w.orders.some((o) => o.id === local?.id) ? local!.id : null,
      );
    }
  }
  private event(
    order: Order,
    kind: 'Fee adjustment' | 'Direct cost adjustment' | 'Refund',
    amount: number,
    tx: LedgerTransaction,
    suffix: string,
  ) {
    if (!amount) return;
    const id = stableId(this.userId, this.sellerId, 'ledger', tx.id, suffix);
    const previous = this.w.financialEvents.find((e) => e.id === id);
    if (previous) {
      if (
        previous.amount !== amount ||
        previous.kind !== kind ||
        previous.orderId !== order.id ||
        Date.parse(previous.date) !== Date.parse(tx.date)
      )
        throw new Error(
          'A previously posted ledger component changed. Preserve the original and add a dated correction.',
        );
      return;
    }
    this.put({
      type: 'financialEvent',
      value: {
        id,
        orderId: order.id,
        date: tx.date,
        kind,
        amount,
        reason: `Whatnot financial ledger ${tx.type} ${tx.id}`,
        itemIds: [],
        externalId: `whatnot:${this.sellerId}:${tx.id}${suffix}`,
        reversesId: null,
        category: 'Shipping',
      },
    });
  }
  transaction(tx: LedgerTransaction) {
    const stored = this.record('transaction', tx.id);
    if (stored?.state === 'applied') return;
    const order = tx.orderId
      ? this.w.orders.find((o) => o.marketplace === 'Whatnot' && o.externalId === tx.orderId)
      : null;
    try {
      this.atomic(() => {
        if (tx.issue) throw new Error(tx.issue);
        if (tx.currency !== 'USD')
          throw new Error('A non-USD ledger transaction needs separate currency reconciliation.');
        if (tx.type === 'ORDER_EARNINGS') {
          throw new Error(
            tx.issue || 'This earnings transaction is waiting for its original Whatnot order.',
          );
        }
        if (tx.type === 'ORDER_REFUND' && order) {
          const r = stored?.resolution?.refund;
          if (!r)
            throw new Error(
              'Whatnot reports a net seller refund. Enter its customer refund, fee credit and shipping adjustment to reconcile it without guessing.',
            );
          if (-r.amount + r.feeCredit - r.shippingAdjustment !== tx.amount)
            throw new Error(
              'Refund minus fee credit plus shipping adjustment must equal the reported seller debit exactly.',
            );
          this.event(order, 'Refund', r.amount, tx, ':refund');
          this.event(order, 'Fee adjustment', -r.feeCredit, tx, ':fee-credit');
          this.event(order, 'Direct cost adjustment', r.shippingAdjustment, tx, ':shipping');
        } else if (
          [
            'SHIPPING_CHARGE',
            'CARRIER_ADJUSTMENT',
            'CARRIER_ADJUSTMENT_REFUND',
            'ORDER_REFUND_SHIPPING_COSTS',
            'APPEALED_ORDER_REFUND_SHIPPING_COSTS',
          ].includes(tx.type)
        ) {
          if (order) this.event(order, 'Direct cost adjustment', -tx.amount, tx, ':cost');
          else if (tx.amount < 0) {
            const id = stableId(this.userId, this.sellerId, 'expense', tx.id);
            if (!this.w.expenses.some((e) => e.id === id))
              this.put({
                type: 'expense',
                value: {
                  id,
                  title: `Whatnot ${tx.type} · ${tx.id}`,
                  category: 'Shipping',
                  amount: -tx.amount,
                  date: tx.date,
                  showId: tx.showId
                    ? this.w.shows.find((s) => s.externalId === tx.showId)?.id || null
                    : null,
                  tripId: null,
                },
              });
          } else
            throw new Error(
              'This unallocated carrier credit needs an original order to reconcile. No negative expense or invented sale is created.',
            );
        } else
          throw new Error(
            'This ledger activity has no supported gross accounting breakdown. Reconcile it through the original sale ledger; net earnings are not a cash payout.',
          );
        this.save('transaction', tx.id, tx, 'applied', '', order?.id || null);
        if (order) {
          const earnings = [...this.records.values()].filter(
            (r) =>
              r.kind === 'transaction' && (r.payload as LedgerTransaction).orderId === tx.orderId,
          );
          this.receipt(
            order,
            earnings.some((r) => r.state !== 'applied') ||
              !earnings.some((r) => (r.payload as LedgerTransaction).type === 'ORDER_EARNINGS'),
          );
        }
      });
    } catch (e) {
      this.save('transaction', tx.id, tx, 'review', message(e), order?.id || null);
      if (order) this.receipt(order, true);
    }
  }
}
function message(e: unknown) {
  return e instanceof Error
    ? e.message.slice(0, 1000)
    : 'Review this Whatnot record before posting it.';
}
