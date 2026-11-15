import { z } from 'zod';
const text = z.string().max(500);
export const externalId = z.string().min(1).max(200);
const date = z.iso.datetime({ offset: true });
export const amountSchema = z.object({
  value: z.string().regex(/^-?\d+(?:\.\d{1,2})?$/),
  currency: z.string().length(3),
});
export const identitySchema = z.object({
  userId: externalId,
  username: text.min(1),
  status: text.optional(),
});
export const lineSchema = z.object({
  lineItemId: externalId,
  legacyItemId: externalId.optional(),
  sku: text.optional(),
  title: text.min(1),
  quantity: z.number().int().min(1).max(500),
  lineItemCost: amountSchema,
  taxes: z
    .array(z.object({ amount: amountSchema.optional(), taxType: text.optional() }))
    .max(50)
    .default([]),
  ebayCollectAndRemitTaxes: z
    .array(z.object({ amount: amountSchema, taxType: text.optional() }))
    .max(50)
    .default([]),
  lineItemFulfillmentStatus: text.optional(),
});
export const orderSourceSchema = z.object({
  orderId: externalId,
  sellerId: text.optional(),
  creationDate: date,
  lastModifiedDate: date,
  orderPaymentStatus: text,
  orderFulfillmentStatus: text,
  cancelStatus: z.object({ cancelState: text }).optional(),
  lineItems: z.array(lineSchema).min(1).max(500),
  pricingSummary: z.object({
    priceSubtotal: amountSchema,
    total: amountSchema,
    priceDiscount: amountSchema.optional(),
    deliveryCost: amountSchema.optional(),
    deliveryDiscount: amountSchema.optional(),
    adjustment: amountSchema.optional(),
    fee: amountSchema.optional(),
    tax: amountSchema.optional(),
  }),
  paymentSummary: z.object({
    payments: z
      .array(
        z.object({
          paymentDate: date.optional(),
          paymentStatus: text,
          amount: amountSchema.optional(),
        }),
      )
      .max(100)
      .default([]),
    refunds: z
      .array(
        z.object({
          refundId: externalId.optional(),
          refundReferenceId: externalId.optional(),
          refundStatus: text,
          refundDate: date.optional(),
          amount: amountSchema.optional(),
        }),
      )
      .max(200)
      .default([]),
  }),
  totalMarketplaceFee: amountSchema.optional(),
});
export const shipmentSourceSchema = z.object({
  fulfillmentId: externalId,
  shippedDate: date.optional(),
  shipmentTrackingNumber: text.optional(),
  shippingCarrierCode: text.optional(),
  lineItems: z
    .array(z.object({ lineItemId: externalId, quantity: z.number().int().min(1).max(500) }))
    .max(500),
});
export const transactionSourceSchema = z.object({
  transactionId: externalId,
  transactionType: text.min(1),
  transactionDate: date,
  bookingEntry: z.enum(['CREDIT', 'DEBIT']),
  amount: amountSchema,
  orderId: externalId.optional(),
  payoutId: externalId.optional(),
  transactionStatus: text.optional(),
  totalFeeAmount: amountSchema.optional(),
  eBayCollectedTaxAmount: amountSchema.optional(),
  feeType: text.optional(),
});
export const payoutSourceSchema = z.object({
  payoutId: externalId,
  payoutDate: date.optional(),
  payoutStatus: text,
  amount: amountSchema,
  totalFee: amountSchema.optional(),
  transactionCount: z.number().int().min(0).optional(),
});
export type OrderSource = z.infer<typeof orderSourceSchema>;
export type ShipmentSource = z.infer<typeof shipmentSourceSchema>;
export type TransactionSource = z.infer<typeof transactionSourceSchema>;
export type PayoutSource = z.infer<typeof payoutSourceSchema>;
export const resolutionSchema = z.strictObject({
  units: z
    .record(
      z.string().max(220),
      z.object({
        itemId: z.union([z.string().uuid(), z.literal('new')]),
        cost: z.number().int().min(0).max(100_000_000).nullable().optional(),
      }),
    )
    .optional(),
  refund: z
    .object({
      amount: z.number().int().positive().max(100_000_000),
      feeCredit: z.number().int().min(0).max(100_000_000),
    })
    .optional(),
  allocations: z
    .array(
      z.object({
        orderId: z.string().uuid(),
        amount: z.number().int().positive().max(100_000_000),
      }),
    )
    .min(1)
    .max(500)
    .optional(),
});
export type Resolution = z.infer<typeof resolutionSchema>;
export type RecordKind = 'order' | 'transaction' | 'payout';
export type StoredRecord = {
  kind: RecordKind;
  external_id: string;
  payload: unknown;
  hash: string;
  state: 'applied' | 'review' | 'ignored' | 'pending';
  issue: string;
  local_id: string | null;
  resolution?: Resolution;
};
export type Checkpoint = {
  phase: 'orders' | 'transactions' | 'payouts' | 'done';
  from: string;
  to: string;
  end: string;
  offset: number;
  incremental: boolean;
};
export type ConnectionStatus = {
  ready: boolean;
  configured?: boolean;
  connected: boolean;
  username?: string;
  status?: string;
  environment?: string;
  financials?: boolean;
  financial_error?: string | null;
  last_sync?: string | null;
  last_financial_sync?: string | null;
  last_attempt?: string | null;
  error?: string | null;
  pending?: number;
  progress?: string;
  hasMore?: boolean;
  setup?: string;
};
