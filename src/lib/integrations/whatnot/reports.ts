import Papa from 'papaparse';
import { z } from 'zod';
import { parseMoney } from '@/lib/money';
export type LedgerTransaction = {
  id: string;
  orderId: string | null;
  showId: string | null;
  sellerId: string;
  type: string;
  date: string;
  amount: number;
  currency: string;
  earnings?: {
    merchandise: number;
    discount: number;
    netMerchandise: number;
    fees: number;
    processing: number;
    shipping: number;
    quantity: number;
    sku: string | null;
    unitCost: number | null;
  };
  issue?: string;
  revisionConflict?: boolean;
};
const optional = (value: string | undefined) =>
  !value?.trim() || /^(?:N\/A|null)$/i.test(value.trim()) ? null : value.trim();
const required = (r: Record<string, string>, name: string) => {
  const value = optional(r[name]);
  if (value === null) throw new Error(`Financial report is missing ${name}.`);
  return value;
};
const cents = (r: Record<string, string>, name: string) => parseMoney(required(r, name));
export function parseFinancialReport(text: string, sellerId: string): LedgerTransaction[] {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.replace(/^\uFEFF/, '').trim(),
  });
  if (parsed.errors.length || parsed.data.length > 20000)
    throw new Error('Use a readable Whatnot financial report with at most 20,000 rows.');
  const seen = new Map<string, string>();
  return parsed.data.flatMap((row) => {
    const seller = required(row, 'seller_id');
    if (seller !== sellerId) throw new Error('This report belongs to a different Whatnot seller.');
    const id = required(row, 'ledger_transaction_id');
    if (id.length > 200) throw new Error('Invalid ledger transaction ID.');
    const date = required(row, 'transaction_completed_at_utc');
    if (!/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)?$/.test(date))
      throw new Error('Financial report has an invalid UTC transaction date.');
    const normalized = date.replace(' ', 'T') + (/(?:Z|[+-]\d\d:\d\d)$/.test(date) ? '' : 'Z');
    if (!z.iso.datetime({ offset: true }).safeParse(normalized).success)
      throw new Error('Financial report has an invalid UTC transaction date.');
    const iso = new Date(normalized).toISOString();
    const tx: LedgerTransaction = {
      id,
      sellerId: seller,
      orderId: optional(row.order_id),
      showId: optional(row.livestream_id),
      type: required(row, 'transaction_type'),
      date: iso,
      currency: required(row, 'transaction_currency'),
      amount: cents(row, 'transaction_amount'),
    };
    if (tx.type === 'ORDER_EARNINGS') {
      try {
        const merchandise = cents(row, 'original_item_price'),
          discount = -cents(row, 'coupon_cost'),
          netMerchandise = cents(row, 'post_coupon_price');
        const fees =
            Math.abs(cents(row, 'commission_fee')) + Math.abs(cents(row, 'commission_tax')),
          processing =
            Math.abs(cents(row, 'processing_fee')) + Math.abs(cents(row, 'processing_fee_tax')),
          shipping = Math.abs(cents(row, 'seller_shipping_charge'));
        const quantity = Number(required(row, 'quantity_sold')),
          rawCost = optional(row.cost_of_goods),
          unitCost = rawCost === null ? null : parseMoney(rawCost);
        if (
          merchandise < 0 ||
          discount < 0 ||
          netMerchandise !== merchandise - discount ||
          netMerchandise - fees - processing - shipping !== tx.amount ||
          !Number.isSafeInteger(quantity) ||
          quantity < 1 ||
          (unitCost !== null && unitCost < 0)
        )
          throw new Error();
        tx.earnings = {
          merchandise,
          discount,
          netMerchandise,
          fees,
          processing,
          shipping,
          quantity,
          sku: optional(row.sku),
          unitCost,
        };
      } catch {
        tx.issue =
          'Seller earnings do not reconcile to explicit merchandise, coupon, fees and shipping columns. Review the original report.';
      }
    }
    const canonical = JSON.stringify(tx),
      old = seen.get(id);
    if (old && old !== canonical)
      throw new Error('One report repeats a ledger ID with conflicting amounts.');
    if (old) return [];
    seen.set(id, canonical);
    return [tx];
  });
}
