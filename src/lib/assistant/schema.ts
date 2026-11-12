import { z } from 'zod';
import { marketplaces } from '../model';
import {
  clothingSchema,
  identificationSchema,
  wireClothingSchema,
  wireIdentificationSchema,
} from './clothing';

const text = z.string().max(2000).nullable();
const amount = z.number().int().min(0).max(100_000_000).nullable();
export const extractedLineSchema = z.strictObject({
  title: text,
  brand: text,
  size: text,
  color: text,
  category: text,
  condition: text,
  description: text,
  sku: text,
  externalProductId: text,
  listingId: text,
  url: text,
  price: amount,
  purchaseCost: amount.optional(),
  clothing: clothingSchema.optional(),
});
export const lifecycleSchema = z.strictObject({
  type: z.enum([
    'active_listing',
    'completed_sale',
    'shipped',
    'delivered',
    'cancelled',
    'refunded',
    'returned',
    'ambiguous',
  ]),
  confidence: z.enum(['clear', 'uncertain']),
  evidence: z.array(z.string().max(500)).max(10),
  scope: z.enum(['order', 'items', 'package', 'unknown']),
  carrier: text,
  tracking: text,
  labelCost: amount,
  externalEventId: text,
  confirmedByUser: z.boolean().optional(),
});
/** Facts only. Null always means unknown, including monetary amounts. */
export const extractedRecordSchema = z.strictObject({
  kind: z.enum(['sale', 'listing', 'fulfillment', 'cancellation', 'refund', 'return', 'other']),
  marketplace: z.enum(marketplaces).nullable(),
  currency: z.string().max(10).nullable(),
  status: z.enum([
    'completed',
    'active',
    'offer',
    'pending',
    'refunded',
    'returned',
    'shipped',
    'delivered',
    'cancelled',
    'unknown',
  ]),
  date: text,
  externalOrderId: text,
  lines: z.array(extractedLineSchema).max(30),
  fees: amount,
  processing: amount,
  shipping: amount,
  shippingCollected: amount,
  discount: amount,
  refund: amount,
  other: amount,
  packaging: amount.optional(),
  showId: text.optional(),
  warnings: z.array(z.string().max(500)).max(20),
  marketplaceIdentification: identificationSchema.optional(),
  event: lifecycleSchema.optional(),
});
export const extractionSchema = z.strictObject({
  records: z.array(extractedRecordSchema).max(30),
  message: z.string().max(1000),
  identification: identificationSchema.optional(),
  notes: z.array(z.string().max(500)).max(60).optional(),
});
/** Strict model contract, with every field required; public schemas still restore legacy drafts. */
export const visionExtractionSchema = z.strictObject({
  identification: wireIdentificationSchema,
  records: z
    .array(
      extractedRecordSchema
        .omit({ marketplaceIdentification: true, packaging: true, showId: true })
        .extend({
          marketplace: z.enum(['Vinted', 'Depop', 'eBay', 'Whatnot']).nullable(),
          event: lifecycleSchema.omit({ confirmedByUser: true }),
          lines: z
            .array(
              extractedLineSchema.omit({ purchaseCost: true }).extend({
                description: z.string().max(300).nullable(),
                clothing: wireClothingSchema,
              }),
            )
            .max(30),
        }),
    )
    .max(30),
  message: z.string().max(1000),
});
/** Text/document facts use the same review model, without fabricated clothing/image metadata. */
export const documentExtractionSchema = z.strictObject({
  complete: z.boolean(),
  rowsAccountedFor: z.number().int().nonnegative().nullable(),
  records: z
    .array(
      extractedRecordSchema
        .omit({ marketplaceIdentification: true, event: true, packaging: true, showId: true })
        .extend({
          lines: z
            .array(extractedLineSchema.omit({ clothing: true }).extend({ purchaseCost: amount }))
            .max(30),
        }),
    )
    .max(30),
  message: z.string().max(1000),
});
export const processingSchema = z.object({
  model: z.string().max(100),
  detail: z.literal('high'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  views: z
    .array(
      z.object({
        label: z.string(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      }),
    )
    .max(5),
});
export type ExtractedRecord = z.infer<typeof extractedRecordSchema>;
export type ExtractedLine = z.infer<typeof extractedLineSchema>;
export type Extraction = z.infer<typeof extractionSchema>;
export const screenshotSchema = z.object({
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  name: z.string().max(200),
  reference: z.string().max(500).optional(),
  sourceType: z.enum(['image', 'pdf', 'csv']).optional(),
  originalHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  part: z.number().int().min(1).max(10).optional(),
  parts: z.number().int().min(1).max(10).optional(),
  analysisModel: z.string().max(100).optional(),
  extraction: extractionSchema,
  processing: processingSchema.optional(),
});
export type Screenshot = z.infer<typeof screenshotSchema>;
export const DEFAULT_BATCH_LIMIT = 10;
export const IMAGE_LIMIT = 5 * 1024 * 1024;
export const BATCH_BYTES_LIMIT = 16 * 1024 * 1024;

export const SOURCE_IMAGE_EDGE_LIMIT = 4096;
export const SOURCE_IMAGE_PIXEL_LIMIT = 16_777_216;
