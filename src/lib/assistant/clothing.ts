import { z } from 'zod';
export const vintageClassifications = [
  'Vintage confirmed',
  'Potentially vintage',
  'Vintage-inspired or retro style',
  'No clear vintage indicators',
  'Insufficient evidence',
] as const;
export const evidenceFields = [
  'title',
  'brand',
  'category',
  'garmentType',
  'color',
  'size',
  'condition',
  'price',
  'design',
  'material',
  'fit',
  'style',
  'vintage',
] as const;
export const evidenceSources = [
  'visible_text',
  'appearance',
  'uncertain',
  'unknown',
  'user_confirmed',
] as const;
const observation = z.string().max(500).nullable();
export const regionSchema = z.strictObject({
  left: z.number().int().min(0).max(1000),
  top: z.number().int().min(0).max(1000),
  right: z.number().int().min(0).max(1000),
  bottom: z.number().int().min(0).max(1000),
});
export const identificationSchema = z.strictObject({
  detected: z.enum(['Vinted', 'Depop', 'eBay', 'Whatnot']).nullable(),
  confidence: z.enum(['clear', 'uncertain', 'unrecognized']),
  evidence: z.array(z.string().max(300)).max(8),
  confirmedByUser: z.boolean().optional(),
});
export const vintageSchema = z.strictObject({
  classification: z.enum(vintageClassifications),
  evidence: z.array(z.string().max(300)).max(8),
  ageEvidence: observation,
  followUp: observation,
  confirmedByUser: z.boolean().optional(),
});
export const clothingSchema = z.strictObject({
  originalTitle: observation,
  visibleText: z.string().max(2000).nullable(),
  garmentType: observation,
  design: observation,
  material: observation,
  fit: observation,
  style: observation,
  vintage: vintageSchema,
  evidence: z
    .array(
      z.strictObject({
        field: z.enum(evidenceFields),
        source: z.enum(evidenceSources),
        note: z.string().max(300),
      }),
    )
    .max(30),
  region: regionSchema.nullable(),
  partial: z.boolean(),
});
export type Clothing = z.infer<typeof clothingSchema>;
export type MarketplaceIdentification = z.infer<typeof identificationSchema>;
export const wireIdentificationSchema = identificationSchema.omit({ confirmedByUser: true });
export const wireClothingSchema = clothingSchema.extend({
  vintage: vintageSchema.omit({ confirmedByUser: true }),
  evidence: z
    .array(
      z.strictObject({
        field: z.enum(evidenceFields),
        source: z.enum(['visible_text', 'appearance', 'uncertain', 'unknown']),
        note: z.string().max(300),
      }),
    )
    .max(30),
});
/** Compact inventory text; the full structured facts remain lossless in import provenance. */
export function clothingDescription(description: string | null, clothing?: Clothing) {
  if (!clothing) return description || '';
  const vintage = clothing.vintage;
  const age =
    vintage.classification === 'Vintage confirmed' &&
    vintage.confirmedByUser &&
    !!vintage.ageEvidence?.trim()
      ? `Vintage confirmed by owner${vintage.ageEvidence ? ': ' + vintage.ageEvidence : ''}`
      : `${vintage.classification === 'Vintage confirmed' ? 'Potentially vintage' : vintage.classification}; age unverified`;
  const parts = [
    age,
    description,
    clothing.design,
    clothing.material && `Material (visual): ${clothing.material}`,
    clothing.fit && `Fit (visual): ${clothing.fit}`,
    clothing.style,
  ];
  return parts.filter(Boolean).join('\n').slice(0, 500);
}
