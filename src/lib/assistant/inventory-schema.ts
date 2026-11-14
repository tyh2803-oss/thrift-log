import { z } from 'zod';
import { pipelineMoveSchema } from '../pipeline-moves';
const text = z.string().max(500);
export const inventoryPatchSchema = z.strictObject({
  sku: text.optional(),
  title: text.optional(),
  brand: text.optional(),
  category: text.optional(),
  size: text.optional(),
  color: text.optional(),
  condition: text.optional(),
  description: text.optional(),
  asking: z.number().int().min(0).max(100_000_000).optional(),
  purchasedAt: z.string().max(100).optional(),
  source: text.optional(),
  storage: text.optional(),
  notes: text.optional(),
});
export const inventoryChangeSchema = z.strictObject({
  invalidFields: z.array(z.string().max(100)).max(300).default([]),
  action: z.enum(['create', 'edit', 'cost', 'stage']),
  itemId: z.string().uuid(),
  patch: inventoryPatchSchema,
  purchaseCost: z.number().int().min(0).max(100_000_000).nullable(),
  costOperationId: z.string().uuid(),
  confirmCostCorrection: z.boolean().default(false),
  assumedAcquisitionDate: z.boolean().default(false),
  move: pipelineMoveSchema.nullable(),
});
export type InventoryChange = z.infer<typeof inventoryChangeSchema>;
