import { readCsv } from '../csv';
import { parseMoney } from '../money';
import type { ExtractedLine, ExtractedRecord, Screenshot } from './schema';
export const historyColumns = [
  'title',
  'price',
  'date',
  'fees',
  'purchase_cost',
  'sku',
  'marketplace',
  'processing',
  'shipping',
  'shipping_collected',
  'discount',
  'refund',
  'other',
  'order_id',
  'packaging',
  'show_id',
  'status',
  'currency',
] as const;
export type HistoryCsvOptions = {
  mapping: Record<string, string>;
  marketplace: string;
  dateFormat: 'auto' | 'mdy' | 'dmy';
  depop?: boolean;
};
const aliases: Record<string, string[]> = {
  title: ['title', 'item name', 'item title', 'product name', 'description', 'name'],
  price: ['price', 'sale price', 'sold price', 'item price'],
  date: ['date', 'sale date', 'sold date', 'date of sale'],
  fees: ['fees', 'seller fees', 'selling fees', 'total fees'],
  purchase_cost: ['purchase cost', 'purchase_cost', 'cost', 'cost basis', 'acquisition cost'],
  sku: ['sku'],
  marketplace: ['marketplace', 'platform'],
  processing: ['processing', 'processing fee'],
  shipping: ['shipping', 'seller shipping', 'shipping cost'],
  shipping_collected: ['shipping collected', 'shipping_collected'],
  discount: ['discount'],
  refund: ['refund'],
  other: ['other'],
  packaging: ['packaging', 'packaging cost'],
  show_id: ['show id', 'show_id'],
  order_id: ['order id', 'order_id', 'order number', 'transaction id'],
  status: ['status', 'sale status', 'order status', 'payment status'],
  currency: ['currency', 'currency code'],
};
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
export const isDepopReport = (columns: string[]) =>
  [
    'Date of sale',
    'Item price',
    'Depop Payments fee',
    'Buyer Marketplace Fee',
    'USPS Cost',
    'US Sales tax',
  ].every((c) => columns.includes(c));
export function historyMapping(columns: string[]) {
  const mapping = Object.fromEntries(
    historyColumns.map((target) => [
      target,
      (aliases[target] || [target])
        .map((a) => columns.find((c) => key(a) === key(c)))
        .find(Boolean) || '',
    ]),
  );
  if (isDepopReport(columns)) {
    mapping.shipping = 'USPS Cost';
    // A buyer shipping charge does not establish that the seller received it.
    // Users may explicitly map it after verifying their shipping arrangement.
    mapping.shipping_collected = '';
  }
  return mapping;
}
export function sourceAmount(value: string | undefined): number | null {
  const raw = value?.trim() || '';
  if (!raw || /^(?:N\/A|-|="-"|="")$/i.test(raw)) return null;
  // Only literal currency formatting is accepted. Never evaluate spreadsheet formulas.
  const clean = raw.replace(/^\$/, '').replace(/,/g, '');
  const valueInCents = parseMoney(clean);
  if (valueInCents < 0) throw new Error('Use a non-negative amount.');
  return valueInCents;
}
function historyDate(raw: string, format: HistoryCsvOptions['dateFormat'], depop: boolean) {
  const value = raw.trim();
  if (/^\d{4}-\d\d-\d\d(?:$|T)/.test(value)) return value;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (!m)
    throw new Error('Use a sale date in YYYY-MM-DD format, or select the file’s date format.');
  const style =
    format === 'auto' && depop
      ? 'mdy'
      : format === 'auto'
        ? +m[1] > 12
          ? 'dmy'
          : +m[2] > 12
            ? 'mdy'
            : ''
        : format;
  if (!style) throw new Error('This date is ambiguous. Choose Month/day/year or Day/month/year.');
  return `${m[3]}-${(style === 'mdy' ? m[1] : m[2]).padStart(2, '0')}-${(style === 'mdy' ? m[2] : m[1]).padStart(2, '0')}`;
}
const cleanText = (s: string | undefined) =>
  !s || /^(?:N\/A|-|="-"|="")$/i.test(s.trim()) ? null : s.trim();
export function parseHistoryCsv(
  rows: Record<string, string>[],
  options: HistoryCsvOptions,
): ExtractedRecord[] {
  const groups = new Map<string, { row: Record<string, string>; index: number }[]>();
  rows.forEach((row, index) => {
    const external = cleanText(row[options.mapping.order_id]);
    const bundle = options.depop && row.Bundle === 'Yes';
    // Buyer is used locally ONLY to verify bundle membership and is never retained or sent to AI.
    const group = external
      ? `id:${options.marketplace || row[options.mapping.marketplace]}:${external}`
      : bundle
        ? `bundle:${row['Date of sale']}:${row['Time of sale']}:${row.Buyer}`
        : `row:${index}`;
    groups.set(group, [...(groups.get(group) || []), { row, index }]);
  });
  return [...groups.values()].map((group) => {
    const first = group[0].row;
    if (group.length > 30)
      throw new Error('Use the manual order editor for orders with more than 30 physical items.');
    const get = (r: Record<string, string>, target: string) => r[options.mapping[target]] || '';
    const bundle = options.depop && first.Bundle === 'Yes';
    if (bundle) {
      const expected = group
        .map(({ row }) => sourceAmount(row['Bundle - amount of items']))
        .filter((n) => n !== null);
      if (expected.length !== 1 || expected[0] !== group.length * 100)
        throw new Error(
          `Row ${group[0].index + 2}: incomplete or ambiguous Depop bundle. Include all its item rows.`,
        );
    }
    const sum = (target: string) =>
      group.reduce((total, { row }) => total + (sourceAmount(get(row, target)) ?? 0), 0);
    const depopMoney = (column: string, missingIsNone = false) => {
      const entries = group.map(({ row }) => sourceAmount(row[column]));
      if (
        bundle &&
        entries.filter((n) => n !== null && n > 0).length > 1 &&
        ['Depop Payments fee', 'Buyer shipping cost', 'USPS Cost'].includes(column)
      )
        throw new Error(
          `Shared ${column} appears on multiple bundle lines. Verify its per-item allocation before importing.`,
        );
      // Continuation dashes refer to the single bundle-level amount; never multiply it.
      if (entries.every((n) => n === null) && !missingIsNone) return null;
      return entries.reduce<number>((n, value) => n + (value ?? 0), 0);
    };
    const lines: ExtractedLine[] = group.map(({ row, index }) => {
      const title = cleanText(get(row, 'title'));
      const price = sourceAmount(get(row, 'price'));
      if (!title || price === null)
        throw new Error(`Row ${index + 2}: item name and sale price are required.`);
      return {
        title,
        price,
        purchaseCost: sourceAmount(get(row, 'purchase_cost')),
        sku: cleanText(get(row, 'sku')),
        brand: options.depop ? cleanText(row.Brand) : null,
        size: options.depop ? cleanText(row.Size) : null,
        category: options.depop ? cleanText(row.Category) : null,
        color: null,
        condition: null,
        description: null,
        externalProductId: null,
        listingId: null,
        url: null,
      };
    });
    const saleDate = historyDate(get(first, 'date'), options.dateFormat, !!options.depop);
    if (
      group.some(
        ({ row }) =>
          historyDate(get(row, 'date'), options.dateFormat, !!options.depop) !== saleDate,
      )
    )
      throw new Error('Rows grouped under one order must have the same sale date.');
    const fee = options.depop ? depopMoney('Depop fee') : sourceAmount(get(first, 'fees'));
    const processing = options.depop ? depopMoney('Depop Payments fee') : sum('processing');
    if (fee === null || processing === null)
      throw new Error(
        `Row ${group[0].index + 2}: seller fees are required; enter 0 explicitly for no fees.`,
      );
    if (!options.depop && group.some(({ row }) => sourceAmount(get(row, 'fees')) === null))
      throw new Error('Every row needs seller fees, including an explicit 0 when appropriate.');
    const refund = options.depop ? depopMoney('Refunded to buyer amount', true)! : sum('refund');
    const feeCredit = options.depop ? depopMoney('Fees refunded to seller', true)! : 0;
    if (refund || feeCredit)
      throw new Error(
        'This report includes refunds or fee credits. Reconcile those rows through the original order’s dated ledger before importing; no records were saved.',
      );
    const rawStatus = cleanText(get(first, 'status'))?.toLowerCase();
    const currency = cleanText(get(first, 'currency'))?.toUpperCase() || 'USD';
    if (
      group.some(
        ({ row }) =>
          (cleanText(get(row, 'currency'))?.toUpperCase() || 'USD') !== currency ||
          cleanText(get(row, 'status'))?.toLowerCase() !== rawStatus ||
          cleanText(get(row, 'show_id')) !== cleanText(get(first, 'show_id')),
      )
    )
      throw new Error(
        'Rows grouped under one order must have the same currency, source status and show.',
      );
    const completed = !rawStatus || ['completed', 'sold', 'paid'].includes(rawStatus);
    return {
      kind: completed ? 'sale' : 'other',
      status: completed
        ? 'completed'
        : [
              'pending',
              'cancelled',
              'refunded',
              'returned',
              'shipped',
              'delivered',
              'offer',
            ].includes(rawStatus!)
          ? (rawStatus as ExtractedRecord['status'])
          : 'unknown',
      marketplace: (options.marketplace ||
        cleanText(get(first, 'marketplace'))) as ExtractedRecord['marketplace'],
      currency,
      date: saleDate,
      externalOrderId: cleanText(get(first, 'order_id')),
      lines,
      fees: options.depop ? fee + depopMoney('Boosting fee', true)! : sum('fees'),
      processing,
      shipping: options.depop
        ? options.mapping.shipping
          ? depopMoney(options.mapping.shipping)
          : null
        : sum('shipping'),
      shippingCollected: options.depop
        ? options.mapping.shipping_collected
          ? depopMoney(options.mapping.shipping_collected)
          : null
        : sum('shipping_collected'),
      discount: sum('discount'),
      refund: 0,
      other: sum('other'),
      packaging: sum('packaging'),
      showId: cleanText(get(first, 'show_id')),
      warnings: completed
        ? []
        : [
            `Source status is ${rawStatus}; confirm the original event through its order ledger instead of creating a completed sale.`,
          ],
    };
  });
}
export async function historyCsvSources(
  text: string,
  name: string,
  options: HistoryCsvOptions,
  originalText = text,
): Promise<Screenshot[]> {
  const parsed = readCsv(text);
  if (parsed.rows.length > 300)
    throw new Error('Use at most 300 item rows per CSV batch; split larger reports.');
  const records = parseHistoryCsv(parsed.rows, options);
  if (records.length > 300) throw new Error('Use at most 300 sale records per batch.');
  const originalHash = await digest(originalText);
  const sources: Screenshot[] = [];
  for (let start = 0; start < records.length; start += 30) {
    const section = records.slice(start, start + 30);
    // Include the part position so identical sections never drop repeated source rows.
    // Buyer names and addresses remain excluded from these safe facts.
    const hash = await digest(JSON.stringify({ start, records: section }));
    sources.push({
      hash,
      originalHash,
      sourceType: 'csv',
      name: name.slice(0, 180),
      part: Math.floor(start / 30) + 1,
      parts: Math.ceil(records.length / 30),
      extraction: {
        records: section,
        message: `${section.length} sales prepared from CSV. Purchase costs may remain unknown; review before saving.`,
      },
    });
  }
  return sources;
}
async function digest(text: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
