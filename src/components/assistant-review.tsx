'use client';
import { Trash2 } from 'lucide-react';
import { LifecycleFields, eventNames } from './assistant-lifecycle-fields';
import { blockingWarnings } from '@/lib/assistant/warnings';
import { isLifecycle } from '@/lib/assistant/lifecycle';
import { removeDraft } from '@/lib/assistant/drafts';
import { useState } from 'react';
import { ListingFields } from './assistant-listing-fields';
import { ClothingPreview, ClothingEditor } from './assistant-clothing';
import { correctedMarketplace } from '@/lib/assistant/vision';
import { previewBatch, saleAmounts, amountLabels, type Preview } from '@/lib/assistant/planner';
import { matchInventory } from '@/lib/assistant/matching';
import type { DraftBatch, DraftRow } from '@/lib/assistant/drafts';
import { useWorkspace } from '@/lib/use-workspace';
import { money, parseMoney } from '@/lib/money';
import type { Screenshot } from '@/lib/assistant/schema';
import { marketplaces } from '@/lib/model';
import { Badge, ItemPhoto } from './shared';
import { Button } from './ui/button';
export function AssistantReview({
  batch,
  onChange,
  onApprove,
  onCancel,
  busy,
  onView,
  sourceUrls,
}: {
  sourceUrls?: ReadonlyMap<string, string>;
  batch: DraftBatch;
  onChange: (b: DraftBatch) => void;
  onApprove: (ids: string[]) => void;
  onCancel: () => void;
  busy: boolean;
  onView: (kind: 'order' | 'listing', id: string) => void;
}) {
  const { w, refresh } = useWorkspace();
  const previews = previewBatch(w, batch);
  const ready = previews.filter((p) => p.row.included && p.ready);
  const included = previews.filter((p) => p.row.included);
  const [confirmClear, setConfirmClear] = useState(false);
  const stale = batch.revision !== w.revision;
  function change(row: DraftRow) {
    onChange({ ...batch, rows: batch.rows.map((r) => (r.id === row.id ? row : r)) });
  }
  return (
    <section aria-label="Import batch review" className="assistant-review">
      <h3>{batch.rows.length} records found</h3>
      {batch.screenshots.flatMap((s) =>
        (s.extraction.notes || []).map((note, i) => (
          <p className="hint" key={`${s.hash}-${i}`}>
            {note}
          </p>
        )),
      )}
      {batch.context && batch.rows.length > 1 && (
        <p className="hint">
          Choose the listing card for the selected inventory item. Other cards remain excluded; none
          will create new inventory.
        </p>
      )}
      {previews.map((p, index) => (
        <ReviewRow
          key={p.row.id}
          preview={p}
          source={batch.screenshots.find((s) => s.hash === p.row.sourceHash)}
          contextItemId={batch.context?.itemId}
          imageUrl={sourceUrls?.get(p.row.sourceHash)}
          index={index}
          onChange={change}
          onRemove={() => onChange(removeDraft(batch, p.row.id))}
          busy={busy}
          onView={onView}
        />
      ))}
      <div className="assistant-batch-totals">
        <strong>
          {ready.length} ready · {included.length - ready.length} unresolved ·{' '}
          {previews.length - included.length} excluded
        </strong>
        <p>
          Confirmed sales revenue: {money(ready.reduce((n, p) => n + (p.totals?.revenue || 0), 0))}
        </p>
        <p>
          Ready sales purchase costs:{' '}
          {money(
            ready
              .filter((p) => p.row.facts.kind === 'sale')
              .reduce((n, p) => n + p.costs.reduce<number>((a, c) => a + (c ?? 0), 0), 0),
          )}
        </p>
        <p>Ready sales profit: {money(ready.reduce((n, p) => n + (p.totals?.profit || 0), 0))}</p>
        {stale && (
          <div className="error-box">
            <p>Your workspace changed. Review the current preview before approving.</p>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onChange({ ...batch, revision: w.revision })}
            >
              Use updated preview
            </Button>
          </div>
        )}
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void refresh()}>
          Refresh workspace
        </Button>
        <small>Only included, ready records will be saved. Unresolved records stay pending.</small>
      </div>
      <div className="actions assistant-approval-actions">
        <Button
          disabled={busy || stale || !ready.length}
          onClick={() => onApprove(ready.map((p) => p.row.id))}
        >
          {busy ? 'Saving…' : `Approve All Ready (${ready.length})`}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => setConfirmClear(true)}>
          Clear All
        </Button>
        {confirmClear && (
          <div className="assistant-clear-confirm" role="alert">
            <p>Discard all pending drafts? Saved inventory and accounting records stay intact.</p>
            <Button variant="outline" disabled={busy} onClick={onCancel}>
              Discard pending drafts
            </Button>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>
              Keep drafts
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
function AmountField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="field">
      <span>{label} ($)</span>
      <input
        type="number"
        min="0"
        step="0.01"
        inputMode="decimal"
        value={value === null ? '' : value / 100}
        placeholder="Unknown"
        onChange={(e) => {
          try {
            onChange(e.target.value === '' ? null : parseMoney(e.target.value));
          } catch {
            onChange(null);
          }
        }}
      />
    </label>
  );
}
function ReviewRow({
  preview: p,
  source,
  imageUrl,
  contextItemId,
  index,
  onChange,
  busy,
  onView,
  onRemove,
}: {
  onRemove: () => void;
  preview: Preview;
  source?: Screenshot;
  imageUrl?: string;
  contextItemId?: string;
  index: number;
  onChange: (r: DraftRow) => void;
  busy: boolean;
  onView: (kind: 'order' | 'listing', id: string) => void;
}) {
  const { w } = useWorkspace();
  const row = p.row,
    r = row.facts;
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState('');
  const update = (facts: Partial<DraftRow['facts']>) =>
    onChange({ ...row, facts: { ...r, ...facts } });
  const factRecord = JSON.stringify(r);
  return (
    <article className="assistant-extraction">
      <div className="assistant-row-heading">
        <label>
          <input
            type="checkbox"
            checked={row.included}
            disabled={busy}
            onChange={(e) => onChange({ ...row, included: e.target.checked })}
          />
          <strong>
            {index + 1}.{' '}
            {r.lines
              .map(
                (l) =>
                  l.title ||
                  (isLifecycle(r.kind)
                    ? `Existing order ${r.externalOrderId || row.orderId || ''}`
                    : 'Item details needed'),
              )
              .join(', ') ||
              `Existing order ${r.externalOrderId || row.orderId || '— confirm identity'}`}
          </strong>
        </label>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Remove pending record ${index + 1}`}
          disabled={busy}
          onClick={onRemove}
        >
          <Trash2 size={16} />
        </Button>
        <Badge tone={p.ready ? 'green' : 'amber'}>{p.ready ? 'Ready' : 'Needs review'}</Badge>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(!editing)}>
          {editing ? 'Done' : 'Edit'}
        </Button>
      </div>
      <LifecycleFields
        relatedOrder={p.relatedOrder}
        row={row}
        w={w}
        busy={busy}
        onChange={onChange}
      />
      <p>
        {r.marketplace || 'Marketplace unknown'} · {r.event ? eventNames[r.event.type] : r.kind} ·{' '}
        {r.date || 'Date unknown'}
      </p>
      {r.marketplaceIdentification && (
        <details>
          <summary>
            Marketplace:{' '}
            {r.marketplaceIdentification.confirmedByUser
              ? 'confirmed by you'
              : r.marketplaceIdentification.confidence}
          </summary>
          {r.marketplaceIdentification.evidence.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
          {!r.marketplace && <p className="hint">Confirm the marketplace in Edit.</p>}
        </details>
      )}
      {r.kind === 'listing' && !r.date && (
        <small>
          Original screenshot date unknown; existing listing dates are preserved. New listings use
          approval time.
        </small>
      )}
      {r.lines.map((line, i) => (
        <div key={i}>
          <ClothingPreview line={line} source={source} url={imageUrl} />
          {r.kind === 'listing' && (
            <ListingFields
              row={row}
              index={i}
              w={w}
              busy={busy}
              previewCost={p.costs[i] ?? null}
              onChange={onChange}
            />
          )}
        </div>
      ))}
      <div className="actions">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => setEditing(true)}>
          Match Existing Item
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || !row.included}
          onClick={() => onChange({ ...row, included: false })}
        >
          Skip
        </Button>
      </div>
      {contextItemId && !row.matches.some((m) => m.itemId === contextItemId) && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy || r.kind !== 'listing' || r.lines.length !== 1}
          onClick={() =>
            onChange({
              ...row,
              included: true,
              matches: [{ itemId: contextItemId, newItem: null, confirmZeroCost: false }],
            })
          }
        >
          Link this listing to selected item
        </Button>
      )}
      {!isLifecycle(r.kind) &&
        row.matches.map((m, i) => {
          const item = w.items.find((v) => v.id === m.itemId);
          return (
            <div className="detail-row" key={i}>
              {item && <ItemPhoto item={item} />}
              <span>
                {item
                  ? `Inventory: ${item.title} · ${item.sku}`
                  : m.newItem
                    ? 'New inventory proposed'
                    : 'Inventory match needed'}
                <small>
                  Purchase cost ({item ? 'inventory' : 'required'}):{' '}
                  {p.costs[i] === null || p.costs[i] === undefined ? 'Unknown' : money(p.costs[i])}
                </small>
              </span>
            </div>
          );
        })}
      {!isLifecycle(r.kind) && (
        <p>
          {r.kind === 'listing'
            ? 'Asking price'
            : r.kind === 'sale'
              ? 'Sale price'
              : 'Observed price (event unconfirmed)'}
          :{' '}
          {r.lines.some((l) => l.price === null)
            ? 'Unknown'
            : money(r.lines.reduce((n, l) => n + l.price!, 0))}
        </p>
      )}
      {r.kind === 'sale' && !editing && (
        <div className="assistant-sale-inline">
          {r.lines.map((line, i) => (
            <AmountField
              key={i}
              label={`Sale price, item ${i + 1}`}
              value={line.price}
              onChange={(price) =>
                update({ lines: r.lines.map((l, j) => (j === i ? { ...l, price } : l)) })
              }
            />
          ))}
          <details>
            <summary>Edit selling expenses</summary>
            {saleAmounts.map((key) => (
              <AmountField
                key={key}
                label={amountLabels[key]}
                value={r[key]}
                onChange={(value) => update({ [key]: value })}
              />
            ))}
          </details>
        </div>
      )}
      {r.kind === 'sale' && (
        <>
          <p>
            Fees:{' '}
            {r.fees === null || r.processing === null ? 'Unknown' : money(r.fees + r.processing)} ·
            Seller shipping: {r.shipping === null ? 'Unknown' : money(r.shipping)}
          </p>
          <strong>
            {p.totals
              ? `${p.ready ? 'Net profit' : 'Provisional profit'}: ${money(p.totals.profit)}`
              : 'Profit pending missing information'}
          </strong>
        </>
      )}
      {p.duplicateId && (p.duplicateKind === 'order' || p.duplicateKind === 'listing') && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => onView(p.duplicateKind as 'order' | 'listing', p.duplicateId!)}
        >
          View existing {p.duplicateKind}
        </Button>
      )}
      <details open={editing || undefined}>
        <summary>Details{p.issues.length ? ` · ${p.issues.length} to review` : ''}</summary>
        {p.issues.map((issue, i) => (
          <p className="hint" key={i}>
            {issue}
          </p>
        ))}
        {r.warnings.map((warning, i) => (
          <p className="error-text" key={i}>
            {warning}
          </p>
        ))}
        {(r.kind === 'sale' || r.kind === 'refund' || (r.kind === 'return' && row.applyRefund)) &&
          !!blockingWarnings(r).length && (
            <label className="check-row">
              <input
                type="checkbox"
                checked={row.acknowledgedWarnings}
                disabled={busy}
                onChange={(e) => onChange({ ...row, acknowledgedWarnings: e.target.checked })}
              />
              I reviewed these extraction warnings and corrected the details.
            </label>
          )}
      </details>
      {editing && !isLifecycle(r.kind) && (
        <fieldset disabled={busy} className="assistant-edit-fields">
          <div className="form-grid">
            {r.kind !== 'listing' && (
              <label className="field">
                <span>Marketplace</span>
                <select
                  value={r.marketplace || ''}
                  onChange={(e) => {
                    const marketplace = (e.target.value || null) as typeof r.marketplace;
                    update({
                      marketplace,
                      marketplaceIdentification: correctedMarketplace(
                        r.marketplaceIdentification,
                        marketplace,
                      ),
                    });
                  }}
                >
                  <option value="">Choose marketplace</option>
                  {marketplaces.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="field">
              <span>Currency</span>
              <select
                value={r.currency || ''}
                onChange={(e) => update({ currency: e.target.value || null })}
              >
                <option value="">Unconfirmed</option>
                {r.currency && r.currency !== 'USD' && <option>{r.currency}</option>}
                <option>USD</option>
              </select>
            </label>
            <label className="field">
              <span>Date (workspace timezone)</span>
              <input
                value={r.date || ''}
                placeholder="YYYY-MM-DD"
                onChange={(e) => update({ date: e.target.value || null })}
              />
            </label>
            <label className="field">
              <span>Screenshot status</span>
              <select
                value={r.status}
                onChange={(e) => update({ status: e.target.value as typeof r.status })}
              >
                {['completed', 'active', 'offer', 'pending', 'refunded', 'unknown'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>External order ID</span>
              <input
                value={r.externalOrderId || ''}
                onChange={(e) => update({ externalOrderId: e.target.value || null })}
              />
            </label>
          </div>
          <label className="field">
            <span>Search inventory</span>
            <input
              value={search}
              placeholder="Title, brand, SKU or size"
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {r.lines.map((line, i) => {
            const candidates = matchInventory(w, r, line);
            const inventory = contextItemId
              ? w.items.filter((v) => v.id === contextItemId)
              : search
                ? w.items
                    .filter((v) =>
                      `${v.title} ${v.sku} ${v.brand} ${v.size}`
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                    )
                    .slice(0, 30)
                : candidates.map((c) => c.item);
            const selected = w.items.find((v) => v.id === row.matches[i]?.itemId);
            if (selected && !inventory.some((v) => v.id === selected.id))
              inventory.unshift(selected);
            return (
              <div className="assistant-line-edit" key={i}>
                <strong>
                  Line {i + 1}: {line.title || 'Untitled item'}
                </strong>
                <label className="field">
                  <span>Inventory match, line {i + 1}</span>
                  <select
                    value={row.matches[i]?.itemId || ''}
                    onChange={(e) =>
                      onChange({
                        ...row,
                        matches: row.matches.map((m, j) =>
                          j === i
                            ? {
                                ...m,
                                costOverride: undefined,
                                costInput: undefined,
                                costCorrection: false,
                                purchaseCost: undefined,
                                itemId: e.target.value || null,
                                newItem: null,
                                confirmZeroCost: false,
                              }
                            : m,
                        ),
                      })
                    }
                  >
                    <option value="">Leave pending / choose an item</option>
                    {inventory.map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.sku} · {item.title} · {item.brand} · {item.size} · {money(item.cost)}
                      </option>
                    ))}
                  </select>
                </label>
                {!contextItemId &&
                  !search &&
                  candidates
                    .filter((c) => !c.exact)
                    .slice(0, 3)
                    .map((c) => (
                      <button
                        type="button"
                        className="assistant-candidate"
                        key={c.item.id}
                        onClick={() =>
                          onChange({
                            ...row,
                            matches: row.matches.map((m, j) =>
                              j === i
                                ? {
                                    ...m,
                                    costOverride: undefined,
                                    costInput: undefined,
                                    costCorrection: false,
                                    purchaseCost: undefined,
                                    itemId: c.item.id,
                                    newItem: null,
                                    confirmZeroCost: false,
                                  }
                                : m,
                            ),
                          })
                        }
                      >
                        <ItemPhoto item={c.item} />
                        <span>
                          {c.item.title}
                          <small>
                            {c.item.brand} · {c.item.size} · Purchase {money(c.item.cost)}
                            <br />
                            {w.listings
                              .filter((l) => l.itemId === c.item.id)
                              .map((l) => `${l.marketplace} ${money(l.price)} (${l.status})`)
                              .join(' · ')}
                          </small>
                        </span>
                      </button>
                    ))}
                {selected?.cost === 0 && r.kind !== 'listing' && (
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={row.matches[i].confirmZeroCost}
                      onChange={(e) =>
                        onChange({
                          ...row,
                          matches: row.matches.map((m, j) =>
                            j === i ? { ...m, confirmZeroCost: e.target.checked } : m,
                          ),
                        })
                      }
                    />
                    I confirm this item was acquired for $0.
                  </label>
                )}
                {!contextItemId && !selected && !row.matches[i].newItem && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      onChange({
                        ...row,
                        matches: row.matches.map((m, j) =>
                          j === i
                            ? {
                                ...m,
                                itemId: null,
                                newItem: {
                                  id: crypto.randomUUID(),
                                  sku: line.sku || `AI-${row.id.slice(0, 8)}-${i + 1}`,
                                  cost: m.purchaseCost ?? null,
                                  purchasedAt: '',
                                  confirmedDistinct: false,
                                },
                              }
                            : m,
                        ),
                      })
                    }
                  >
                    Create new physical item
                  </Button>
                )}
                {row.matches[i].newItem && (
                  <div className="assistant-new-item">
                    <strong>New inventory · Not saved</strong>
                    <div className="form-grid">
                      <label className="field">
                        <span>New SKU, line {i + 1}</span>
                        <input
                          value={row.matches[i].newItem!.sku}
                          maxLength={500}
                          onChange={(e) =>
                            onChange({
                              ...row,
                              matches: row.matches.map((m, j) =>
                                j === i
                                  ? { ...m, newItem: { ...m.newItem!, sku: e.target.value } }
                                  : m,
                              ),
                            })
                          }
                        />
                      </label>
                      {r.kind !== 'listing' && (
                        <AmountField
                          label={`Purchase cost, line ${i + 1}`}
                          value={row.matches[i].newItem!.cost}
                          onChange={(cost) =>
                            onChange({
                              ...row,
                              matches: row.matches.map((m, j) =>
                                j === i ? { ...m, newItem: { ...m.newItem!, cost } } : m,
                              ),
                            })
                          }
                        />
                      )}
                      <label className="field">
                        <span>Acquisition date, line {i + 1}</span>
                        <input
                          type="date"
                          value={row.matches[i].newItem!.purchasedAt}
                          onChange={(e) =>
                            onChange({
                              ...row,
                              matches: row.matches.map((m, j) =>
                                j === i
                                  ? {
                                      ...m,
                                      newItem: { ...m.newItem!, purchasedAt: e.target.value },
                                    }
                                  : m,
                              ),
                            })
                          }
                        />
                      </label>
                    </div>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={row.matches[i].newItem!.confirmedDistinct}
                        onChange={(e) =>
                          onChange({
                            ...row,
                            matches: row.matches.map((m, j) =>
                              j === i
                                ? {
                                    ...m,
                                    newItem: { ...m.newItem!, confirmedDistinct: e.target.checked },
                                  }
                                : m,
                            ),
                          })
                        }
                      />
                      I checked inventory and confirm this is a new physical item.
                    </label>
                  </div>
                )}
                {selected && !contextItemId && r.kind !== 'listing' && (
                  <details>
                    <summary>Correct stored purchase cost</summary>
                    <p className="hint">
                      Currently {money(selected.cost)} in inventory. An approved correction changes
                      this item’s acquisition cost; previous sale cost snapshots remain unchanged.
                    </p>
                    <AmountField
                      label={`Corrected purchase cost, line ${i + 1}`}
                      value={row.matches[i].costOverride ?? null}
                      onChange={(costOverride) =>
                        onChange({
                          ...row,
                          matches: row.matches.map((m, j) =>
                            j === i ? { ...m, costOverride: costOverride ?? undefined } : m,
                          ),
                        })
                      }
                    />
                  </details>
                )}
                {r.kind !== 'listing' && (
                  <>
                    <details>
                      <summary>Item attributes and listing identifiers</summary>
                      <div className="form-grid">
                        {(
                          [
                            'title',
                            'brand',
                            'size',
                            'color',
                            'category',
                            'condition',
                            'description',
                            'sku',
                            'listingId',
                            'url',
                          ] as const
                        ).map((key) => (
                          <label className="field" key={key}>
                            <span>
                              {key === 'listingId'
                                ? 'Listing ID'
                                : key === 'url'
                                  ? 'Listing URL'
                                  : key}
                              , line {i + 1}
                            </span>
                            <input
                              value={line[key] || ''}
                              maxLength={key === 'url' ? 2000 : 500}
                              onChange={(e) =>
                                update({
                                  lines: r.lines.map((l, j) =>
                                    j === i ? { ...l, [key]: e.target.value || null } : l,
                                  ),
                                })
                              }
                            />
                          </label>
                        ))}
                      </div>
                    </details>
                    <ClothingEditor
                      line={line}
                      onChange={(value) =>
                        update({ lines: r.lines.map((l, j) => (j === i ? value : l)) })
                      }
                    />
                    <AmountField
                      label={`Sale price, line ${i + 1}`}
                      value={line.price}
                      onChange={(price) =>
                        update({ lines: r.lines.map((l, j) => (j === i ? { ...l, price } : l)) })
                      }
                    />
                  </>
                )}
              </div>
            );
          })}
          {r.kind === 'sale' && (
            <>
              <div className="form-grid">
                {saleAmounts.map((key) => (
                  <AmountField
                    key={key}
                    label={amountLabels[key]}
                    value={r[key]}
                    onChange={(value) => update({ [key]: value })}
                  />
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  update(
                    Object.fromEntries(saleAmounts.filter((k) => r[k] === null).map((k) => [k, 0])),
                  )
                }
              >
                Confirm all missing selling amounts are $0
              </Button>
              <p className="hint">
                Use only when you know these amounts are zero. Buyer-paid platform shipping is not
                money received by you.
              </p>
            </>
          )}
        </fieldset>
      )}
      <details>
        <summary>Extraction and corrections</summary>
        <small>
          {row.sourceHash === 'conversation'
            ? 'Source: your explicit request for an existing order.'
            : `Source screenshot hash: ${row.sourceHash.slice(0, 12)}…`}{' '}
          Inventory cost is retrieved separately.
        </small>
        {source?.reference && (
          <a
            className="text-link"
            href={`/api/photos?path=${encodeURIComponent(source.reference)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View private source screenshot
          </a>
        )}
        <small>Original screenshot extraction</small>
        <pre className="assistant-source">
          {row.sourceHash === 'conversation'
            ? row.intent
            : JSON.stringify(source?.extraction.records[row.recordIndex] || null)}
        </pre>
        <small>Current corrected facts</small>
        <pre className="assistant-source">{factRecord}</pre>
      </details>
    </article>
  );
}
