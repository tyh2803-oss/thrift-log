'use client';
import { useEffect, useRef, useState } from 'react';
import { previewHistory, historyWarnings } from '@/lib/assistant/history';
import { newInventoryDraft, type DraftBatch, type DraftRow } from '@/lib/assistant/drafts';
import { plausibleInventoryMatches } from '@/lib/assistant/matching';
import { confirmedFreeInventory, listingAmount } from '@/lib/assistant/listing-review';
import { money } from '@/lib/money';
import { marketplaces } from '@/lib/model';
import { useWorkspace } from '@/lib/use-workspace';
import { Button } from './ui/button';
export function HistoryReview({
  batch,
  onChange,
  onApprove,
  onCancel,
  busy = false,
}: {
  batch: DraftBatch;
  onChange: (batch: DraftBatch) => void;
  onApprove: (ids: string[]) => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const { w } = useWorkspace();
  const root = useRef<HTMLElement>(null);
  const previews = previewHistory(w, batch);

  const stale = w.revision !== batch.revision;
  const update = (row: DraftRow) =>
    onChange({ ...batch, rows: batch.rows.map((r) => (r.id === row.id ? row : r)) });
  const [inputErrors, setInputErrors] = useState<Record<string, boolean>>({});
  const rowInvalid = (id: string) =>
    Object.entries(inputErrors).some(([key, value]) => value && key.startsWith(id));
  const ready = previews.filter((p) => p.row.included && p.ready && !rowInvalid(p.row.id));
  const validation = (key: string, value: boolean) =>
    setInputErrors((current) =>
      (current[key] || false) === value ? current : { ...current, [key]: value },
    );
  return (
    <section ref={root} className="history-review" aria-label="Sale history review">
      <div className="history-review-summary">
        <h3>Review sale history</h3>
        <p>
          Name, price, sale date and seller fees are required. Purchase cost is optional: blank
          means unknown, and $0 means free.
        </p>
        <details>
          <summary>How this import is saved</summary>
          <p>
            Approve All authorizes new physical records where no unresolved inventory match exists.
            Only recorded selling amounts are included; payouts and shipping status are not
            inferred. When a purchase date is missing, the sale date is a labeled placeholder, not
            verified purchase history. You can enter the real date on each item.
          </p>
        </details>
        {stale && (
          <div className="error-box">
            Workspace changed.{' '}
            <Button variant="outline" onClick={() => onChange({ ...batch, revision: w.revision })}>
              Refresh review
            </Button>
          </div>
        )}
      </div>
      <div className="actions history-top-actions">
        <strong>
          {ready.length} {ready.length === 1 ? 'sale' : 'sales'} ready
        </strong>
        <Button
          disabled={busy || stale || !ready.length}
          onClick={() => onApprove(ready.map((p) => p.row.id))}
        >
          Approve All Ready ({ready.length})
        </Button>
        <Button
          variant="outline"
          disabled={!previews.some((p) => !p.ready || rowInvalid(p.row.id))}
          onClick={() =>
            root.current
              ?.querySelector('[data-incomplete="true"]')
              ?.scrollIntoView({ block: 'start', behavior: 'instant' })
          }
        >
          Review unresolved records
        </Button>
      </div>
      {batch.rows.some((row) => row.facts.currency === null) && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            onChange({
              ...batch,
              rows: batch.rows.map((row) =>
                row.facts.currency === null
                  ? { ...row, facts: { ...row.facts, currency: 'USD' } }
                  : row,
              ),
            })
          }
        >
          Confirm unidentified amounts are USD (no conversion)
        </Button>
      )}
      <label className="field">
        <span>Set marketplace for all records (optional)</span>
        <select
          aria-label="History batch marketplace"
          value=""
          disabled={busy}
          onChange={(e) => {
            if (e.target.value)
              onChange({
                ...batch,
                rows: batch.rows.map((row) => ({
                  ...row,
                  facts: {
                    ...row.facts,
                    marketplace: e.target.value as typeof row.facts.marketplace,
                  },
                })),
              });
          }}
        >
          <option value="">Keep each record’s marketplace</option>
          {marketplaces.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </label>
      {previews.map((p, index) => {
        const row = p.row,
          r = row.facts;
        return (
          <article
            className="card history-card"
            data-incomplete={!p.ready || rowInvalid(row.id)}
            key={row.id}
          >
            <div className="card-heading">
              <strong>
                Sale {index + 1} · {r.lines.length} {r.lines.length === 1 ? 'item' : 'items'}
              </strong>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                aria-label={`Discard sale ${index + 1}`}
                onClick={() =>
                  onChange({ ...batch, rows: batch.rows.filter((v) => v.id !== row.id) })
                }
              >
                Discard
              </Button>
            </div>
            <div className="form-grid">
              <label className="field">
                <span>Sale date</span>
                <input
                  aria-label={`Sale date ${index + 1}`}
                  type={r.date?.includes('T') ? 'text' : 'date'}
                  value={r.date || ''}
                  disabled={busy}
                  onChange={(e) => {
                    const next = structuredClone(row);
                    next.facts.date = e.target.value;
                    next.matches.forEach((m) => {
                      if (m.newItem?.assumedAcquisitionDate) m.newItem.purchasedAt = e.target.value;
                    });
                    update(next);
                  }}
                />
              </label>
              <label className="field">
                <span>Marketplace</span>
                <select
                  value={r.marketplace || ''}
                  disabled={busy}
                  onChange={(e) =>
                    update({
                      ...row,
                      facts: {
                        ...r,
                        marketplace: (e.target.value || null) as typeof r.marketplace,
                      },
                    })
                  }
                >
                  <option value="">Choose marketplace</option>
                  {marketplaces.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Total recorded seller fees ($)</span>
                <HistoryMoney
                  label={`Seller fees ${index + 1}`}
                  value={r.fees === null ? null : r.fees + (r.processing ?? 0)}
                  disabled={busy}
                  onInvalid={(bad) => validation(`${row.id}:fees`, bad)}
                  onValue={(value) =>
                    update({ ...row, facts: { ...r, fees: value, processing: 0 } })
                  }
                />
              </label>
            </div>
            {r.lines.map((line, lineIndex) => {
              const match = row.matches[lineIndex],
                item = w.items.find((i) => i.id === match?.itemId);
              const candidates =
                p.candidatesByLine[lineIndex] || plausibleInventoryMatches(w, r, line);
              const unresolvedMatch =
                !match.itemId &&
                candidates.some((c) => !match.dismissedCandidateIds?.includes(c.item.id));
              const recorded =
                item && (item.cost > 0 || confirmedFreeInventory(w, item.id)) ? item.cost : null;
              const cost = match?.newItem ? match.newItem.cost : (match?.purchaseCost ?? recorded);
              return (
                <div className="history-item" key={match.newItem?.id || match.itemId || lineIndex}>
                  <div className="form-grid">
                    <label className="field">
                      <span>Item name</span>
                      <input
                        aria-label={`Item name ${index + 1}-${lineIndex + 1}`}
                        value={line.title || ''}
                        disabled={busy}
                        onChange={(e) => {
                          const next = structuredClone(row);
                          next.facts.lines[lineIndex].title = e.target.value;
                          update(next);
                        }}
                      />
                    </label>
                    <label className="field">
                      <span>Actual sale price ($)</span>
                      <HistoryMoney
                        label={`Sale price ${index + 1}-${lineIndex + 1}`}
                        value={line.price}
                        disabled={busy}
                        onInvalid={(bad) => validation(`${row.id}:price:${lineIndex}`, bad)}
                        onValue={(value) => {
                          const next = structuredClone(row);
                          next.facts.lines[lineIndex].price = value;
                          update(next);
                        }}
                      />
                    </label>
                    <label className="field">
                      <span>Purchase cost ($) · optional</span>
                      <HistoryMoney
                        label={`Purchase cost ${index + 1}-${lineIndex + 1}`}
                        value={cost}
                        disabled={busy}
                        readOnly={recorded !== null}
                        onInvalid={(bad) => validation(`${row.id}:cost:${lineIndex}`, bad)}
                        onValue={(value) => {
                          const next = structuredClone(row);
                          const m = next.matches[lineIndex];
                          if (m.newItem) m.newItem.cost = value;
                          else m.purchaseCost = value;
                          update(next);
                        }}
                      />
                    </label>
                    <label className="field">
                      <span>
                        {candidates.length && !match.itemId
                          ? 'Possible existing item'
                          : 'Physical inventory'}
                      </span>
                      <select
                        aria-label={`Inventory match ${index + 1}-${lineIndex + 1}`}
                        value={unresolvedMatch ? 'review' : match.itemId || 'new'}
                        disabled={busy}
                        onChange={(e) => {
                          const next = structuredClone(row),
                            m = next.matches[lineIndex];
                          if (e.target.value === 'new') {
                            m.itemId = null;
                            m.newItem = newInventoryDraft(line.sku, cost);
                            m.newItem.purchasedAt = r.date || '';
                            m.newItem.assumedAcquisitionDate = true;
                            m.dismissedCandidateIds = candidates.map((c) => c.item.id);
                          } else {
                            m.itemId = e.target.value;
                            m.newItem = null;
                            m.purchaseCost = undefined;
                          }
                          update(next);
                        }}
                      >
                        {unresolvedMatch && (
                          <option value="review" disabled>
                            Choose existing or a distinct new item
                          </option>
                        )}
                        <option value="new">Create a distinct physical item</option>
                        {w.items.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.sku} · {i.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {cost === null && (
                    <small className="warning-text">
                      Purchase cost unknown — profit remains incomplete.
                    </small>
                  )}
                  {match.newItem && (
                    <details>
                      <summary>
                        Purchase date ·{' '}
                        {match.newItem.assumedAcquisitionDate
                          ? 'unknown (sale-date placeholder)'
                          : 'provided'}
                      </summary>
                      <label className="field">
                        <span>Actual purchase date (optional)</span>
                        <input
                          value={match.newItem.purchasedAt}
                          disabled={busy}
                          onChange={(e) => {
                            const next = structuredClone(row);
                            next.matches[lineIndex].newItem!.purchasedAt = e.target.value;
                            next.matches[lineIndex].newItem!.assumedAcquisitionDate = false;
                            update(next);
                          }}
                        />
                      </label>
                    </details>
                  )}
                </div>
              );
            })}
            <details>
              <summary>Other recorded amounts · optional</summary>
              <div className="form-grid">
                {(
                  [
                    'processing',
                    'shipping',
                    'shippingCollected',
                    'discount',
                    'other',
                    'packaging',
                  ] as const
                ).map((field) => (
                  <label className="field" key={field}>
                    <span>
                      {
                        {
                          processing: 'Processing fee',
                          shipping: 'Seller shipping',
                          shippingCollected: 'Shipping received',
                          discount: 'Discount',
                          other: 'Other costs',
                          packaging: 'Packaging',
                        }[field]
                      }{' '}
                      ($)
                    </span>
                    <HistoryMoney
                      label={`${field} ${index + 1}`}
                      value={r[field] ?? null}
                      disabled={busy}
                      onInvalid={(bad) => validation(`${row.id}:${field}`, bad)}
                      onValue={(value) => update({ ...row, facts: { ...r, [field]: value } })}
                    />
                  </label>
                ))}
              </div>
              <small>
                Blank optional amounts are not recorded. Only record shipping received by you;
                buyer-paid platform charges are excluded.
              </small>
            </details>
            {!!historyWarnings(r).length && (
              <div className="error-box">
                {historyWarnings(r).map((warning, i) => (
                  <p key={i}>{warning}</p>
                ))}
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={row.acknowledgedWarnings}
                    disabled={busy}
                    onChange={(e) => update({ ...row, acknowledgedWarnings: e.target.checked })}
                  />
                  I reviewed these exceptions.
                </label>
              </div>
            )}
            {!p.ready && (
              <p className="error-text" role="status">
                {p.issues[0]}
              </p>
            )}
            <small>
              {p.ready && !rowInvalid(row.id) ? 'Ready to import' : 'Needs review'} ·{' '}
              {money(r.lines.reduce((n, l) => n + (l.price ?? 0), 0))} merchandise value
            </small>
          </article>
        );
      })}
      <div className="history-approval-bar">
        <strong>
          {ready.length} {ready.length === 1 ? 'sale' : 'sales'} ready ·{' '}
          {previews.filter((p) => !p.ready || rowInvalid(p.row.id)).length} unresolved
        </strong>
        <Button
          disabled={busy || stale || !ready.length}
          onClick={() => onApprove(ready.map((p) => p.row.id))}
        >
          {busy ? 'Saving…' : `Approve All (${ready.length})`}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel review
        </Button>
      </div>
    </section>
  );
}

function HistoryMoney({
  value,
  label,
  onValue,
  onInvalid,
  disabled,
  readOnly = false,
}: {
  value: number | null;
  label: string;
  onValue: (value: number | null) => void;
  onInvalid: (invalid: boolean) => void;
  disabled: boolean;
  readOnly?: boolean;
}) {
  const [raw, setRaw] = useState(value === null ? '' : String(value / 100));
  const [error, setError] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const initialValidation = useRef(onInvalid);
  useEffect(() => {
    initialValidation.current(false);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (document.activeElement !== ref.current) setRaw(value === null ? '' : String(value / 100));
    }, 0);
    return () => clearTimeout(timer);
  }, [value]);
  return (
    <>
      <input
        ref={ref}
        aria-label={label}
        aria-invalid={!!error}
        placeholder="Unknown"
        inputMode="decimal"
        value={raw}
        disabled={disabled}
        readOnly={readOnly}
        onChange={(e) => {
          setRaw(e.target.value);
          const parsed = listingAmount(e.target.value);
          setError(parsed.error || '');
          onInvalid(!!parsed.error);
          if (!parsed.error) onValue(parsed.value);
        }}
      />
      {error && (
        <small role="alert" className="error-text">
          {error}
        </small>
      )}
    </>
  );
}
