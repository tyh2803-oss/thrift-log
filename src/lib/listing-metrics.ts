import { marketplaces, type Workspace } from './model';
/** Physical cost is counted once; marketplace asking prices are explicitly aggregated. */
export function listingMetrics(w: Workspace, marketplace: string = 'All marketplaces') {
  const listings = w.listings.filter(
    (l) => marketplace === 'All marketplaces' || l.marketplace === marketplace,
  );
  const listedItemIds = new Set(listings.map((l) => l.itemId));
  const items = w.items.filter(
    (i) => marketplace === 'All marketplaces' || listedItemIds.has(i.id),
  );
  const active = listings.filter((l) => l.status === 'Active');
  const available = items.filter((i) => !['Sold', 'Archived'].includes(i.status));
  return {
    physicalItems: items.length,
    activeListings: active.length,
    inventoryCost: available.reduce((n, i) => n + i.cost, 0),
    aggregateAsking: active.reduce((n, l) => n + l.price, 0),
    crossListed: items.filter(
      (i) =>
        new Set(
          w.listings
            .filter((l) => l.itemId === i.id && l.status === 'Active')
            .map((l) => l.marketplace),
        ).size > 1,
    ).length,
    unlisted: available.filter(
      (i) => !w.listings.some((l) => l.itemId === i.id && l.status === 'Active'),
    ).length,
    sold: items.filter((i) => i.status === 'Sold').length,
    needsDelisting: listings.filter((l) => l.status === 'Needs delisting').length,
    byMarketplace: marketplaces.map((m) => ({
      marketplace: m,
      active: active.filter((l) => l.marketplace === m).length,
    })),
  };
}
