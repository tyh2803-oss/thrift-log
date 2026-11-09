import { applyOperational } from './operational-commands';
import { itemIsSold, returnedItemIds } from './ledger';
import { commandSchema, workspaceSchema, type Command, type Workspace } from './model';
const upsert = <T extends { id: string }>(rows: T[], value: T) =>
  rows.some((r) => r.id === value.id)
    ? rows.map((r) => (r.id === value.id ? value : r))
    : [...rows, value];
export function applyCommand(current: Workspace, input: Command): Workspace {
  const c = commandSchema.parse(input);
  const w = structuredClone(current);
  const exists = (rows: { id: string }[], id: string | null, name: string) => {
    if (id && !rows.some((r) => r.id === id)) throw new Error(`${name} was not found.`);
  };
  switch (c.type) {
    case 'financialEvent':
    case 'payout':
    case 'shipment':
      applyOperational(w, c);
      break;
    case 'item': {
      if (
        w.items.some(
          (i) => i.sku.toLowerCase() === c.value.sku.toLowerCase() && i.id !== c.value.id,
        )
      )
        throw new Error('This SKU already exists.');
      exists(w.trips, c.value.tripId, 'Sourcing trip');
      const sold = itemIsSold(w, c.value.id);
      if ((c.value.status === 'Sold') !== sold)
        throw new Error('Record or return a sale to change sold inventory.');
      w.items = upsert(w.items, c.value);
      break;
    }
    case 'listing': {
      exists(w.items, c.value.itemId, 'Inventory item');
      const item = w.items.find((i) => i.id === c.value.itemId)!;
      if (c.value.status === 'Active' && ['Sold', 'Archived'].includes(item.status))
        throw new Error('Sold or archived inventory cannot have an active listing.');
      if (
        c.value.externalId &&
        w.listings.some(
          (l) =>
            l.id !== c.value.id &&
            l.marketplace === c.value.marketplace &&
            l.externalId === c.value.externalId,
        )
      )
        throw new Error('This marketplace listing already exists.');
      w.listings = upsert(w.listings, c.value);
      if (c.value.status === 'Active' && item.status !== 'Reserved') item.status = 'Listed';
      break;
    }
    case 'order': {
      const o = c.value;
      if (
        w.orders.some(
          (r) =>
            r.id !== o.id &&
            ((o.externalId && r.marketplace === o.marketplace && r.externalId === o.externalId) ||
              (o.importKey && r.importKey === o.importKey)),
        )
      )
        throw new Error('This order has already been recorded.');
      if (o.type !== 'Tip' && o.lines.length === 0)
        throw new Error('Select at least one physical item.');
      if (o.type === 'Tip' && o.lines.length)
        throw new Error('Tips must be recorded separately from merchandise.');
      if (new Set(o.lines.map((l) => l.itemId)).size !== o.lines.length)
        throw new Error('Each physical item may appear only once.');
      const old = w.orders.find((r) => r.id === o.id);
      if (
        old &&
        JSON.stringify(old.lines.map((l) => [l.itemId, l.costBasis])) !==
          JSON.stringify(o.lines.map((l) => [l.itemId, l.costBasis]))
      )
        throw new Error(
          'Item allocations and historical cost basis cannot be changed after a sale.',
        );
      if (old && w.financialEvents.some((e) => e.orderId === o.id)) {
        const protectedFields = [
          'date',
          'marketplace',
          'lines',
          'discount',
          'shippingCollected',
          'fees',
          'processing',
          'shipping',
          'packaging',
          'other',
          'refund',
          'feeCredit',
          'adjustment',
          'tips',
          'type',
          'status',
        ] as const;
        if (protectedFields.some((key) => JSON.stringify(old[key]) !== JSON.stringify(o[key])))
          throw new Error(
            'This order has dated ledger entries. Reverse or add a dated adjustment instead of rewriting its financial basis.',
          );
      }
      const linkedPackage = w.shipments.find((s) => s.orderIds.includes(o.id));
      if (
        linkedPackage &&
        o.fulfillment !==
          (linkedPackage.status === 'Preparing' ? 'Unfulfilled' : linkedPackage.status)
      )
        throw new Error(
          'Update fulfillment from the linked package so every grouped order stays consistent.',
        );
      exists(w.shows, o.showId, 'Show or event');
      const gross = o.lines.reduce((n, l) => n + l.price, 0);
      if (o.discount > gross) throw new Error('Discount cannot exceed merchandise sales.');
      if (o.refund > gross - o.discount + o.shippingCollected + o.tips)
        throw new Error('Refund exceeds seller revenue. Use an adjustment for additional charges.');
      if (o.feeCredit > o.fees + o.processing) throw new Error('Fee credit exceeds recorded fees.');
      for (const l of o.lines) {
        exists(w.items, l.itemId, 'Inventory item');
        const item = w.items.find((i) => i.id === l.itemId)!;
        if (!old && o.status === 'Completed') {
          for (const previous of w.orders.filter(
            (r) =>
              r.id !== o.id &&
              r.lines.some((line) => line.itemId === l.itemId) &&
              returnedItemIds(w, r.id).has(l.itemId),
          )) {
            const lastReturn = w.financialEvents
              .filter(
                (e) =>
                  e.orderId === previous.id &&
                  e.itemIds.includes(l.itemId) &&
                  !w.financialEvents.some((r) => r.reversesId === e.id),
              )
              .at(-1);
            if (lastReturn && Date.parse(o.date) < Date.parse(lastReturn.date))
              throw new Error('The resale date cannot precede the physical return.');
          }
        }
        if (!old && l.costBasis !== item.cost)
          throw new Error('Refresh this item’s purchase cost before recording the sale.');
        if (o.status === 'Completed' && itemIsSold(w, l.itemId, o.id))
          throw new Error('This physical item has already sold.');
        if (o.type === 'Giveaway' && l.price !== 0)
          throw new Error('Giveaways must have a zero merchandise price.');
      }
      w.orders = upsert(w.orders, o);
      for (const l of o.lines) {
        const item = w.items.find((i) => i.id === l.itemId)!;
        item.status = itemIsSold(w, l.itemId) ? 'Sold' : 'Returned';
        if (!old || old.status !== o.status)
          w.listings = w.listings.map((listing) =>
            listing.itemId !== l.itemId
              ? listing
              : {
                  ...listing,
                  status:
                    o.status === 'Completed'
                      ? listing.marketplace === o.marketplace
                        ? 'Sold'
                        : listing.status === 'Active'
                          ? 'Needs delisting'
                          : listing.status
                      : listing.status === 'Needs delisting' || listing.status === 'Sold'
                        ? 'Ended'
                        : listing.status,
                },
          );
      }
      break;
    }
    case 'expense':
      exists(w.shows, c.value.showId, 'Show');
      exists(w.trips, c.value.tripId, 'Trip');
      w.expenses = upsert(w.expenses, c.value);
      break;
    case 'location':
      w.locations = upsert(w.locations, c.value);
      break;
    case 'trip':
      exists(w.locations, c.value.locationId, 'Location');
      w.trips = upsert(w.trips, c.value);
      break;
    case 'show': {
      if (new Set(c.value.lineup.map((l) => l.itemId)).size !== c.value.lineup.length)
        throw new Error('Duplicate show inventory.');
      for (const l of c.value.lineup) {
        exists(w.items, l.itemId, 'Inventory item');
        if (
          w.shows.some(
            (s) =>
              s.id !== c.value.id &&
              s.status !== 'Ended' &&
              s.lineup.some((p) => p.itemId === l.itemId),
          ) &&
          c.value.status !== 'Ended'
        )
          throw new Error('An item is reserved for another event.');
      }
      w.shows = upsert(w.shows, c.value);
      for (const item of w.items) {
        if (['Sold', 'Archived'].includes(item.status)) continue;
        if (w.shows.some((s) => s.status !== 'Ended' && s.lineup.some((l) => l.itemId === item.id)))
          item.status = 'Reserved';
        else if (item.status === 'Reserved')
          item.status = w.listings.some((l) => l.itemId === item.id && l.status === 'Active')
            ? 'Listed'
            : 'Ready to List';
      }
      break;
    }
    case 'session': {
      const s = c.value;
      exists(w.shows, s.showId, 'Show');
      exists(w.trips, s.tripId, 'Trip');
      exists(w.locations, s.locationId, 'Location');
      if (
        s.state !== 'Ended' &&
        s.state !== 'Deleted' &&
        w.sessions.some((r) => r.id !== s.id && ['Running', 'Paused'].includes(r.state))
      )
        throw new Error('End the current timer first.');
      if (
        s.segments.some(
          (r, i) =>
            (r.end && Date.parse(r.end) < Date.parse(r.start)) ||
            (!r.end && (s.state !== 'Running' || i !== s.segments.length - 1)),
        )
      )
        throw new Error('Invalid timer interval.');
      if (s.state === 'Running' && s.segments.at(-1)?.end !== null)
        throw new Error('A running timer needs an open interval.');
      for (let i = 1; i < s.segments.length; i++)
        if (
          Date.parse(s.segments[i].start) < Date.parse(s.segments[i - 1].end ?? s.segments[i].start)
        )
          throw new Error('Timer intervals cannot overlap.');
      w.sessions = upsert(w.sessions, s);
      break;
    }
    case 'import':
      w.imports = upsert(w.imports, c.value);
      break;
    case 'settings': {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: c.value.timezone });
      } catch {
        throw new Error('Use a valid IANA timezone.');
      }
      w.settings = c.value;
      break;
    }
  }
  w.revision++;
  return workspaceSchema.parse(w);
}
