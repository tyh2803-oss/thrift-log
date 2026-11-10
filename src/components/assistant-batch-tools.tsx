'use client';
import { useState } from 'react';
import type { DraftBatch } from '@/lib/assistant/drafts';
import type { Workspace } from '@/lib/model';
import {
  applyBatchCost,
  eligiblePhysicalDrafts,
  setBatchAcquisitionDate,
} from '@/lib/assistant/review-bulk';
import { Button } from './ui/button';

export function BatchTools({
  batch,
  w,
  busy,
  onChange,
  onClear,
  onReview,
  onApprove,
  readyCount,
  unresolvedCount,
}: {
  batch: DraftBatch;
  w: Workspace;
  busy: boolean;
  onChange: (b: DraftBatch) => void;
  onClear: () => void;
  onReview: () => void;
  onApprove: () => void;
  readyCount: number;
  unresolvedCount: number;
}) {
  const [open, setOpen] = useState(false),
    [mode, setMode] = useState<'same' | 'split' | 'individual'>('same');
  const [raw, setRaw] = useState(''),
    [error, setError] = useState('');
  const [choosing, setChoosing] = useState(false),
    [selected, setSelected] = useState<string[] | null>(null);
  const eligible = eligiblePhysicalDrafts(w, batch);
  const dates = new Set(
    batch.rows.flatMap((row) =>
      row.matches.flatMap((m) => (m.newItem ? [m.newItem.purchasedAt] : [])),
    ),
  );
  const assumed = batch.rows.some((r) => r.matches.some((m) => m.newItem?.assumedAcquisitionDate));
  const newCount = new Set(
    batch.rows.flatMap((r) => r.matches.flatMap((m) => (m.newItem ? [m.newItem.id] : []))),
  ).size;
  return (
    <div className="compact-batch-toolbar">
      <div className="actions">
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          Batch Cost
        </Button>
        <Button variant="ghost" size="sm" disabled={busy || !unresolvedCount} onClick={onReview}>
          Review unresolved ({unresolvedCount})
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onClear}>
          Clear All
        </Button>
        <Button variant="ghost" size="sm" disabled={busy || !readyCount} onClick={onApprove}>
          Approve All Ready
        </Button>
      </div>
      {!!newCount && (
        <label className="compact-batch-date">
          <span>Acquired</span>
          <input
            aria-label="Batch acquisition date"
            type="date"
            disabled={busy}
            value={dates.size === 1 ? [...dates][0] : ''}
            onChange={(e) => onChange(setBatchAcquisitionDate(batch, e.target.value))}
          />
          <small>
            {assumed
              ? 'Assumed date; Approve All accepts. Change if earlier.'
              : 'Applies to new inventory only.'}
          </small>
        </label>
      )}
      {open && (
        <fieldset className="compact-batch-cost" disabled={busy} aria-label="Batch purchase costs">
          <label className="field">
            <span>Cost mode</span>
            <select
              value={mode}
              onChange={(e) => {
                setMode(e.target.value as typeof mode);
                setError('');
              }}
            >
              <option value="same">Same cost per item</option>
              <option value="split">Split total cost</option>
              <option value="individual">Individual costs</option>
            </select>
          </label>
          <small>
            {eligible.length} eligible new physical items. Existing costs are protected.
            Cross-listings count once.
          </small>
          {mode === 'individual' ? (
            <p>Enter or override each purchase cost directly on its card.</p>
          ) : (
            <>
              <div className="compact-batch-amount">
                <label className="field">
                  <span>{mode === 'split' ? 'Total batch cost ($)' : 'Cost per item ($)'}</span>
                  <input
                    value={raw}
                    inputMode="decimal"
                    maxLength={100}
                    placeholder="Unknown"
                    onChange={(e) => setRaw(e.target.value)}
                  />
                </label>
                <Button
                  size="sm"
                  disabled={!eligible.length}
                  onClick={() => {
                    try {
                      onChange(applyBatchCost(w, batch, mode, raw, selected ?? undefined));
                      setError('');
                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'Check batch cost.');
                    }
                  }}
                >
                  Apply cost
                </Button>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setChoosing(!choosing)}>
                Choose items (
                {selected === null
                  ? eligible.length
                  : eligible.filter((g) => selected.includes(g.id)).length}
                )
              </Button>
              {choosing &&
                eligible.map((group) => (
                  <label key={group.id} className="check-row">
                    <input
                      type="checkbox"
                      checked={selected === null || selected.includes(group.id)}
                      onChange={(e) => {
                        const ids = selected || eligible.map((g) => g.id);
                        setSelected(
                          e.target.checked
                            ? [...new Set([...ids, group.id])]
                            : ids.filter((id) => id !== group.id),
                        );
                      }}
                    />
                    {group.title}
                  </label>
                ))}
              <details>
                <summary>Included physical items</summary>
                <ul>
                  {eligible
                    .filter((g) => selected === null || selected.includes(g.id))
                    .map((g) => (
                      <li key={g.id}>{g.title}</li>
                    ))}
                </ul>
              </details>
            </>
          )}
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
        </fieldset>
      )}
    </div>
  );
}
