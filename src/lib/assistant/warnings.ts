import type { ExtractedRecord } from './schema';
/** Similarity/record-match notices are informational; financial inconsistencies still block. */
export function matchingNotice(text: string) {
  return (
    /duplicate|possible existing|similar (?:item|inventory|listing)|already (?:imported|recorded)/i.test(
      text,
    ) && !/fee|total|amount|discount|refund|currency|price|payment|quantity/i.test(text)
  );
}
/** Optional garment observations do not block accounting; unknown/financial warnings still do. */
export function blockingWarnings(record: ExtractedRecord) {
  return record.warnings.filter(
    (w) =>
      !matchingNotice(w) &&
      (/fee|pric|ship|pay|discount|refund|order|date|currenc|amount|total|status|complet|offer|sale|\bID\b|\bSKU\b|\bURL\b/i.test(
        w,
      ) ||
        !/vintage|age|brand|size|colo[u]?r|material|fabric|condition|garment|label|tag|photo|graphic|silhouette/i.test(
          w,
        )),
  );
}
