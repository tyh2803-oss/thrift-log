import Papa from 'papaparse';
import {
  itemSchema,
  orderSchema,
  listingSchema,
  expenseSchema,
  type Command,
  type Workspace,
} from './model';
import { parseMoney, allocate } from './finance';
export type ImportKind = 'Inventory' | 'Sales' | 'Listings' | 'Expenses';
export const importColumns: Record<ImportKind, string[]> = {
  Inventory: [
    'sku',
    'title',
    'brand',
    'category',
    'size',
    'cost',
    'asking',
    'purchase_date',
    'source',
  ],
  Sales: [
    'order_id',
    'sku',
    'price',
    'marketplace',
    'date',
    'fees',
    'processing',
    'shipping',
    'shipping_collected',
    'packaging',
    'discount',
    'refund',
    'show_id',
  ],
  Listings: ['listing_id', 'sku', 'marketplace', 'price', 'url', 'date'],
  Expenses: ['expense_id', 'title', 'category', 'amount', 'date'],
};
export function readCsv(text: string) {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.replace(/^\uFEFF/, '').trim(),
  });
  if (parsed.errors.length) throw new Error(`CSV could not be read: ${parsed.errors[0].message}`);
  if (!parsed.meta.fields?.length || parsed.data.length > 5000)
    throw new Error('Use a CSV with headers and at most 5,000 rows.');
  return { rows: parsed.data, columns: parsed.meta.fields };
}
const cents = (v: string | undefined) => parseMoney(v?.trim() || '0');
const date = (v: string | undefined) => {
  const d = v ? new Date(v) : new Date();
  if (!Number.isFinite(+d)) throw new Error('Invalid date');
  return d.toISOString();
};
/** Explicit column mapping; no fuzzy title matching or cost-basis invention. */
export function planImport(
  kind: ImportKind,
  rows: Record<string, string>[],
  mapping: Record<string, string>,
  w: Workspace,
): { commands: Command[]; errors: string[]; duplicates: number } {
  const commands: Command[] = [];
  const errors: string[] = [];
  let duplicates = 0;
  const normalized = rows.map((r) =>
    Object.fromEntries(
      Object.entries(mapping).map(([target, source]) => [target, r[source] ?? '']),
    ),
  );
  const seen = new Set<string>();
  if (kind === 'Sales') {
    const groups = new Map<string, Record<string, string>[]>();
    normalized.forEach((r, i) => {
      if (!r.order_id) {
        errors.push(`Row ${i + 2}: order_id is required.`);
        return;
      }
      const key = `${r.marketplace || 'Whatnot'}:${r.order_id}`;
      groups.set(key, [...(groups.get(key) || []), r]);
    });
    for (const [key, group] of groups)
      try {
        if (w.orders.some((o) => `${o.marketplace}:${o.externalId}` === key)) {
          duplicates++;
          continue;
        }
        const first = group[0];
        const lines = group.map((r) => {
          if (!r.price?.trim()) throw new Error('Sale price is required on every row.');
          const item = w.items.find((i) => i.sku === r.sku);
          if (!item)
            throw new Error(
              `Unmatched SKU “${r.sku}”. Add or map the physical inventory item first.`,
            );
          return { itemId: item.id, price: cents(r.price), costBasis: item.cost };
        });
        // Monetary fee columns are per line; sum once per row, never duplicate an order-level total.
        const sum = (k: string) => group.reduce((n, r) => n + cents(r[k]), 0);
        commands.push({
          type: 'order',
          value: orderSchema.parse({
            id: crypto.randomUUID(),
            marketplace: first.marketplace || 'Whatnot',
            externalId: first.order_id,
            date: date(first.date),
            showId: first.show_id || null,
            lines,
            discount: sum('discount'),
            shippingCollected: sum('shipping_collected'),
            fees: sum('fees'),
            processing: sum('processing'),
            shipping: sum('shipping'),
            packaging: sum('packaging'),
            other: 0,
            refund: sum('refund'),
            feeCredit: 0,
            adjustment: 0,
            tips: 0,
            type: 'Sale',
            status: 'Completed',
            fulfillment: 'Unfulfilled',
            payout: 'Pending',
            provenance: JSON.stringify(group).slice(0, 500),
            importKey: key,
          }),
        });
      } catch (e) {
        errors.push(`${key}: ${e instanceof Error ? e.message : 'Invalid row'}`);
      }
  } else
    normalized.forEach((r, i) => {
      try {
        if (kind === 'Inventory') {
          if (!r.sku) throw new Error('SKU is required.');
          if (!r.cost?.trim())
            throw new Error('Purchase cost is required; enter 0 explicitly for a free item.');
          if (w.items.some((item) => item.sku === r.sku) || seen.has(r.sku)) {
            duplicates++;
            return;
          }
          seen.add(r.sku);
          commands.push({
            type: 'item',
            value: itemSchema.parse({
              id: crypto.randomUUID(),
              sku: r.sku,
              title: r.title,
              brand: r.brand || '',
              category: r.category || 'Other',
              size: r.size || '',
              cost: cents(r.cost),
              asking: cents(r.asking),
              purchasedAt: date(r.purchase_date),
              createdAt: new Date().toISOString(),
              source: r.source || '',
              status: 'Purchased',
            }),
          });
        } else if (kind === 'Listings') {
          const item = w.items.find((item) => item.sku === r.sku);
          if (!item) throw new Error('Unmatched SKU.');
          if (!r.listing_id) throw new Error('listing_id is required.');
          const key = `${r.marketplace}:${r.listing_id}`;
          if (seen.has(key) || w.listings.some((l) => `${l.marketplace}:${l.externalId}` === key)) {
            duplicates++;
            return;
          }
          seen.add(key);
          commands.push({
            type: 'listing',
            value: listingSchema.parse({
              id: crypto.randomUUID(),
              itemId: item.id,
              marketplace: r.marketplace,
              price: cents(r.price),
              originalPrice: cents(r.price),
              externalId: r.listing_id,
              url: r.url || '',
              listedAt: date(r.date),
              status: 'Active',
            }),
          });
        } else {
          if (!r.expense_id)
            throw new Error('expense_id (UUID) is required for repeatable expense imports.');
          if (seen.has(r.expense_id) || w.expenses.some((e) => e.id === r.expense_id)) {
            duplicates++;
            return;
          }
          seen.add(r.expense_id);
          commands.push({
            type: 'expense',
            value: expenseSchema.parse({
              id: r.expense_id,
              title: r.title,
              category: r.category || 'Other',
              amount: cents(r.amount),
              date: date(r.date),
            }),
          });
        }
      } catch (e) {
        errors.push(`Row ${i + 2}: ${e instanceof Error ? e.message : 'Invalid row'}`);
      }
    });
  return { commands, errors, duplicates };
}
export function csvText(rows: Record<string, unknown>[]) {
  return Papa.unparse(
    rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([k, v]) => [
          k,
          typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v,
        ]),
      ),
    ),
  );
}
export function downloadCsv(name: string, rows: Record<string, unknown>[]) {
  const url = URL.createObjectURL(new Blob([csvText(rows)], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `thrift-log-${name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
export function splitPurchase(total: number, count: number) {
  return allocate(
    total,
    Array.from({ length: count }, () => 1),
  );
}
