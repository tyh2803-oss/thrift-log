import { z } from 'zod';
import { extractedRecordSchema, screenshotSchema, type Screenshot } from './schema';
import { listingEvidenceIssue } from './vision';
import { matchInventory } from './matching';
import { itemIsSold } from '../ledger';
import { type Item, type Workspace } from '../model';
import { localDay } from '../dates';
const newItemSchema = z.object({
  id: z.string().uuid(),
  sku: z.string().max(500),
  cost: z.number().int().min(0).max(100_000_000).nullable(),
  purchasedAt: z.string().max(100),
  // Legacy sale drafts still use this confirmation; listing authorization is final approval.
  confirmedDistinct: z.boolean().default(false),
  assumedAcquisitionDate: z.boolean().optional(),
});
export const draftLineSchema = z.object({
  itemId: z.string().uuid().nullable(),
  newItem: newItemSchema.nullable(),
  confirmZeroCost: z.boolean(),
  costAllocation: z
    .object({
      mode: z.enum(['same', 'split', 'individual']),
      total: z.number().int().min(0).optional(),
      count: z.number().int().min(1).optional(),
    })
    .optional(),
  dismissedCandidateIds: z.array(z.string().uuid()).max(500).optional(),
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
  inventoryStage: z.enum(['unlisted', 'archived']).optional(),
  confirmStatusImpact: z.boolean().optional(),
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
/** A proposal has no business effect until its identity, cost and date are approved. */
export function newInventoryDraft(
  sku: string | null,
  cost: number | null = null,
  timezone?: string,
) {
  const id = crypto.randomUUID();
  return {
    id,
    sku: sku || `AI-${id}`,
    cost,
    purchasedAt: timezone ? localDay(new Date(), timezone) : '',
    assumedAcquisitionDate: timezone ? true : undefined,
    confirmedDistinct: false,
  };
}
export function createBatch(
  screenshots: Screenshot[],
  w: Workspace,
  context?: ListingContext,
  marketplaceContext?: DraftBatch['marketplaceContext'],
): DraftBatch {
  const unique = screenshots.filter(
    (s, i) => screenshots.findIndex((v) => v.hash === s.hash) === i,
  );
  const claimedSaleIds = new Set<string>();
  const single = unique.reduce((n, s) => n + s.extraction.records.length, 0) === 1;
  return {
    context,
    marketplaceContext,
    id: crypto.randomUUID(),
    revision: w.revision,
    screenshots: unique,
    rows: screenshots.flatMap((s) =>
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
            const exact = candidates.filter(
              (c) =>
                c.exact &&
                !claimedSaleIds.has(c.item.id) &&
                !itemIsSold(w, c.item.id) &&
                (record.kind !== 'sale' ||
                  !record.date ||
                  Date.parse(c.item.purchasedAt) <= Date.parse(record.date)),
            );
            if (record.kind === 'sale' && exact.length === 1) claimedSaleIds.add(exact[0].item.id);
            const proposal =
              !exact.length &&
              ((record.kind === 'listing' && record.status === 'active') || record.kind === 'sale')
                ? newInventoryDraft(
                    w.items.some((item) => item.sku.toLowerCase() === line.sku?.toLowerCase())
                      ? null
                      : line.sku,
                    line.purchaseCost ?? null,
                    record.kind === 'listing' ? w.settings.timezone : undefined,
                  )
                : null;
            if (proposal && record.kind === 'sale') {
              proposal.purchasedAt = record.date || '';
              proposal.assumedAcquisitionDate = true;
            }
            return {
              itemId: exact.length === 1 ? exact[0].item.id : null,
              newItem: proposal,
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
export function sanitizeBatch(input: DraftBatch, timezone = 'UTC'): DraftBatch {
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
  // Restore older pending listing reviews without discarding any user edits.
  if (!batch.context)
    for (const row of batch.rows)
      if (row.facts.kind === 'listing' && row.facts.status === 'active')
        row.matches.forEach((match, i) => {
          if (!match.itemId && !match.newItem && row.facts.lines[i])
            match.newItem = newInventoryDraft(
              row.facts.lines[i].sku,
              match.purchaseCost ?? null,
              timezone,
            );
          if (match.newItem && !match.newItem.purchasedAt) {
            match.newItem.purchasedAt = localDay(new Date(), timezone);
            match.newItem.assumedAcquisitionDate = true;
          }
        });
  return batch;
}
