import { z } from 'zod';

export const marketplaces = ['Depop', 'Vinted', 'eBay', 'Whatnot', 'In person'] as const;
export const categories = ['Buying', 'Listing', 'Selling'] as const;
export const itemStatuses = [
  'Purchased',
  'Unprocessed',
  'Ready to List',
  'Listed',
  'Reserved',
  'Sold',
  'Returned',
  'Archived',
] as const;
const id = z.string().uuid();
const text = z.string().trim().max(500);
const cents = z.number().int().min(0).max(100_000_000);
const signed = z.number().int().min(-100_000_000).max(100_000_000);
const date = z.iso.datetime({ offset: true });
const optionalId = id.nullable().default(null);
export const itemSchema = z.object({
  id,
  sku: text.min(1),
  title: text.min(1),
  brand: text.default(''),
  category: text.default('Other'),
  size: text.default(''),
  color: text.default(''),
  condition: text.default('Good'),
  description: text.default(''),
  cost: cents,
  asking: cents,
  purchasedAt: date,
  source: text.default(''),
  storage: text.default(''),
  notes: text.default(''),
  status: z.enum(itemStatuses),
  tripId: optionalId,
  photos: z.array(z.string().max(1_500_000)).max(8).default([]),
  createdAt: date,
});
export const listingSchema = z.object({
  id,
  itemId: id,
  marketplace: z.enum(marketplaces),
  price: cents,
  originalPrice: cents,
  externalId: text.default(''),
  url: z
    .string()
    .max(2000)
    .refine((v) => !v || /^https:\/\//.test(v), 'Use an HTTPS listing URL')
    .default(''),
  listedAt: date,
  status: z.enum(['Active', 'Sold', 'Needs delisting', 'Ended']),
  format: z.enum(['Fixed price', 'Auction']).default('Fixed price'),
  lastSync: date.nullable().default(null),
});
export const itemFulfillmentSchema = z.object({
  itemId: id,
  status: z.enum(['Unfulfilled', 'Shipped', 'Delivered', 'Handed over']),
  date: date.nullable(),
});
export const orderSchema = z.object({
  id,
  marketplace: z.enum(marketplaces),
  externalId: text.default(''),
  date,
  showId: optionalId,
  lines: z.array(z.object({ itemId: id, price: cents, costBasis: cents })).max(500),
  discount: cents,
  shippingCollected: cents,
  fees: cents,
  processing: cents,
  shipping: cents,
  packaging: cents,
  other: cents,
  refund: cents,
  feeCredit: cents,
  adjustment: signed,
  tips: cents,
  type: z.enum(['Sale', 'Giveaway', 'Tip']),
  status: z.enum(['Completed', 'Cancelled', 'Returned']),
  fulfillment: z.enum(['Unfulfilled', 'Shipped', 'Delivered']),
  itemFulfillments: z.array(itemFulfillmentSchema).max(500).optional(),
  amountsConfirmed: z.boolean().optional(),
  payout: z.enum(['Pending', 'Paid']),
  provenance: text.default('Manual entry'),
  importKey: text.default(''),
});
export const financialKinds = [
  'Refund',
  'Fee adjustment',
  'Revenue adjustment',
  'Direct cost adjustment',
  'Return',
  'Reversal',
] as const;
export const financialEventSchema = z.object({
  id,
  orderId: id,
  date,
  kind: z.enum(financialKinds),
  amount: signed,
  reason: text.min(1),
  itemIds: z.array(id).max(500).default([]),
  externalId: text.default(''),
  reversesId: optionalId,
  category: z.enum(['Shipping', 'Packaging', 'Other']).default('Other'),
});
export const payoutSchema = z.object({
  id,
  marketplace: z.enum(marketplaces),
  date,
  reference: text.min(1),
  amount: cents.min(1),
  allocations: z
    .array(z.object({ orderId: id, amount: cents.min(1) }))
    .min(1)
    .max(500),
  notes: text.default(''),
  reversalOf: optionalId,
});
export const shipmentSchema = z.object({
  id,
  marketplace: z.enum(marketplaces),
  date,
  orderIds: z.array(id).min(1).max(500),
  carrier: text.default(''),
  tracking: text.default(''),
  status: z.enum(['Preparing', 'Shipped', 'Delivered']),
  labelCost: cents.default(0),
  notes: text.default(''),
  allocatedShipping: z.boolean().default(false),
});
export type FinancialEvent = z.infer<typeof financialEventSchema>;
export type Payout = z.infer<typeof payoutSchema>;
export type Shipment = z.infer<typeof shipmentSchema>;
export const expenseSchema = z.object({
  id,
  title: text.min(1),
  category: text,
  amount: cents,
  date,
  showId: optionalId,
  tripId: optionalId,
});
export const locationSchema = z.object({
  id,
  name: text.min(1),
  address: text.default(''),
  latitude: z.number().min(-90).max(90).nullable().default(null),
  longitude: z.number().min(-180).max(180).nullable().default(null),
});
export const tripSchema = z.object({
  id,
  locationId: optionalId,
  name: text.min(1),
  date,
  totalSpent: cents,
  notes: text.default(''),
});
export const showSchema = z.object({
  id,
  name: text.min(1),
  date,
  type: z.enum(['Whatnot', 'In person']),
  status: z.enum(['Planned', 'Live', 'Ended']),
  notes: text.default(''),
  externalId: text.default(''),
  checklist: z.array(z.object({ title: text, done: z.boolean() })).default([]),
  lineup: z.array(z.object({ itemId: id, startingBid: cents, presented: z.boolean() })).default([]),
  durationMinutes: z.number().int().min(0).max(1440).default(0),
});
export const segmentSchema = z.object({ start: date, end: date.nullable() });
export const sessionSchema = z.object({
  id,
  category: z.enum(categories),
  subcategory: text.default(''),
  notes: text.default(''),
  showId: optionalId,
  tripId: optionalId,
  locationId: optionalId,
  segments: z.array(segmentSchema).min(1),
  state: z.enum(['Running', 'Paused', 'Ended', 'Deleted']),
});
export const importSchema = z.object({
  id,
  filename: text.min(1),
  kind: z.enum(['Inventory', 'Sales', 'Listings', 'Expenses']),
  importedAt: date,
  rawCsv: z.string().max(3_000_000),
  mapping: z.record(z.string(), z.string()),
  recordIds: z.array(id).max(1000),
});
export const settingsSchema = z.object({
  pipelineVisible: z.boolean().default(true),
  estimatedSellingExpenses: cents.nullable().default(null),
  currency: z.literal('USD').default('USD'),
  timezone: z.string().max(100).default('America/New_York'),
  theme: z.enum(['light', 'dark']).default('light'),
  monthlyGoal: cents.default(150000),
  widgets: z
    .array(z.enum(['chart', 'shows', 'sales', 'activity']))
    .default(['chart', 'shows', 'sales', 'activity']),
});
export type ImportRecord = z.infer<typeof importSchema>;
export type Item = z.infer<typeof itemSchema>;
export type Listing = z.infer<typeof listingSchema>;
export type Order = z.infer<typeof orderSchema>;
export type Expense = z.infer<typeof expenseSchema>;
export type Location = z.infer<typeof locationSchema>;
export type Trip = z.infer<typeof tripSchema>;
export type Show = z.infer<typeof showSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export const workspaceSchema = z.object({
  revision: z.number().int().min(0),
  imports: z.array(importSchema).default([]),
  financialEvents: z.array(financialEventSchema).default([]),
  payouts: z.array(payoutSchema).default([]),
  shipments: z.array(shipmentSchema).default([]),
  items: z.array(itemSchema),
  listings: z.array(listingSchema),
  orders: z.array(orderSchema),
  expenses: z.array(expenseSchema),
  locations: z.array(locationSchema),
  trips: z.array(tripSchema),
  shows: z.array(showSchema),
  sessions: z.array(sessionSchema),
  settings: settingsSchema,
});
export type Workspace = z.infer<typeof workspaceSchema>;
export const emptyWorkspace = (): Workspace => ({
  revision: 0,
  imports: [],
  financialEvents: [],
  payouts: [],
  shipments: [],
  items: [],
  listings: [],
  orders: [],
  expenses: [],
  locations: [],
  trips: [],
  shows: [],
  sessions: [],
  settings: settingsSchema.parse({}),
});
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('item'), value: itemSchema }),
  z.object({ type: z.literal('financialEvent'), value: financialEventSchema }),
  z.object({ type: z.literal('payout'), value: payoutSchema }),
  z.object({ type: z.literal('shipment'), value: shipmentSchema }),
  z.object({ type: z.literal('listing'), value: listingSchema }),
  z.object({ type: z.literal('order'), value: orderSchema }),
  z.object({ type: z.literal('expense'), value: expenseSchema }),
  z.object({ type: z.literal('location'), value: locationSchema }),
  z.object({ type: z.literal('trip'), value: tripSchema }),
  z.object({ type: z.literal('show'), value: showSchema }),
  z.object({ type: z.literal('session'), value: sessionSchema }),
  z.object({ type: z.literal('settings'), value: settingsSchema }),
  z.object({ type: z.literal('import'), value: importSchema }),
]);
export type Command = z.infer<typeof commandSchema>;
