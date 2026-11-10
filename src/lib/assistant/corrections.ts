import { type Workspace, marketplaces } from '../model';
import { changeEvent } from './events';
import { changeListingCost } from './listing-review';
import { previewBatch } from './planner';
import { removeDraft } from './drafts';
import { correctedMarketplace } from './vision';
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
  if (
    /^(?:please\s+)?(?:log|approve|add|save)(?:\s+all)?\s+(?:these|everything|all|them)(?:\s+ready)?[.!]?$/i.test(
      text,
    )
  ) {
    const ready = previewBatch(w, batch).filter((p) => p.row.included && p.ready).length;
    return {
      batch: input,
      message: `${ready} records are ready. Tap Approve All Ready (${ready}) to confirm the validated batch; unresolved records stay pending.`,
      changed: false,
    };
  }
  if (/^(?:please\s+)?clear\s+(?:all|everything|the batch)[.!]?$/i.test(text))
    return fail(
      'Use Clear All, then confirm Discard pending drafts. Saved records will stay intact.',
    );
  if (/\b(?:all|these|them|everything)\b/i.test(text) && /\b(?:listed|for sale)\b/i.test(text)) {
    let count = 0;
    batch.rows = batch.rows.map((row) => {
      if (!row.included || !['listing', 'other'].includes(row.facts.kind)) return row;
      count++;
      return changeEvent(row, 'active_listing');
    });
    return {
      batch,
      message: `Prepared ${count} listing updates. Review and tap Approve All Ready; completed sales and fulfillment events were preserved.`,
      changed: count > 0,
    };
  }
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
  if (/^(?:please\s+)?(?:remove|delete|trash|discard)\b/i.test(text))
    return {
      batch: removeDraft(batch, row.id),
      message: `Removed pending record ${rowIndex + 1}. Saved inventory and accounting records are unchanged.`,
      changed: true,
    };
  const cost = text.match(
    /(?:cost(?: me| was| is)?|purchase cost(?: was| is)?)\s*[:=]?\s*\$?(\d+(?:\.\d{1,2})?)(?!\d|\.\d)/i,
  );
  if (cost && !/shipping|fees?|processing|other expenses/i.test(text)) {
    if (row.facts.lines.length !== 1) return fail('Which line’s acquisition cost should change?');
    row.matches[0].costCorrection = !!row.matches[0].itemId;
    batch.rows[rowIndex] = changeListingCost(w, row, 0, cost[1]);
    return {
      batch,
      message: `Proposed record ${rowIndex + 1} acquisition cost $${cost[1]}. Nothing is saved until approval.`,
      changed: true,
    };
  }
  if (/\b(?:shipped|fulfilled)\b/i.test(text))
    return fail(
      'Approve an unsaved sale first. For a saved sale, use Mark Shipped or Mark Fulfilled after saving, or give its inventory title.',
    );
  if (/\b(?:sold)\b/i.test(text) && row.facts.kind !== 'sale') {
    const next = changeEvent(row, 'completed_sale');
    next.facts.date = null;
    next.facts.externalOrderId = null;
    for (const key of [
      'fees',
      'processing',
      'shipping',
      'shippingCollected',
      'discount',
      'refund',
      'other',
    ] as const)
      next.facts[key] = null;
    const amount = text.match(/sold for\s*\$?(\d+(?:\.\d{1,2})?)(?!\d|\.\d)/i);
    next.facts.lines = next.facts.lines.map((l) => ({
      ...l,
      price: amount && next.facts.lines.length === 1 ? parseMoney(amount[1]) : null,
    }));
    batch.rows[rowIndex] = next;
    return {
      batch,
      message:
        'Proposed a completed sale. Confirm the actual sale date, price and selling amounts before approval; asking prices were not assumed to be proceeds.',
      changed: true,
    };
  }
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
    delete row.matches[lineIndex].priceInput;
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
    row.facts.marketplaceIdentification = correctedMarketplace(
      row.facts.marketplaceIdentification,
      platform,
    );
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
    row.matches[lineIndex] = {
      ...row.matches[lineIndex],
      costOverride: undefined,
      costInput: undefined,
      costCorrection: false,
      purchaseCost: undefined,
      itemId: candidates[0].id,
      newItem: null,
      confirmZeroCost: false,
    };
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
