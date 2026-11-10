import type { ExtractedLine, ExtractedRecord } from './schema';
import type { Item, Workspace } from '../model';

const normalize = (v: string | null) =>
  (v || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const urlKey = (v: string | null) => {
  try {
    const u = new URL(v || '');
    return `${u.hostname.toLowerCase()}${u.pathname.replace(/\/$/, '')}`;
  } catch {
    return '';
  }
};
export type Candidate = { item: Item; score: number; reason: string; exact: boolean };
/** Exact identifiers take precedence. Approximate candidates are never auto-selected. */
export function matchInventory(
  w: Workspace,
  record: ExtractedRecord,
  line: ExtractedLine,
): Candidate[] {
  const listingIds = [line.listingId, line.externalProductId].filter(Boolean);
  const listingMatches = w.listings.filter(
    (l) =>
      l.marketplace === record.marketplace &&
      ((l.externalId && listingIds.includes(l.externalId)) ||
        (line.url && l.url && urlKey(line.url) === urlKey(l.url))),
  );
  const exactIds = new Set(listingMatches.map((l) => l.itemId));
  if (exactIds.size)
    return w.items
      .filter((i) => exactIds.has(i.id))
      .map((item) => ({ item, score: 100, reason: 'Exact marketplace listing', exact: true }));
  const skuMatches = line.sku
    ? w.items.filter((i) => i.sku.trim().toLowerCase() === line.sku!.trim().toLowerCase())
    : [];
  if (skuMatches.length)
    return skuMatches.map((item) => ({ item, score: 95, reason: 'Exact SKU', exact: true }));
  const tokens = (s: string | null) =>
    new Set(
      normalize(s)
        .split(' ')
        .filter((v) => v.length > 1 && !['vintage', 'the', 'and'].includes(v)),
    );
  const a = tokens(line.title);
  return w.items
    .map((item): Candidate => {
      const b = tokens(item.title);
      const overlap = [...a].filter((v) => b.has(v)).length;
      const similarity = a.size && b.size ? overlap / Math.max(a.size, b.size) : 0;
      const brand = !!line.brand && normalize(item.brand) === normalize(line.brand);
      const size = !!line.size && normalize(item.size) === normalize(line.size);
      const color = !!line.color && normalize(item.color) === normalize(line.color);
      const score = Math.round(
        similarity * 60 +
          (brand ? 20 : 0) +
          (size ? 10 : 0) +
          (color ? 5 : 0) +
          (line.price !== null &&
          w.listings.some((l) => l.itemId === item.id && l.price === line.price)
            ? 5
            : 0),
      );
      return { item, score, reason: 'Similar description; please confirm', exact: false };
    })
    .filter((c) => c.score >= 25)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

/** Shared brand/size alone is useful for search, but insufficient to block a new physical draft. */
export function plausibleInventoryMatches(
  w: Workspace,
  record: ExtractedRecord,
  line: ExtractedLine,
) {
  return matchInventory(w, record, line).filter(
    (candidate) => candidate.exact || candidate.score >= 55,
  );
}
