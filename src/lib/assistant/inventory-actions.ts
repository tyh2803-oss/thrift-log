import { itemSchema, type Command, type Workspace } from '../model';
import { applyCommand } from '../commands';
import { purchaseCostCommands } from '../purchase-costs';
import { applyPipelineMove } from '../pipeline-moves';
import { zoneMidnight } from '../dates';
import type { DraftRow } from './drafts';

/** Use canonical operations on a private snapshot; caller still requires explicit approval. */
export async function inventoryActionCommands(
  w: Workspace,
  row: DraftRow,
  baseRevision = w.revision,
): Promise<Command[]> {
  const a = row.inventoryChange;
  if (!a || row.sourceHash !== 'conversation' || !row.intent?.trim())
    throw new Error('Review the inventory request before approving.');
  if (a.costOperationId === row.id || a.move?.id === row.id || a.move?.id === a.costOperationId)
    throw new Error('Pending operation IDs conflict. Recreate this proposal before approving.');
  if (a.invalidFields.length)
    throw new Error('Correct the invalid monetary amounts on this proposal.');
  if (a.patch.title !== undefined && !a.patch.title.trim()) throw new Error('Enter an item name.');
  if (a.patch.sku !== undefined && !a.patch.sku.trim())
    throw new Error('Enter a SKU or leave the automatic SKU unchanged.');
  let next = w;
  const commands: Command[] = [];
  const add = (list: Command[]) => {
    next = list.reduce(applyCommand, next);
    commands.push(...list);
  };
  const item = w.items.find((i) => i.id === a.itemId);
  if (a.action === 'create') {
    if (item) throw new Error('This proposed inventory item already exists. Refresh the review.');
    if (!a.patch.title?.trim()) throw new Error('Enter an item name.');
    if (a.purchaseCost === null)
      throw new Error('Enter the purchase cost ($0 means confirmed free).');
    if (!a.patch.purchasedAt) throw new Error('Choose an acquisition date.');
  } else if (!item) throw new Error('Choose an existing item in this workspace.');
  if (a.action !== 'create' && a.action !== 'edit' && Object.keys(a.patch).length)
    throw new Error('Keep detail edits separate from a bulk cost or stage move.');
  if (a.action === 'create' || a.action === 'edit') {
    const patch = { ...a.patch };
    if (patch.purchasedAt !== undefined) {
      if (!patch.purchasedAt.trim()) throw new Error('Choose a valid acquisition date.');
      const value = patch.purchasedAt;
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const day = new Date(value + 'T00:00:00Z');
        if (!Number.isFinite(+day) || day.toISOString().slice(0, 10) !== value)
          throw new Error('Choose a valid acquisition date.');
        patch.purchasedAt = new Date(zoneMidnight(value, w.settings.timezone)).toISOString();
      }
      if (
        !Number.isFinite(Date.parse(patch.purchasedAt)) ||
        Date.parse(patch.purchasedAt) > Date.now() + 300000
      )
        throw new Error('Choose a valid acquisition date that is not in the future.');
      if (
        w.orders.some(
          (o) =>
            o.lines.some((l) => l.itemId === a.itemId) &&
            Date.parse(o.date) < Date.parse(patch.purchasedAt!),
        )
      )
        throw new Error('Acquisition date must be on or before the item’s recorded sales.');
    }
    add([
      {
        type: 'item',
        value: itemSchema.parse(
          item
            ? { ...item, ...patch }
            : {
                id: a.itemId,
                sku: `AI-${a.itemId}`,
                ...patch,
                cost: a.purchaseCost,
                asking: patch.asking ?? 0,
                status: 'Purchased',
                tripId: null,
                photos: [],
                condition: patch.condition ?? '',
                createdAt: new Date().toISOString(),
              },
        ),
      },
    ]);
  }
  if (a.action === 'cost' && a.purchaseCost === null) throw new Error('Enter the purchase cost.');
  if (a.purchaseCost !== null)
    add(
      purchaseCostCommands(next, {
        id: a.costOperationId,
        entries: [{ itemId: a.itemId, cost: a.purchaseCost }],
        confirmCorrections: a.confirmCostCorrection,
        reason: row.intent.slice(0, 300),
      }),
    );
  if (a.move) {
    if (a.move.revision !== baseRevision)
      throw new Error('Workspace changed. Refresh and review the stage move.');
    if (a.action !== 'stage' && (a.move.items.length !== 1 || a.move.items[0].itemId !== a.itemId))
      throw new Error('A new-item proposal can only move its own physical item.');
    const planned: Command[] = [];
    const result = await applyPipelineMove(next, { ...a.move, revision: next.revision }, planned);
    if (result.failures.length) throw new Error(result.failures[0].message);
    // Only the canonical planner supplies this trace; client/model commands are never accepted.
    next = result.workspace;
    commands.push(...planned);
  }
  if (!commands.length) throw new Error('Enter a detail, purchase cost or stage change.');
  return commands;
}
