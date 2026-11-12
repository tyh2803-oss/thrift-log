'use client';
import { useState } from 'react';
import { useWorkspace } from '@/lib/use-workspace';
import { marketplaces } from '@/lib/model';
import {
  historyColumns,
  historyMapping,
  historyCsvSources,
  isDepopReport,
  type HistoryCsvOptions,
} from '@/lib/assistant/csv-history';
import { createHistoryBatch } from '@/lib/assistant/history';
import { type DraftBatch } from '@/lib/assistant/drafts';
import { HistoryReview } from './history-review';
import { Button } from './ui/button';
const labels: Record<string, string> = {
  title: 'Item name',
  price: 'Sale price',
  date: 'Sale date',
  fees: 'Seller fees',
  purchase_cost: 'Purchase cost',
  sku: 'SKU',
  marketplace: 'Marketplace',
  processing: 'Processing fee',
  shipping: 'Seller shipping',
  shipping_collected: 'Shipping received',
  discount: 'Discount',
  refund: 'Refund',
  other: 'Other costs',
  packaging: 'Packaging',
  show_id: 'Show ID',
  order_id: 'Order ID',
  status: 'Source status',
  currency: 'Currency',
};
export function CsvSalesReview({
  text,
  filename,
  rows,
  columns,
  onClose,
}: {
  text: string;
  filename: string;
  rows: Record<string, string>[];
  columns: string[];
  onClose: () => void;
}) {
  const { w, approveAssistant, saving, error: saveError, notify } = useWorkspace();
  const depop = isDepopReport(columns);
  const [mapping, setMapping] = useState(() => historyMapping(columns));
  const [marketplace, setMarketplace] = useState(depop ? 'Depop' : '');
  const [dateFormat, setDateFormat] = useState<HistoryCsvOptions['dateFormat']>(
    depop ? 'mdy' : 'auto',
  );
  const [batch, setBatch] = useState<DraftBatch | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState('');
  async function review() {
    setBusy(true);
    setError('');
    try {
      // SKU-only reports may use the exact existing inventory name without another column.
      let selected = mapping;
      let sourceText = text;
      if (!mapping.title && mapping.sku) {
        const Papa = (await import('papaparse')).default;
        sourceText = Papa.unparse(
          rows.map((r) => ({
            ...r,
            __inventory_title: w.items.find((i) => i.sku === r[mapping.sku])?.title || '',
          })),
        );
        selected = { ...mapping, title: '__inventory_title' };
      }
      const sources = await historyCsvSources(
        sourceText,
        filename,
        {
          mapping: selected,
          marketplace,
          dateFormat,
          depop,
        },
        text,
      );
      setBatch(createHistoryBatch(sources, w));
      setResult('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read sale history.');
    } finally {
      setBusy(false);
    }
  }
  async function approve(ids: string[]) {
    if (!batch || busy) return;
    setBusy(true);
    setError('');
    try {
      const saved = await approveAssistant(batch, ids, 'history');
      if (saved) {
        setResult(`Imported ${ids.length} sale records.`);
        notify('Sale history imported. Unknown purchase costs remain marked incomplete.');
        setBatch(
          batch.rows.some((r) => !ids.includes(r.id))
            ? {
                ...batch,
                revision: saved.revision,
                rows: batch.rows.filter((r) => !ids.includes(r.id)),
              }
            : null,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed; your review is preserved.');
    } finally {
      setBusy(false);
    }
  }
  const field = (target: string, required = false) => (
    <label className="field" key={target}>
      <span>
        {labels[target]}
        {required ? ' · required' : ' · optional'}
      </span>
      {depop && target === 'fees' ? (
        <input value="Depop + Payments + Boosting seller fees" readOnly />
      ) : (
        <select
          aria-label={`Map ${labels[target]}`}
          value={mapping[target] || ''}
          onChange={(e) => setMapping({ ...mapping, [target]: e.target.value })}
        >
          <option value="">Do not import this column</option>
          {columns.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      )}
    </label>
  );
  return (
    <section className="csv-sales-review">
      {(error || saveError) && (
        <div className="error-box" role="alert">
          {error || saveError}
        </div>
      )}
      {result && <div className="success-box">{result}</div>}
      {batch ? (
        <HistoryReview
          batch={batch}
          onChange={setBatch}
          onApprove={(ids) => void approve(ids)}
          onCancel={() => setBatch(null)}
          busy={busy || saving}
        />
      ) : (
        <>
          {depop && (
            <p className="success-box">
              Depop sales report detected. Bundles stay together. Buyer marketplace fees and sales
              tax are excluded from seller proceeds; shared charges are counted once. Buyer names
              and addresses are not included in drafts. Buyer shipping is excluded unless you map it
              as money received by you.
            </p>
          )}
          <div className="form-grid">
            <label className="field">
              <span>Marketplace for this file</span>
              <select
                aria-label="CSV marketplace"
                value={marketplace}
                onChange={(e) => setMarketplace(e.target.value)}
              >
                <option value="">Use marketplace column</option>
                {marketplaces.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Date format</span>
              <select
                aria-label="CSV date format"
                value={dateFormat}
                onChange={(e) => setDateFormat(e.target.value as typeof dateFormat)}
              >
                <option value="auto">ISO / unambiguous dates</option>
                <option value="mdy">Month/day/year</option>
                <option value="dmy">Day/month/year</option>
              </select>
            </label>
            {['title', 'price', 'date', 'fees'].map((c) => field(c, true))}
            {field('purchase_cost')}
          </div>
          <p className="hint">
            Only item name, sale price, sale date and seller fees are required. Enter 0 for no
            seller fees. Order ID, SKU and purchase cost are optional. Select the marketplace here
            if it is absent from the file. Blank purchase cost stays unknown, not zero. Monetary
            columns not supplied are not included in recorded costs.
          </p>
          <details>
            <summary>Optional columns</summary>
            <div className="form-grid">
              {historyColumns
                .filter(
                  (c) =>
                    !['title', 'price', 'date', 'fees', 'purchase_cost'].includes(c) &&
                    !(depop && c === 'processing'),
                )
                .map((c) => field(c))}
            </div>
          </details>
          <p>{rows.length} source rows · preview before saving</p>
          <div className="actions">
            <Button disabled={busy || saving} onClick={() => void review()}>
              {busy ? 'Preparing…' : 'Review sales'}
            </Button>
            <Button variant="ghost" disabled={busy || saving} onClick={onClose}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
