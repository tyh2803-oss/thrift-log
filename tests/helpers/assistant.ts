import type { ExtractedLine, ExtractedRecord } from '../../src/lib/assistant/schema';
export const extractedLine = (patch: Partial<ExtractedLine> = {}): ExtractedLine => ({
  title: 'Blue Carhartt jacket',
  brand: 'Carhartt',
  size: 'L',
  color: 'Blue',
  category: null,
  condition: null,
  description: null,
  sku: null,
  externalProductId: null,
  listingId: null,
  url: null,
  price: 4500,
  ...patch,
});
export const extractedSale = (patch: Partial<ExtractedRecord> = {}): ExtractedRecord => ({
  kind: 'sale',
  marketplace: 'Vinted',
  currency: 'USD',
  status: 'completed',
  date: '2026-11-08',
  externalOrderId: 'order-123',
  lines: [extractedLine()],
  fees: 400,
  processing: 0,
  shipping: 300,
  shippingCollected: 0,
  discount: 0,
  refund: 0,
  other: 0,
  warnings: [],
  ...patch,
});

import { itemSchema, emptyWorkspace, type Workspace } from '../../src/lib/model';
export function assistantWorkspace(): Workspace {
  const w = emptyWorkspace();
  w.items = [
    itemSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      sku: 'JACKET-1',
      title: 'Blue Carhartt Workwear Jacket',
      brand: 'Carhartt',
      size: 'L',
      color: 'Blue',
      cost: 1200,
      asking: 5500,
      purchasedAt: '2026-10-01T12:00:00Z',
      status: 'Listed',
      createdAt: '2026-10-01T12:00:00Z',
    }),
  ];
  w.listings = [
    {
      id: '22222222-2222-4222-8222-222222222222',
      itemId: w.items[0].id,
      marketplace: 'Vinted',
      externalId: 'listing-1',
      url: 'https://vinted.test/items/1',
      price: 4500,
      originalPrice: 5000,
      listedAt: '2026-10-02T12:00:00Z',
      status: 'Active',
      format: 'Fixed price',
      lastSync: null,
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      itemId: w.items[0].id,
      marketplace: 'Depop',
      externalId: 'depop-1',
      url: '',
      price: 5500,
      originalPrice: 5500,
      listedAt: '2026-10-02T12:00:00Z',
      status: 'Active',
      format: 'Fixed price',
      lastSync: null,
    },
  ];
  return w;
}
