import { confirmedFreeInventory } from './assistant/listing-review';
import { unsoldStageCommands } from './unsold-stage';
import { z } from 'zod';
import { applyCommand } from './commands';
import { inventoryPipeline, inventoryStages } from './pipeline';
import { currentOrderTotals, paidForOrder, returnedItemIds } from './ledger';
import { setItemFulfillment } from './fulfillment-state';
import { orderSchema, listingSchema, marketplaces, type Command, type Workspace } from './model';
const cents = z.number().int().min(0).max(100_000_000).nullable();
export const pipelineMoveSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().min(0),
  destination: z.enum(inventoryStages),
  date: z.iso.datetime({ offset: true }),
  confirmConsequences: z.boolean(),
  items: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        listing: z
          .object({ marketplace: z.enum(marketplaces).nullable(), price: cents })
          .optional(),
        sale: z
          .object({
            marketplace: z.enum(marketplaces).nullable(),
            date: z.iso.datetime({ offset: true }),
            price: cents,
            purchaseCost: cents,
            fees: cents,
            processing: cents,
            shipping: cents,
            shippingCollected: cents,
            discount: cents,
            other: cents,
          })
          .optional(),
      }),
    )
    .min(1)
    .max(200),
});
export type PipelineMove = z.infer<typeof pipelineMoveSchema>;
export type MoveFailure = { itemId: string; message: string };
export type MoveResult = {
  workspace: Workspace;
  successIds: string[];
  failures: MoveFailure[];
  unchangedIds: string[];
  replayed: boolean;
};
async function stableId(operation: string, key: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${operation}:${key}`)),
  );
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function fingerprint(request: PipelineMove) {
  return JSON.stringify({ ...request, revision: 0 });
}
export function replayPipelineMove(w: Workspace, request: PipelineMove): MoveResult | null {
  const receipt = w.imports.find((r) => r.id === request.id);
  if (!receipt) return null;
  if (receipt.mapping.format !== 'pipeline-v1')
    throw new Error('This operation ID already belongs to another record.');
  const audit = JSON.parse(receipt.rawCsv);
  if (audit.fingerprint !== fingerprint(request))
    throw new Error('This retry changed its contents. Start a new move.');
  return { workspace: w, ...audit.result, replayed: true };
}
/** Canonical commands only. Valid item/order groups commit together; failed groups never leak commands. */
export async function applyPipelineMove(w: Workspace, input: PipelineMove): Promise<MoveResult> {
  const request = pipelineMoveSchema.parse(input);
  if (new Set(request.items.map((r) => r.itemId)).size !== request.items.length)
    throw new Error('Select each physical item once.');
  const replay = replayPipelineMove(w, request);
  if (replay) return replay;
  if (w.revision !== request.revision)
    throw new Error('Workspace changed. Refresh and review this move again.');
  if (Date.parse(request.date) > Date.now() + 300000)
    throw new Error('Use an actual event date, not a future date.');
  const selected = new Set(request.items.map((r) => r.itemId));
  const before = inventoryPipeline(w),
    byItem = new Map(before.entries.map((e) => [e.item.id, e]));
  let next = w;
  const successIds: string[] = [],
    unchangedIds: string[] = [],
    failures: MoveFailure[] = [];
  const processed = new Set<string>();
  const push = (commands: Command[]) => {
    next = commands.reduce(applyCommand, next);
  };
  for (const row of request.items) {
    if (processed.has(row.itemId)) continue;
    const entry = byItem.get(row.itemId),
      item = next.items.find((i) => i.id === row.itemId);
    let group = [row.itemId];
    try {
      if (!item) throw new Error('Inventory item was not found.');
      const current = item.status === 'Archived' ? 'archived' : entry?.stage;
      if (request.destination === 'archived' && entry?.order)
        throw new Error('Only unsold items can be archived. Correct the sale first.');
      if (current === request.destination) {
        successIds.push(item.id);
        unchangedIds.push(item.id);
        processed.add(item.id);
        continue;
      }
      let trial = next;
      const commands: Command[] = [];
      const add = (command: Command) => {
        trial = applyCommand(trial, command);
        commands.push(command);
      };
      const order = entry?.order;
      const undoSale = !!order && ['unlisted', 'for-sale'].includes(request.destination);
      const resetShipping = current === 'shipped' && request.destination === 'sold';
      const pkg = order ? trial.shipments.find((s) => s.orderIds.includes(order.id)) : undefined;
      if ((undoSale || resetShipping || (request.destination === 'shipped' && !!pkg)) && pkg) {
        const related = trial.orders
          .filter((o) => pkg.orderIds.includes(o.id))
          .flatMap((o) =>
            o.lines.filter((l) => !returnedItemIds(trial, o.id).has(l.itemId)).map((l) => l.itemId),
          );
        if (!related.every((id) => selected.has(id)))
          throw new Error(
            `This package affects ${related.length} pieces. Select all linked package items to correct it together.`,
          );
        group = related;
      }
      if (undoSale && order) {
        const ids = order.lines
          .filter((l) => !returnedItemIds(trial, order.id).has(l.itemId))
          .map((l) => l.itemId);
        if (!ids.every((id) => selected.has(id)))
          throw new Error(
            `Undo affects the whole order (${ids.length} pieces). Select every remaining piece, or use the order's partial return workflow.`,
          );
        group = pkg ? group : ids;
      }
      if (
        (undoSale ||
          resetShipping ||
          (['unlisted', 'archived'].includes(request.destination) && entry?.listings.length)) &&
        !request.confirmConsequences
      )
        throw new Error('Confirm the listed reversals and internal listing changes before saving.');
      if (pkg && (undoSale || resetShipping || request.destination === 'shipped'))
        add({
          type: 'shipment',
          value: {
            ...pkg,
            status: request.destination === 'shipped' ? 'Shipped' : 'Preparing',
            date: request.date,
          },
        });
      const groupsOrders = undoSale
        ? trial.orders.filter(
            (o) =>
              o.lines.some((l) => group.includes(l.itemId)) &&
              o.status === 'Completed' &&
              o.lines.some((l) => !returnedItemIds(trial, o.id).has(l.itemId)),
          )
        : [];
      for (const sold of groupsOrders) {
        if (sold.payout === 'Paid' || paidForOrder(trial, sold.id) !== 0)
          throw new Error(
            'This sale has a payout. Reconcile its cash receipt before undoing the sale.',
          );
        const ids = sold.lines
          .filter((l) => !returnedItemIds(trial, sold.id).has(l.itemId))
          .map((l) => l.itemId);
        if (!ids.every((id) => selected.has(id)))
          throw new Error('Select all remaining physical pieces from the sale before undoing it.');
        const totals = currentOrderTotals(trial, sold);
        const reason =
          'Correction of accidental sale entry through pipeline; no external refund or marketplace action.';
        const event = async (
          kind:
            | 'Refund'
            | 'Return'
            | 'Revenue adjustment'
            | 'Fee adjustment'
            | 'Direct cost adjustment',
          amount: number,
          itemIds: string[] = [],
        ) =>
          add({
            type: 'financialEvent',
            value: {
              id: await stableId(request.id, `${sold.id}:${kind}`),
              orderId: sold.id,
              date: request.date,
              kind,
              amount,
              itemIds,
              reason,
              externalId: `pipeline:${request.id}:${kind}`,
              reversesId: null,
              category: 'Other',
            },
          });
        if (totals.revenue > 0) await event('Refund', totals.revenue, ids);
        else {
          if (totals.revenue < 0) await event('Revenue adjustment', -totals.revenue);
          await event('Return', 0, ids);
        }
        if (totals.fees) await event('Fee adjustment', -totals.fees);
        if (totals.direct - totals.fees)
          await event('Direct cost adjustment', -(totals.direct - totals.fees));
        add({
          type: 'order',
          value: {
            ...trial.orders.find((o) => o.id === sold.id)!,
            fulfillment: 'Unfulfilled',
            itemFulfillments: [],
          },
        });
      }
      for (const id of group) {
        const member = request.items.find((r) => r.itemId === id)!;
        let physical = trial.items.find((i) => i.id === id)!;
        const original = byItem.get(id);
        if (['unlisted', 'for-sale', 'archived'].includes(request.destination)) {
          if (request.destination === 'unlisted' || request.destination === 'archived') {
            unsoldStageCommands(
              trial,
              id,
              request.destination,
              request.confirmConsequences,
            ).forEach(add);
          } else {
            if (physical.status === 'Archived') {
              physical = { ...physical, status: 'Ready to List' };
              add({ type: 'item', value: physical });
            }
            if (
              !member.listing?.marketplace ||
              member.listing.price === null ||
              member.listing.price === undefined
            )
              throw new Error(`Enter marketplace and asking price for ${physical.sku}.`);
            const old = trial.listings.find(
              (l) => l.itemId === id && l.marketplace === member.listing!.marketplace,
            );
            add({
              type: 'listing',
              value: listingSchema.parse({
                id: old?.id || (await stableId(request.id, `${id}:listing`)),
                itemId: id,
                marketplace: member.listing.marketplace,
                price: member.listing.price,
                originalPrice: old?.originalPrice ?? member.listing.price,
                externalId: old?.externalId || '',
                url: old?.url || '',
                listedAt: old?.listedAt || request.date,
                status: 'Active',
                format: old?.format || 'Fixed price',
                lastSync: old?.lastSync ?? null,
              }),
            });
          }
        } else {
          if (physical.status === 'Archived') {
            physical = { ...physical, status: 'Ready to List' };
            add({ type: 'item', value: physical });
          }
          let sale = original?.order;
          if (!sale) {
            const details = member.sale;
            if (!details?.marketplace || Object.values(details).some((v) => v === null))
              throw new Error(
                `Enter actual sale price, marketplace, date, purchase cost and expenses for ${physical.sku}.`,
              );
            if (
              Date.parse(details.date) > Date.now() + 300000 ||
              Date.parse(details.date) < Date.parse(physical.purchasedAt)
            )
              throw new Error(
                `Use a sale date on or after acquisition and not in the future for ${physical.sku}.`,
              );
            if (
              details.purchaseCost !== physical.cost &&
              (physical.cost > 0 || confirmedFreeInventory(trial, id))
            )
              throw new Error(
                `Recorded acquisition cost for ${physical.sku} changed. Refresh or correct it in inventory first.`,
              );
            if (details.purchaseCost !== physical.cost) {
              physical = { ...physical, cost: details.purchaseCost! };
              add({ type: 'item', value: physical });
            }
            sale = orderSchema.parse({
              id: await stableId(request.id, `${id}:sale`),
              marketplace: details.marketplace,
              externalId: '',
              date: details.date,
              showId: null,
              lines: [{ itemId: id, price: details.price!, costBasis: physical.cost }],
              fees: details.fees,
              processing: details.processing,
              shipping: details.shipping,
              shippingCollected: details.shippingCollected,
              discount: details.discount,
              other: details.other,
              packaging: 0,
              refund: 0,
              feeCredit: 0,
              adjustment: 0,
              tips: 0,
              type: 'Sale',
              status: 'Completed',
              fulfillment: 'Unfulfilled',
              payout: 'Pending',
              amountsConfirmed: true,
              provenance: 'Pipeline sale review',
              importKey: `pipeline:${request.id}:${id}`,
            });
            add({ type: 'order', value: sale });
          } else sale = trial.orders.find((o) => o.id === sale!.id)!;
          if (!pkg)
            add({
              type: 'order',
              value: setItemFulfillment(
                sale,
                id,
                request.destination === 'shipped'
                  ? sale.marketplace === 'In person'
                    ? 'Handed over'
                    : 'Shipped'
                  : 'Unfulfilled',
                request.date,
              ),
            });
        }
      }
      push(commands);
      group.forEach((id) => {
        processed.add(id);
        successIds.push(id);
      });
    } catch (error) {
      group.forEach((id) => {
        processed.add(id);
        failures.push({
          itemId: id,
          message: error instanceof Error ? error.message : 'Move could not be validated.',
        });
      });
    }
  }
  const result = { successIds, failures, unchangedIds };
  next = applyCommand(next, {
    type: 'import',
    value: {
      id: request.id,
      filename: `pipeline-${request.id}.json`,
      kind: 'Inventory',
      importedAt: new Date().toISOString(),
      rawCsv: JSON.stringify({
        fingerprint: fingerprint(request),
        request,
        result,
        before: {
          items: w.items
            .filter((item) => selected.has(item.id))
            .map(({ id, status, cost, asking, purchasedAt }) => ({
              id,
              status,
              cost,
              asking,
              purchasedAt,
            })),
          listings: w.listings.filter((listing) => selected.has(listing.itemId)),
          orders: w.orders.filter((o) => o.lines.some((l) => selected.has(l.itemId))),
          shipments: w.shipments.filter((s) =>
            w.orders.some(
              (o) => s.orderIds.includes(o.id) && o.lines.some((l) => selected.has(l.itemId)),
            ),
          ),
        },
      }),
      mapping: { format: 'pipeline-v1' },
      recordIds: successIds,
    },
  });
  return { workspace: next, ...result, replayed: false };
}
