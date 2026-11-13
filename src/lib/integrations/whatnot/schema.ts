import { z } from 'zod';
export const WHATNOT_DOCS = 'https://developers.whatnot.com/';
export const WHATNOT_BASE = 'https://api.whatnot.com/seller-api/rest/v2';
export const WHATNOT_SCOPES = [
  'read:orders',
  'read:shipments',
  'read:shows',
  'read:reports',
] as const;
const id = z.string().regex(/^[1-9][0-9]{0,18}$/);
const date = z.iso.datetime({ offset: true });
const text = z.string().max(500);
export const moneySchema = z.object({
  amount: z.string().regex(/^-?\d+(?:\.\d{1,2})?$/),
  currency: z.string().length(3),
});
export const sellerSchema = z.object({ id, username: text, seller_currency: z.string().length(3) });
export const sourceOrderSchema = z.object({
  id,
  status: z.enum(['pending', 'pending_fulfillment', 'completed', 'cancelled', 'failed']),
  show_id: z.string().uuid().nullable(),
  transaction_type: z.enum(['buy_it_now', 'auction', 'giveaway', 'other']).nullable(),
  amounts: z.object({
    subtotal: moneySchema,
    shipping: moneySchema,
    tax: moneySchema,
    total: moneySchema,
    applied_discount: z
      .object({ type: z.enum(['fixed_price', 'percentage']), amount: moneySchema })
      .nullable(),
  }),
  created_at: date.nullable(),
  updated_at: date.nullable(),
  cancelled_at: date.nullable(),
});
export const sourceItemSchema = z.object({
  id,
  order_id: id,
  product_id: id.nullable(),
  variant_id: z.string().max(200).nullable(),
  product_external_id: text.nullable(),
  variant_external_id: text.nullable(),
  purchased_item: z
    .object({
      title: z.string().min(1).max(500),
      description: z.string().max(10000).nullable(),
      sku: text.nullable(),
    })
    .nullable(),
  quantity: z.number().int().min(1).max(500),
  unit_price: moneySchema,
  price_includes_tax: z.boolean().nullable(),
  shipment_id: id.nullable(),
});
export const sourceShipmentSchema = z.object({
  id,
  status: z.enum([
    'created',
    'label_generated',
    'dropped_off',
    'in_transit',
    'delivered',
    'failed',
    'cancelled',
    'cancelled_not_shipped',
    'cancelled_not_shipped_with_dropoff',
    'cancelled_tracking_stuck',
  ]),
  fulfillment_method: z.enum(['shipping', 'pickup']),
  created_at: date.nullable(),
  updated_at: date.nullable(),
  tracking: z.object({ carrier: text, service: text, tracking_code: text }).nullable(),
  seller_paid_shipping_cost: moneySchema.nullable(),
  replacement_shipment_id: id.nullable(),
});
export const sourceShowSchema = z.object({
  id: z.string().uuid(),
  title: text.min(1),
  status: z.enum(['scheduled', 'live', 'stopped', 'ended', 'cancelled']),
  scheduled_start_at: date.nullable(),
  ended_at: date.nullable(),
  created_at: date,
  updated_at: date,
});
export const analyticsSchema = z.object({
  show_id: z.string().uuid(),
  title: text,
  start_time: date,
  calculation_status: z
    .enum(['WILL_NOT_BE_CALCULATED', 'NOT_ENDED', 'PENDING', 'GENERATED'])
    .nullable(),
  sales: moneySchema.nullable(),
  estimated_earnings: moneySchema.nullable(),
  orders_count: z.number().int().nullable(),
  stream_minutes: z.number().int().nullable(),
  distinct_viewers_count: z.number().int().nullable(),
  max_concurrent_viewers: z.number().int().nullable(),
});
export const sourceReportSchema = z.object({
  id: z.string().uuid(),
  report_type: z.string().max(100),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled']),
  report_url: z.string().max(10000).nullable(),
  created_at: date,
  updated_at: date,
});
export const pageSchema = <T extends z.ZodType>(schema: T) =>
  z.object({ data: z.array(schema).max(50), next_cursor: z.string().max(2048).nullable() });
export type SourceOrder = z.infer<typeof sourceOrderSchema>;
export type SourceItem = z.infer<typeof sourceItemSchema>;
export type SourceShipment = z.infer<typeof sourceShipmentSchema>;
export type SourceShow = z.infer<typeof sourceShowSchema>;
export type ShowAnalytics = z.infer<typeof analyticsSchema>;
export const resolutionSchema = z.object({
  units: z
    .record(
      z.string().max(100),
      z.object({
        itemId: z.union([z.string().uuid(), z.literal('new')]),
        cost: z.number().int().min(0).max(100_000_000).nullable().optional(),
      }),
    )
    .optional(),
  earnings: z
    .object({
      fees: z.number().int().min(0).max(100_000_000),
      processing: z.number().int().min(0).max(100_000_000),
      shipping: z.number().int().min(0).max(100_000_000),
    })
    .optional(),
  refund: z
    .object({
      amount: z.number().int().min(0).max(100_000_000),
      feeCredit: z.number().int().min(0).max(100_000_000),
      shippingAdjustment: z.number().int().min(-100_000_000).max(100_000_000),
    })
    .optional(),
});
export type Resolution = z.infer<typeof resolutionSchema>;
export type RecordKind = 'order' | 'show' | 'analytics' | 'transaction' | 'shipment' | 'report';
export type StoredRecord = {
  kind: RecordKind;
  external_id: string;
  payload: unknown;
  hash: string;
  state: 'pending' | 'applied' | 'review' | 'ignored';
  issue: string;
  local_id: string | null;
  resolution?: Resolution;
};
export type SyncCursor = {
  phase: 'reports' | 'shows' | 'orders' | 'transactions' | 'done';
  cursor?: string | null;
  reports?: string[];
  orders?: string[];
  offset?: number;
  showStatus?: number;
};
export type ConnectionStatus = {
  ready: boolean;
  connected: boolean;
  username?: string;
  status?: string;
  last_sync?: string | null;
  last_attempt?: string | null;
  error?: string | null;
  pending?: number;
  progress?: string;
  webhook_id?: string;
  has_webhook?: boolean;
  hasMore?: boolean;
  setup?: string;
};
export type OrderSource = { order: SourceOrder; items: SourceItem[]; shipments: SourceShipment[] };
