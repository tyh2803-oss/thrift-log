import { z } from 'zod';
import { marketplaces } from '../model';

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
});
/** Facts only. Null always means unknown, including monetary amounts. */
export const extractedRecordSchema = z.strictObject({
  kind: z.enum(['sale', 'listing', 'other']),
  marketplace: z.enum(marketplaces).nullable(),
  currency: z.string().max(10).nullable(),
  status: z.enum(['completed', 'active', 'offer', 'pending', 'refunded', 'unknown']),
  date: text,
  externalOrderId: text,
  lines: z.array(extractedLineSchema).min(1).max(30),
  fees: amount,
  processing: amount,
  shipping: amount,
  shippingCollected: amount,
  discount: amount,
  refund: amount,
  other: amount,
  warnings: z.array(z.string().max(500)).max(20),
});
export const extractionSchema = z.strictObject({
  records: z.array(extractedRecordSchema).max(30),
  message: z.string().max(1000),
});
export type ExtractedRecord = z.infer<typeof extractedRecordSchema>;
export type ExtractedLine = z.infer<typeof extractedLineSchema>;
export type Extraction = z.infer<typeof extractionSchema>;
export const screenshotSchema = z.object({
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  name: z.string().max(200),
  reference: z.string().max(500).optional(),
  extraction: extractionSchema,
});
export type Screenshot = z.infer<typeof screenshotSchema>;
export const DEFAULT_BATCH_LIMIT = 10;
export const IMAGE_LIMIT = 5 * 1024 * 1024;
export const BATCH_BYTES_LIMIT = 16 * 1024 * 1024;
