'use client';
import { Trash2 } from 'lucide-react';
import { useWorkspace } from '@/lib/use-workspace';
import { localDay } from '@/lib/dates';
import { marketplaces } from '@/lib/model';
import { confirmedFreeInventory } from '@/lib/assistant/listing-review';
import { saleAmounts, amountLabels, type Preview } from '@/lib/assistant/planner';
import type { DraftRow } from '@/lib/assistant/drafts';
import { money } from '@/lib/money';
import { Badge, ItemPhoto } from './shared';
import { Button } from './ui/button';
import { HistoryMoney } from './history-review';

export function ConversationCard({
  preview: p,
  onChange,
  onRemove,
  busy,
}: {
  preview: Preview;
  onChange: (row: DraftRow) => void;
  onRemove: () => void;
  busy: boolean;
}) {
  const { w } = useWorkspace(),
    row = p.row,
    r = row.facts,
    match = row.matches[0];
  const item = w.items.find((i) => i.id === match?.itemId);
  const update = (facts: Partial<typeof r>) => onChange({ ...row, facts: { ...r, ...facts } });
  const price = (value: number | null, invalid = false) =>
    onChange({
      ...row,
      matches: row.matches.map((m, i) =>
        i === 0 ? { ...m, priceInput: invalid ? 'invalid' : undefined } : m,
      ),
      facts: { ...r, lines: r.lines.map((l, i) => (i === 0 ? { ...l, price: value } : l)) },
    });
  const cost = (value: number | null, invalid = false) =>
    onChange({
      ...row,
      matches: row.matches.map((m, i) =>
        i === 0
          ? {
              ...m,
              costInput: invalid ? 'invalid' : value === null ? '' : String(value / 100),
              costOverride: value === null ? undefined : value,
              costCorrection: value !== null,
            }
          : m,
      ),
    });
  return (
    <article
      className="card conversation-card"
      tabIndex={-1}
      data-review-incomplete={row.included && !p.ready}
    >
      <div className="conversation-item-heading">
        {item && <ItemPhoto item={item} />}
        <div>
          <strong>{item?.title || 'Choose an inventory item'}</strong>
          <small>
            {item?.sku} ·{' '}
            {row.inventoryStage
              ? row.inventoryStage === 'archived'
                ? 'Archive unsold item'
                : 'Move to Unlisted'
              : 'Record a sale'}
          </small>
        </div>
        <Badge tone={p.ready ? 'green' : 'amber'}>{p.ready ? 'Ready' : 'Needs information'}</Badge>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          aria-label="Discard pending text proposal"
          onClick={onRemove}
        >
          <Trash2 size={16} />
        </Button>
      </div>
      {row.inventoryStage ? (
        <>
          <p>
            This changes Thrift Log records only. It does not remove or update external marketplace
            listings.
          </p>
          {!!w.listings.filter((l) => l.itemId === item?.id && l.status === 'Active').length &&
            !row.confirmStatusImpact && (
              <Button
                variant="outline"
                disabled={busy}
                data-review-missing="true"
                onClick={() => onChange({ ...row, confirmStatusImpact: true })}
              >
                Confirm ending active Thrift Log listings
              </Button>
            )}
        </>
      ) : (
        <fieldset disabled={busy} className="conversation-sale-fields">
          <div className="form-grid">
            <label className="field">
              <span>Actual sale price ($)</span>
              <HistoryMoney
                label="Text sale price"
                value={r.lines[0]?.price ?? null}
                disabled={busy}
                missing={r.lines[0]?.price == null}
                onValue={(value) => price(value)}
                onInvalid={(bad) => {
                  if (bad) price(null, true);
                }}
              />
            </label>
            <label className="field">
              <span>Sale date</span>
              <input
                aria-label="Text sale date"
                type="date"
                value={r.date?.slice(0, 10) || ''}
                data-review-missing={!r.date}
                onChange={(e) => update({ date: e.target.value || null })}
              />
            </label>
            <label className="field">
              <span>Marketplace</span>
              <select
                aria-label="Text sale marketplace"
                value={r.marketplace || ''}
                data-review-missing={!r.marketplace}
                onChange={(e) =>
                  update({ marketplace: (e.target.value || null) as typeof r.marketplace })
                }
              >
                <option value="">Choose marketplace</option>
                {marketplaces.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Total seller fees ($)</span>
              <HistoryMoney
                label="Text seller fees"
                value={r.fees === null ? null : r.fees + (r.processing ?? 0)}
                disabled={busy}
                missing={r.fees === null}
                onValue={(value) => update({ fees: value, processing: 0 })}
                onInvalid={(bad) => {
                  if (bad) update({ fees: null });
                }}
              />
            </label>
          </div>
          {!r.date && (
            <div className="actions">
              <small>When did it sell? The listing date is separate.</small>
              {['Today', 'Yesterday'].map((label) => (
                <Button
                  key={label}
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const d = new Date(`${localDay(new Date(), w.settings.timezone)}T12:00:00Z`);
                    if (label === 'Yesterday') d.setUTCDate(d.getUTCDate() - 1);
                    update({ date: d.toISOString().slice(0, 10) });
                  }}
                >
                  {label}
                </Button>
              ))}
            </div>
          )}
          <div className="conversation-cost">
            <span>Purchase cost</span>
            {p.costs[0] == null || match?.costOverride !== undefined ? (
              <label className="field">
                <span className="sr-only">Enter known purchase cost</span>
                <HistoryMoney
                  label="Text purchase cost"
                  value={match?.costOverride ?? null}
                  disabled={busy}
                  missing={p.costs[0] == null}
                  onValue={(value) => cost(value)}
                  onInvalid={(bad) => {
                    if (bad) cost(null, true);
                  }}
                />
              </label>
            ) : (
              <strong>
                {money(p.costs[0])} <small>from inventory</small>
              </strong>
            )}
          </div>
          <details>
            <summary>Other selling amounts</summary>
            <div className="form-grid">
              {saleAmounts
                .filter((key) => !['fees', 'processing'].includes(key))
                .map((key) => (
                  <label className="field" key={key}>
                    <span>{amountLabels[key]} ($)</span>
                    <HistoryMoney
                      label={`Text ${key}`}
                      value={r[key]}
                      disabled={busy}
                      onValue={(value) => update({ [key]: value })}
                      onInvalid={(bad) => {
                        if (bad) update({ [key]: null });
                      }}
                    />
                  </label>
                ))}
            </div>
          </details>
          {saleAmounts.some((key) => key !== 'fees' && r[key] === null) && (
            <div className="conversation-zero-confirm">
              <small>
                Only confirm this if there were no additional processing fees, seller shipping,
                shipping received, discounts, refunds or other costs.
              </small>
              <Button
                variant="outline"
                onClick={() =>
                  update(
                    Object.fromEntries(
                      saleAmounts
                        .filter((key) => key !== 'fees' && r[key] === null)
                        .map((key) => [key, 0]),
                    ),
                  )
                }
              >
                No other selling amounts ($0)
              </Button>
            </div>
          )}
          <details>
            <summary>Change matched inventory item</summary>
            <select
              aria-label="Text inventory match"
              value={item?.id || ''}
              onChange={(e) => {
                const target = w.items.find((i) => i.id === e.target.value);
                if (!target) return;
                onChange({
                  ...row,
                  matches: [
                    {
                      itemId: target.id,
                      newItem: null,
                      confirmZeroCost: confirmedFreeInventory(w, target.id),
                    },
                  ],
                  facts: {
                    ...r,
                    lines: [
                      {
                        ...r.lines[0],
                        title: target.title,
                        sku: target.sku,
                        brand: target.brand,
                        size: target.size,
                        color: target.color,
                        category: target.category,
                        condition: target.condition,
                      },
                    ],
                  },
                });
              }}
            >
              <option value="">Choose inventory</option>
              {w.items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.title} · {i.sku}
                </option>
              ))}
            </select>
          </details>
          <small>
            {p.ready && p.totals
              ? `Validated profit: ${money(p.totals.profit)}`
              : 'Profit awaits confirmed costs and selling amounts.'}
          </small>
        </fieldset>
      )}
      {!!p.issues.length && (
        <p className="error-text" data-review-issues tabIndex={-1}>
          {p.issues[0]}
        </p>
      )}
    </article>
  );
}
