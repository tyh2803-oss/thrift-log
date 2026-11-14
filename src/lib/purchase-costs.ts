import { z } from 'zod';
import type { Workspace, Command } from './model';
import { historyCostUnknown } from './cost-knowledge';
import { confirmedFreeInventory } from './assistant/listing-review';
import { correctedCostBasis } from './cost-basis';
export const purchaseCostsSchema = z.strictObject({
  id: z.string().uuid(),
  entries: z
    .array(
      z.strictObject({ itemId: z.string().uuid(), cost: z.number().int().min(0).max(100_000_000) }),
    )
    .min(1)
    .max(200),
  confirmCorrections: z.boolean().default(false),
  reason: z.string().trim().min(1).max(300),
});
export type PurchaseCosts = z.infer<typeof purchaseCostsSchema>;
export const inventoryCostKnown = (w: Workspace, itemId: string) => {
  const item = w.items.find((i) => i.id === itemId);
  return !!item && (item.cost > 0 || confirmedFreeInventory(w, itemId));
};
export function purchaseCostCommands(w: Workspace, input: PurchaseCosts): Command[] {
  const request = purchaseCostsSchema.parse(input);
  if (new Set(request.entries.map((e) => e.itemId)).size !== request.entries.length)
    throw new Error('Select each physical item once.');
  const prior = w.imports.find((i) => i.id === request.id);
  if (prior) {
    if (
      prior.mapping.format !== 'purchase-cost-v1' ||
      JSON.stringify(JSON.parse(prior.rawCsv).request) !== JSON.stringify(request)
    )
      throw new Error('This cost batch was already saved with different values. Open a new batch.');
    return [];
  }
  const commands: Command[] = [],
    changes: { itemId: string; before: number | null; after: number }[] = [];
  let index = 0;
  for (const entry of request.entries) {
    const item = w.items.find((i) => i.id === entry.itemId);
    if (!item) throw new Error('Choose physical items in your workspace.');
    const orders = w.orders.filter((o) => o.lines.some((l) => l.itemId === item.id));
    const correcting =
      (inventoryCostKnown(w, item.id) && item.cost !== entry.cost) ||
      orders.some(
        (o) =>
          !historyCostUnknown(w, o.id, item.id) && correctedCostBasis(w, o, item.id) !== entry.cost,
      );
    if (correcting && !request.confirmCorrections)
      throw new Error('Confirm correcting recorded purchase costs before applying this batch.');
    changes.push({
      itemId: item.id,
      before: inventoryCostKnown(w, item.id) ? item.cost : null,
      after: entry.cost,
    });
    if (item.cost !== entry.cost)
      commands.push({ type: 'item', value: { ...item, cost: entry.cost } });
    for (const order of orders) {
      const delta = entry.cost - correctedCostBasis(w, order, item.id);
      if (delta === 0 && !historyCostUnknown(w, order.id, item.id)) continue;
      const suffix = (++index).toString(16).padStart(8, '0');
      commands.push({
        type: 'financialEvent',
        value: {
          id: request.id.slice(0, -8) + suffix,
          orderId: order.id,
          date: order.date,
          kind: 'Cost basis adjustment',
          amount: delta,
          costItemId: item.id,
          reason: `Purchase cost correction: ${request.reason}`.slice(0, 500),
          itemIds: [],
          externalId: `purchase-cost:${request.id}:${item.id}`,
          reversesId: null,
          category: 'Other',
        },
      });
    }
  }
  commands.push({
    type: 'import',
    value: {
      id: request.id,
      filename: 'Purchase cost batch',
      kind: 'Inventory',
      importedAt: new Date().toISOString(),
      mapping: { format: 'purchase-cost-v1' },
      recordIds: request.entries.map((e) => e.itemId),
      rawCsv: JSON.stringify({
        request,
        changes,
        authorization: 'explicit-batch-approval',
        effectiveDates: 'Original sale dates; original order lines are retained.',
      }),
    },
  });
  return commands;
}
