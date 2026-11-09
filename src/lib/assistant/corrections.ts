import { type Workspace, marketplaces } from '../model';
import { parseMoney } from '../money';
import { type DraftBatch } from './drafts';
/** Deliberately bounded edits: ambiguity produces a question, never another transaction. */
export function correctBatch(
  input: DraftBatch,
  message: string,
  w: Workspace,
): { batch: DraftBatch; message: string; changed: boolean } {
  const batch = structuredClone(input);
  const fail = (text: string) => ({ batch: input, message: text, changed: false });
  const text = message.trim();
  if (/buyer.*shipping|shipping.*buyer/i.test(text))
    return fail(
      'Buyer-paid platform shipping may not be seller revenue. Use Edit to enter only shipping money you actually received.',
    );
  const normalized = text.toLowerCase();
  const ordinals = [
    'first',
    'second',
    'third',
    'fourth',
    'fifth',
    'sixth',
    'seventh',
    'eighth',
    'ninth',
    'tenth',
  ];
  const ordinal = normalized.match(
    /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+)(?:st|nd|rd|th)?\s+(?:item|sale|record|listing|row)\b/,
  );
  const rowNumber = normalized.match(/\b(?:row|record|sale|listing)\s+(\d+)\b/);
  let rowIndex = ordinal
    ? /^\d+$/.test(ordinal[1])
      ? Number(ordinal[1]) - 1
      : ordinals.indexOf(ordinal[1])
    : rowNumber
      ? Number(rowNumber[1]) - 1
      : -1;
  if (rowIndex < 0) {
    const tokens: string[] = normalized.match(/[a-z0-9]+/g) || [];
    const candidates = batch.rows
      .map((r, i) => ({
        i,
        score: Math.max(
          ...r.facts.lines.map((l) => {
            const title: string[] = (l.title || '').toLowerCase().match(/[a-z0-9]+/g) || [];
            return tokens.filter((t) => t.length > 2 && title.includes(t)).length;
          }),
        ),
      }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);
    if (candidates.length && (!candidates[1] || candidates[0].score > candidates[1].score))
      rowIndex = candidates[0].i;
    else if (batch.rows.length === 1) rowIndex = 0;
  }
  const row = batch.rows[rowIndex];
  if (!row)
    return fail(
      'Which record should I change? Use its number, for example “The second item sold for $35.”',
    );
  const lineRef = normalized.match(/\bline\s+(\d+)\b/);
  const lineIndex = lineRef ? Number(lineRef[1]) - 1 : 0;
  if (!row.facts.lines[lineIndex])
    return fail('Which item line should I change? Use a line number shown in the review.');
  const amountFields = [
    {
      pattern:
        /(?:shipping(?: cost)?(?: was| is| to)?|seller-paid shipping)\s*[:=]?\s*\$?(\d+(?:\.\d{1,2})?)/i,
      field: 'shipping',
    },
    {
      pattern: /(?:processing(?: fees?)?(?: was| were| is| to)?)\s*[:=]?\s*\$?(\d+(?:\.\d{1,2})?)/i,
      field: 'processing',
    },
    {
      pattern: /(?:fees?(?: was| were| is| to)?)\s*[:=]?\s*\$?(\d+(?:\.\d{1,2})?)/i,
      field: 'fees',
    },
    {
      pattern: /(?:discount(?: was| is| to)?)\s*[:=]?\s*\$?(\d+(?:\.\d{1,2})?)/i,
      field: 'discount',
    },
    {
      pattern:
        /(?:shipping (?:collected|received)(?: was| is| to)?)\s*[:=]?\s*\$?(\d+(?:\.\d{1,2})?)/i,
      field: 'shippingCollected',
    },
    {
      pattern:
        /(?:other (?:costs?|expenses?)(?: was| were| is| to)?)\s*[:=]?\s*\$?(\d+(?:\.\d{1,2})?)/i,
      field: 'other',
    },
  ] as const;
  for (const { pattern, field } of amountFields) {
    const match = text.match(pattern);
    if (match) {
      row.facts[field] = parseMoney(match[1]);
      return {
        batch,
        message: `Updated record ${rowIndex + 1}: ${field} is $${match[1]}. Review the recalculated preview.`,
        changed: true,
      };
    }
  }
  const price = text.match(
    /(?:sold for|sale price(?: was| is| to)?|price(?: was| is| to)?)\s*[:=]?\s*\$?(\d+(?:\.\d{1,2})?)/i,
  );
  if (price) {
    if (row.facts.lines.length > 1 && !lineRef)
      return fail(
        `Record ${rowIndex + 1} has multiple items. Specify a line number so I don’t replace an order total with one item’s price.`,
      );
    row.facts.lines[lineIndex].price = parseMoney(price[1]);
    return {
      batch,
      message: `Updated record ${rowIndex + 1}${lineRef ? `, line ${lineIndex + 1}` : ''} to $${price[1]}.`,
      changed: true,
    };
  }
  const replacement = text.split(/\bnot\b/i)[0];
  const platform = marketplaces.find((m) => replacement.toLowerCase().includes(m.toLowerCase()));
  if (platform) {
    row.facts.marketplace = platform;
    return {
      batch,
      message: `Updated record ${rowIndex + 1} to ${platform}. Please check the inventory match.`,
      changed: true,
    };
  }
  const itemName = text
    .match(/(?:\bis\b|\bmatch (?:it )?to\b)\s+(?:the\s+)?(.+?)(?:\s+in my inventory)?[.!]?$/i)?.[1]
    ?.replace(/\s+in my inventory[.!]?$/i, '')
    .replace(/[.!]$/, '')
    .trim();
  if (itemName) {
    const normalize = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    const name = normalize(itemName);
    const candidates = w.items.filter(
      (i) =>
        normalize(i.title) === name ||
        normalize(i.sku) === name ||
        normalize(i.title).includes(name),
    );
    if (candidates.length !== 1)
      return fail(
        candidates.length
          ? 'More than one inventory item matches that description. Choose the correct item in Edit.'
          : 'I couldn’t confirm a unique inventory match. Search inventory in Edit to choose it.',
      );
    if (row.facts.lines.length > 1 && !lineRef)
      return fail('Specify the line number to change its inventory match.');
    row.matches[lineIndex] = { itemId: candidates[0].id, newItem: null, confirmZeroCost: false };
    return {
      batch,
      message: `Matched record ${rowIndex + 1} to ${candidates[0].title}. Purchase cost comes from inventory.`,
      changed: true,
    };
  }
  return fail(
    'I can change a price, seller shipping, fees, discount, marketplace or inventory match. Use a record number and the new value, or choose Edit for other fields.',
  );
}
