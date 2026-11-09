import { z } from 'zod';
import { extractedRecordSchema, screenshotSchema, type Screenshot } from './schema';
import { matchInventory } from './matching';
import { type Item, type Workspace } from '../model';
const newItemSchema = z.object({
  id: z.string().uuid(),
  sku: z.string().max(500),
  cost: z.number().int().min(0).max(100_000_000).nullable(),
  purchasedAt: z.string().max(100),
});
export const draftLineSchema = z.object({
  itemId: z.string().uuid().nullable(),
  newItem: newItemSchema.nullable(),
  confirmZeroCost: z.boolean(),
});
export const draftRowSchema = z.object({
  id: z.string().uuid(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  recordIndex: z.number().int().min(0),
  included: z.boolean(),
  facts: extractedRecordSchema,
  matches: z.array(draftLineSchema).min(1).max(30),
  acknowledgedWarnings: z.boolean(),
});
export const batchSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().min(0),
  screenshots: z.array(screenshotSchema).max(10),
  rows: z.array(draftRowSchema).max(300),
});
export type DraftRow = z.infer<typeof draftRowSchema>;
export type DraftBatch = z.infer<typeof batchSchema>;
export function createBatch(screenshots: Screenshot[], w: Workspace): DraftBatch {
  const unique = screenshots.filter(
    (s, i) => screenshots.findIndex((v) => v.hash === s.hash) === i,
  );
  return {
    id: crypto.randomUUID(),
    revision: w.revision,
    screenshots: unique,
    rows: unique.flatMap((s) =>
      s.extraction.records.map((record, recordIndex) => ({
        id: crypto.randomUUID(),
        sourceHash: s.hash,
        recordIndex,
        included: record.kind !== 'other',
        facts: structuredClone(record),
        acknowledgedWarnings: false,
        matches: record.lines.map((line) => {
          const candidates = matchInventory(w, record, line);
          const exact = candidates.filter((c) => c.exact);
          return {
            itemId: exact.length === 1 ? exact[0].item.id : null,
            newItem: null,
            confirmZeroCost: false,
          };
        }),
      })),
    ),
  };
}
export function matchedItem(w: Workspace, row: DraftRow, lineIndex: number): Item | undefined {
  return w.items.find((i) => i.id === row.matches[lineIndex]?.itemId);
}
