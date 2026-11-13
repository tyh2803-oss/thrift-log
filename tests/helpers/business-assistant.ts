import { assistantWorkspace } from './assistant';
import { localDay, zoneMidnight } from '../../src/lib/dates';
export function businessWorkspace() {
  const w = assistantWorkspace();
  w.settings.timezone = 'America/New_York';
  w.items[0] = {
    ...w.items[0],
    title: 'Black Harley Davidson T-Shirt',
    brand: 'Harley Davidson',
    sku: 'HARLEY-BLACK-L',
    size: 'L',
    cost: 1200,
    asking: 4500,
  };
  const day = new Date(`${localDay(new Date(), w.settings.timezone)}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  w.listings = w.listings.map((l) => ({
    ...l,
    marketplace: 'Depop' as const,
    listedAt: new Date(
      zoneMidnight(day.toISOString().slice(0, 10), w.settings.timezone),
    ).toISOString(),
  }));
  return w;
}
export function saleChange(itemId: string, patch: Record<string, unknown> = {}) {
  return {
    action: 'sale',
    itemId,
    orderId: null,
    identityEvidence: 'Harley tee',
    marketplace: 'Depop',
    date: null,
    dateEvidence: null,
    price: 3500,
    fees: null,
    processing: null,
    shipping: null,
    shippingCollected: null,
    discount: null,
    refund: null,
    other: null,
    ...patch,
  };
}
export const inventorySearch = {
  query: 'Harley tee',
  marketplace: null,
  stage: null,
  listedOn: null,
  offset: 0,
  limit: 20,
};
export const emptyDrafts = { batch: null, historyBatch: null };
