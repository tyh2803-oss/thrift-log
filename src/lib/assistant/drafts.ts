import { z } from 'zod';
import { extractedRecordSchema, screenshotSchema, type Screenshot } from './schema';
import { listingEvidenceIssue } from './vision';
import { matchInventory } from './matching';
import { type Item, type Workspace } from '../model';
const newItemSchema = z.object({
  id: z.string().uuid(),
  sku: z.string().max(500),
  cost: z.number().int().min(0).max(100_000_000).nullable(),
  purchasedAt: z.string().max(100),
  confirmedDistinct: z.boolean().default(false),
});
export const draftLineSchema = z.object({
  itemId: z.string().uuid().nullable(),
  newItem: newItemSchema.nullable(),
  confirmZeroCost: z.boolean(),
  purchaseCost: z.number().int().min(0).max(100_000_000).nullable().optional(),
  costInput: z.string().max(100).optional(),
  priceInput: z.string().max(100).optional(),
  costCorrection: z.boolean().optional(),
  notes: z.string().max(500).optional(),
  costOverride: z.number().int().min(0).max(100_000_000).nullable().optional(),
});
export const draftRowSchema = z.object({
  id: z.string().uuid(),
  sourceHash: z.union([z.string().regex(/^[a-f0-9]{64}$/), z.literal('conversation')]),
  intent: z.string().max(500).optional(),
  recordIndex: z.number().int().min(0),
  included: z.boolean(),
  facts: extractedRecordSchema,
  matches: z.array(draftLineSchema).max(30),
  acknowledgedWarnings: z.boolean(),
  orderId: z.string().uuid().nullable().optional(),
  targetItemIds: z.array(z.string().uuid()).max(500).optional(),
  confirmPackage: z.boolean().optional(),
  confirmPhysicalReturn: z.boolean().optional(),
  applyRefund: z.boolean().optional(),
});
export const listingContextSchema = z.object({ itemId: z.string().uuid() });
export type ListingContext = z.infer<typeof listingContextSchema>;
export const batchSchema = z.object({
  context: listingContextSchema.optional(),
  marketplaceContext: z.enum(['Vinted', 'Depop', 'eBay', 'Whatnot']).optional(),
  id: z.string().uuid(),
  revision: z.number().int().min(0),
  screenshots: z.array(screenshotSchema).max(10),
  rows: z.array(draftRowSchema).max(300),
});
export type DraftRow = z.infer<typeof draftRowSchema>;
export type DraftBatch = z.infer<typeof batchSchema>;
export function createBatch(
  screenshots: Screenshot[],
  w: Workspace,
  context?: ListingContext,
  marketplaceContext?: DraftBatch['marketplaceContext'],
): DraftBatch {
  const unique = screenshots.filter(
    (s, i) => screenshots.findIndex((v) => v.hash === s.hash) === i,
  );
  const single = unique.reduce((n, s) => n + s.extraction.records.length, 0) === 1;
  return {
    context,
    marketplaceContext,
    id: crypto.randomUUID(),
    revision: w.revision,
    screenshots: unique,
    rows: unique.flatMap((s) =>
      s.extraction.records
        .map((record, recordIndex) => ({
          id: crypto.randomUUID(),
          sourceHash: s.hash,
          recordIndex,
          included: record.kind !== 'other' && (!context || single),
          facts: structuredClone(record),
          acknowledgedWarnings: false,
          matches: record.lines.map((line) => {
            if (context)
              return {
                itemId:
                  single && record.kind === 'listing' && record.lines.length === 1
                    ? context.itemId
                    : null,
                newItem: null,
                confirmZeroCost: false,
              };
            const candidates = matchInventory(w, record, line);
            const exact = candidates.filter((c) => c.exact);
            return {
              itemId: exact.length === 1 ? exact[0].item.id : null,
              newItem: null,
              confirmZeroCost: false,
            };
          }),
        }))
        .filter(
          (row) =>
            row.facts.kind !== 'listing' ||
            row.facts.lines.every((line) => !listingEvidenceIssue(line)),
        ),
    ),
  };
}
export function matchedItem(w: Workspace, row: DraftRow, lineIndex: number): Item | undefined {
  return w.items.find((i) => i.id === row.matches[lineIndex]?.itemId);
}

export function removeDraft(batch: DraftBatch, id: string): DraftBatch {
  return { ...batch, rows: batch.rows.filter((row) => row.id !== id) };
}
/** Upgrade older tab drafts without losing valid edits or original source indices. */
export function sanitizeBatch(input: DraftBatch): DraftBatch {
  const batch = structuredClone(input);
  batch.rows = batch.rows.flatMap((row) => {
    if (row.facts.kind !== 'listing') return [row];
    const valid = row.facts.lines.map((line, index) => ({
      index,
      reason: listingEvidenceIssue(line),
    }));
    const omitted = valid.filter((v) => v.reason);
    if (!omitted.length) return [row];
    const source = batch.screenshots.find((s) => s.hash === row.sourceHash);
    if (source)
      source.extraction.notes = [
        ...new Set([...(source.extraction.notes || []), ...omitted.map((v) => v.reason!)]),
      ].slice(0, 60);
    const keep = valid.filter((v) => !v.reason).map((v) => v.index);
    return keep.length
      ? [
          {
            ...row,
            facts: { ...row.facts, lines: keep.map((i) => row.facts.lines[i]) },
            matches: keep.map((i) => row.matches[i]),
          },
        ]
      : [];
  });
  return batch;
}
