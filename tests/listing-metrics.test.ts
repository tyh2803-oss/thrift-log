import { it, expect } from 'vitest';
import { assistantWorkspace } from './helpers/assistant';
import { listingMetrics } from '../src/lib/listing-metrics';
it('counts physical inventory once while summing active marketplace asking prices separately', () => {
  const w = assistantWorkspace();
  expect(listingMetrics(w)).toMatchObject({
    physicalItems: 1,
    activeListings: 2,
    inventoryCost: 1200,
    aggregateAsking: 10000,
    crossListed: 1,
    unlisted: 0,
    sold: 0,
    needsDelisting: 0,
  });
  expect(listingMetrics(w, 'Vinted')).toMatchObject({
    physicalItems: 1,
    activeListings: 1,
    inventoryCost: 1200,
    aggregateAsking: 4500,
    crossListed: 1,
  });
  w.items[0].status = 'Sold';
  w.listings[0].status = 'Sold';
  w.listings[1].status = 'Needs delisting';
  expect(listingMetrics(w)).toMatchObject({
    physicalItems: 1,
    activeListings: 0,
    inventoryCost: 0,
    aggregateAsking: 0,
    sold: 1,
    needsDelisting: 1,
  });
});
it('counts unlisted stock and safely handles an empty marketplace filter', () => {
  const w = assistantWorkspace();
  w.items.push({
    ...w.items[0],
    id: crypto.randomUUID(),
    sku: 'NEW',
    status: 'Purchased',
    cost: 200,
  });
  expect(listingMetrics(w).unlisted).toBe(1);
  expect(listingMetrics(w).inventoryCost).toBe(1400);
  expect(listingMetrics(w, 'eBay')).toMatchObject({
    physicalItems: 0,
    activeListings: 0,
    inventoryCost: 0,
    aggregateAsking: 0,
  });
});
