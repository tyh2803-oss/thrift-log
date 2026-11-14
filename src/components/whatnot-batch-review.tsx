'use client';
import { useState } from 'react';
import type { OrderSource, StoredRecord } from '@/lib/integrations/whatnot/schema';
import type { ReviewEntries } from '@/lib/integrations/whatnot/review';
import { allocate, parseMoney } from '@/lib/money';
import { Button } from './ui/button';
export function WhatnotBatchReview({
  records,
  busy,
  onReview,
}: {
  records: StoredRecord[];
  busy: boolean;
  onReview: (
    entries: ReviewEntries,
  ) => Promise<{ applied: string[]; unresolved: { id: string; issue: string }[] } | undefined>;
}) {
  const rows = records.filter((r) => r.kind === 'order'),
    [selected, setSelected] = useState<string[]>([]),
    [mode, setMode] = useState('same'),
    [amount, setAmount] = useState(''),
    [error, setError] = useState(''),
    [results, setResults] = useState<{ id: string; issue: string }[]>([]);
  const chosen = rows.filter((r) => selected.includes(r.external_id));
  const units = chosen
    .filter((r) => !r.local_id)
    .flatMap((r) =>
      (r.payload as { source: OrderSource }).source.items.flatMap((i) =>
        Array.from({ length: Math.min(30, i.quantity) }, (_, n) => ({
          orderId: r.external_id,
          key: `${i.id}:${n}`,
        })),
      ),
    );
  async function submit(withCosts: boolean) {
    try {
      setError('');
      if (!chosen.length) throw new Error('Select the orders to import.');
      let values: number[] = [];
      if (withCosts) {
        const cents = parseMoney(amount);
        if (cents < 0) throw new Error('Enter a non-negative purchase cost.');
        if (!units.length)
          throw new Error('Select unrecorded orders to set their new physical items’ costs.');
        values =
          mode === 'split'
            ? allocate(
                cents,
                units.map(() => 1),
              )
            : units.map(() => cents);
      }
      const entries = chosen.map((r) => ({
        id: r.external_id,
        hash: r.hash,
        resolution:
          withCosts && !r.local_id
            ? {
                units: Object.fromEntries(
                  units.flatMap((u, index) =>
                    u.orderId === r.external_id
                      ? [[u.key, { itemId: 'new' as const, cost: values[index] }]]
                      : [],
                  ),
                ),
              }
            : {},
      }));
      const result = await onReview(entries);
      if (result) {
        setSelected((old) => old.filter((id) => !result.applied.includes(id)));
        setResults(result.unresolved);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Review these purchase costs.');
    }
  }
  return (
    <section className="whatnot-batch-toolbar card" aria-label="Whatnot bulk review">
      <h4>Import held orders together</h4>
      <p>
        Repeated names and reused SKUs do not block imports. Recheck records using their Whatnot
        order and item IDs; missing costs stay unknown.
      </p>
      <div className="actions">
        <strong>{chosen.length} selected</strong>
        <Button
          variant="outline"
          disabled={busy || !rows.length}
          onClick={() => setSelected(rows.map((r) => r.external_id))}
        >
          Select all orders ({rows.length})
        </Button>
        <Button variant="ghost" disabled={busy || !chosen.length} onClick={() => setSelected([])}>
          Clear selection
        </Button>
        <Button disabled={busy || !chosen.length} onClick={() => void submit(false)}>
          Import selected ({chosen.length})
        </Button>
      </div>
      <details>
        <summary>Bulk purchase costs for new items</summary>
        <p>
          {units.length} new physical items included. Existing saved inventory costs are not
          changed. Blank stays unknown; entered $0 confirms free inventory.
        </p>
        <div className="form-grid">
          <label className="field">
            <span>Cost mode</span>
            <select disabled={busy} value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="same">Same cost per physical item</option>
              <option value="split">Split total cost evenly</option>
            </select>
          </label>
          <label className="field">
            <span>
              {mode === 'split' ? 'Total purchase cost ($)' : 'Purchase cost per item ($)'}
            </span>
            <input
              disabled={busy}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Unknown"
            />
          </label>
        </div>
        <Button
          disabled={busy || !chosen.length || !amount.trim()}
          onClick={() => void submit(true)}
        >
          Apply costs & import
        </Button>
      </details>
      {!!rows.length && (
        <details>
          <summary>Choose orders ({rows.length})</summary>
          {rows.map((row) => (
            <label className="check-row" key={row.external_id}>
              <input
                type="checkbox"
                disabled={busy}
                checked={selected.includes(row.external_id)}
                onChange={(e) =>
                  setSelected((old) =>
                    e.target.checked
                      ? [...old, row.external_id]
                      : old.filter((id) => id !== row.external_id),
                  )
                }
              />
              <span>Order {row.external_id}</span>
            </label>
          ))}
        </details>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {!!results.length && (
        <div role="status">
          <strong>{results.length} orders still need information</strong>
          {results.map((r) => (
            <p key={r.id}>
              Order {r.id}: {r.issue}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
