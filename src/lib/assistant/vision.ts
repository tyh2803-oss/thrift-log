import {
  extractionSchema,
  type Extraction,
  type ExtractedRecord,
  type ExtractedLine,
} from './schema';
import type { MarketplaceIdentification } from './clothing';
/** Separate listing cards; never split an order or duplicate its shared charges. */
export function normalizeVision(input: Extraction): Extraction {
  const result = structuredClone(input);
  const identification = result.identification;
  const rows: ExtractedRecord[] = [];
  for (const record of result.records) {
    if (identification) {
      const clear =
        identification.confidence === 'clear' &&
        !!identification.detected &&
        identification.evidence.length > 0;
      record.marketplaceIdentification = { ...identification, confirmedByUser: false };
      if (!clear || (record.marketplace && record.marketplace !== identification.detected))
        record.marketplace = null;
      else record.marketplace = identification.detected;
    }
    for (const line of record.lines) {
      if (line.clothing) {
        const vintage = line.clothing.vintage;
        vintage.confirmedByUser = false;
        if (vintage.classification === 'Vintage confirmed')
          vintage.classification = 'Potentially vintage';
        const box = line.clothing.region;
        if (box && (box.right <= box.left || box.bottom <= box.top)) line.clothing.region = null;
        if (
          record.kind !== 'listing' &&
          record.warnings.length < 20 &&
          line.clothing.partial &&
          !record.warnings.includes(
            'A product card is partly visible; confirm its details before importing.',
          )
        )
          record.warnings.push(
            'A product card is partly visible; confirm its details before importing.',
          );
      }
    }
    if (record.event) {
      record.event.confirmedByUser = false;
      if (!record.event.evidence.length) record.event.confidence = 'uncertain';
      const type = record.event.type;
      record.kind =
        type === 'active_listing'
          ? 'listing'
          : type === 'completed_sale'
            ? 'sale'
            : ['shipped', 'delivered'].includes(type)
              ? 'fulfillment'
              : type === 'cancelled'
                ? 'cancellation'
                : type === 'refunded'
                  ? 'refund'
                  : type === 'returned'
                    ? 'return'
                    : 'other';
      if (['shipped', 'delivered', 'cancelled', 'refunded', 'returned'].includes(type))
        record.status = type as typeof record.status;
    }
    if (record.kind === 'sale' && record.status !== 'completed' && record.event) {
      record.kind = 'other';
      record.event.type = 'ambiguous';
      record.event.confidence = 'uncertain';
    }
    if (record.kind === 'listing') {
      for (const line of record.lines) {
        const reason = listingEvidenceIssue(line);
        if (reason) {
          (result.notes ||= []).push(reason);
          continue;
        }
        const duplicate = rows.some(
          (r) =>
            r.kind === 'listing' &&
            r.marketplace === record.marketplace &&
            sameProductView(r.lines[0], line),
        );
        if (duplicate) {
          (result.notes ||= []).push('Repeated view of one listing was ignored.');
          continue;
        }
        rows.push({
          ...record,
          lines: [line],
          warnings: record.warnings.filter(
            (v) => !v.startsWith('A product card is partly visible'),
          ),
        });
      }
    } else {
      if (['fulfillment', 'refund', 'return', 'cancellation', 'other'].includes(record.kind)) {
        const before = record.lines.length;
        record.lines = record.lines.filter((line) => !isEmptyProductLine(line));
        if (record.lines.length < before)
          (result.notes ||= []).push(
            'Empty product placeholders in an order event were ignored; no additional physical items were identified.',
          );
      }
      rows.push(record);
    }
  }
  if (rows.length > 30)
    throw new Error('Too many product cards. Split this screenshot into smaller sections.');
  result.records = rows;
  if (result.notes) result.notes = [...new Set(result.notes)].slice(0, 60);
  if (result.notes?.length)
    result.message = `${rows.length} supported record${rows.length === 1 ? '' : 's'} prepared. Incomplete, empty or repeated product regions were left out of actionable drafts.`;
  return extractionSchema.parse(result);
}
export function requireMarketplaceReview(record: ExtractedRecord) {
  const id = record.marketplaceIdentification;
  return (
    !!id &&
    !id.confirmedByUser &&
    (id.confidence !== 'clear' || !id.detected || record.marketplace !== id.detected)
  );
}
export function correctedMarketplace(
  identification: MarketplaceIdentification | undefined,
  marketplace: ExtractedRecord['marketplace'],
): MarketplaceIdentification {
  return {
    detected: identification?.detected || (marketplace === 'In person' ? null : marketplace),
    confidence: identification?.confidence || 'uncertain',
    evidence: identification?.evidence || [],
    confirmedByUser: !!marketplace,
  };
}
export function emptyClothing(): NonNullable<ExtractedLine['clothing']> {
  return {
    originalTitle: null,
    visibleText: null,
    garmentType: null,
    design: null,
    material: null,
    fit: null,
    style: null,
    region: null,
    partial: false,
    vintage: {
      classification: 'Insufficient evidence',
      evidence: [],
      ageEvidence: null,
      followUp: 'Upload a clear neck tag and care label to assess age.',
      confirmedByUser: false,
    },
    evidence: [],
  };
}

/** One explicit platform is context only; mixed-platform requests never set a batch-wide default. */
export function marketplaceContextFromText(text: string) {
  const names = (['Vinted', 'Depop', 'eBay', 'Whatnot'] as const).filter((name) =>
    new RegExp(String.raw`\b${name}\b`, 'i').test(text),
  );
  return names.length === 1 ? names[0] : undefined;
}

/** A cropped edge or empty/generic card is information, never a new physical item. */
export function listingEvidenceIssue(line: ExtractedLine): string | null {
  if (line.clothing?.partial)
    return 'A partially visible product region was left out of the import. Upload its complete card to include it.';
  const title = (line.title || '').trim();
  if (
    !title ||
    /^(untitled(?: (?:item|product|listing))?|unknown(?: (?:item|product|listing))?|unidentified(?: (?:item|product|listing))?|item|product|listing|n\/?a)(?:\s*\d+)?$/i.test(
      title,
    )
  )
    return 'An unidentified product region was ignored; it does not establish a distinct item.';
  const identified =
    line.listingId ||
    line.url ||
    line.sku ||
    line.brand ||
    line.clothing?.garmentType ||
    line.category ||
    line.price !== null;
  return identified
    ? null
    : 'An unsupported product region was ignored; a title alone is not enough evidence.';
}
function sameProductView(a: ExtractedLine, b: ExtractedLine) {
  if (
    (a.listingId && a.listingId === b.listingId) ||
    (a.url && a.url === b.url) ||
    (a.sku && a.sku === b.sku)
  )
    return true;
  const x = a.clothing?.region,
    y = b.clothing?.region;
  if (!x || !y) return false;
  const area =
    Math.max(0, Math.min(x.right, y.right) - Math.max(x.left, y.left)) *
    Math.max(0, Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top));
  const min = Math.min(
    (x.right - x.left) * (x.bottom - x.top),
    (y.right - y.left) * (y.bottom - y.top),
  );
  return (
    min > 0 &&
    area / min > 0.8 &&
    a.title?.toLowerCase() === b.title?.toLowerCase() &&
    a.price === b.price
  );
}

export function isEmptyProductLine(line: ExtractedLine) {
  const title = (line.title || '').trim();
  const meaningful =
    title &&
    !/^(untitled(?: (?:item|product|listing))?|unknown(?: (?:item|product|listing))?|unidentified(?: (?:item|product|listing))?|item|product|listing|n\/?a)(?:\s*\d+)?$/i.test(
      title,
    );
  return (
    !meaningful &&
    !line.brand &&
    !line.sku &&
    !line.listingId &&
    !line.externalProductId &&
    !line.url &&
    !line.clothing?.garmentType &&
    !line.clothing?.design
  );
}
