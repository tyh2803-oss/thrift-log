import type { Command, Workspace } from './model';
import { itemIsSold } from './ledger';

/** Shared nonfinancial stage rules; sale/shipment reversals stay in the full pipeline workflow. */
export function unsoldStageCommands(
  w: Workspace,
  itemId: string,
  destination: 'unlisted' | 'archived',
  confirmed: boolean,
): Command[] {
  const item = w.items.find((i) => i.id === itemId);
  if (!item) throw new Error('Select an item in this workspace.');
  if (itemIsSold(w, itemId))
    throw new Error(
      'This item has a completed sale. Use Change status to review its linked sale and shipping reversal.',
    );
  const active = w.listings.filter((l) => l.itemId === itemId && l.status === 'Active');
  if (active.length && !confirmed)
    throw new Error(
      `Confirm ending ${active.length} active Thrift Log listing records. External marketplaces are not changed.`,
    );
  return [
    ...active.map((listing): Command => ({
      type: 'listing',
      value: { ...listing, status: 'Ended' },
    })),
    {
      type: 'item',
      value: {
        ...item,
        status:
          destination === 'archived'
            ? 'Archived'
            : w.shows.some((s) => s.status !== 'Ended' && s.lineup.some((l) => l.itemId === itemId))
              ? 'Reserved'
              : 'Ready to List',
      },
    },
  ];
}
