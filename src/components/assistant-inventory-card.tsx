'use client';
import { Trash2, Package } from 'lucide-react';
import { useWorkspace } from '@/lib/use-workspace';
import { inventoryStageNames, inventoryStages } from '@/lib/pipeline';
import { money } from '@/lib/money';
import { inventoryCostKnown } from '@/lib/purchase-costs';
import { localDay, zoneMidnight } from '@/lib/dates';
import { currentOrderTotals, returnedItemIds } from '@/lib/ledger';
import { lineFulfillment } from '@/lib/fulfillment-state';
import type { DraftRow } from '@/lib/assistant/drafts';
import type { Preview } from '@/lib/assistant/planner';
import { HistoryMoney } from './history-review';
import { Badge, ItemPhoto } from './shared';
import { Button } from './ui/button';
export function InventoryProposalCard({
  preview: p,
  onChange,
  onRemove,
  busy,
  pendingTitle,
}: {
  preview: Preview;
  onChange: (row: DraftRow) => void;
  onRemove: () => void;
  busy: boolean;
  pendingTitle?: string;
}) {
  const { w } = useWorkspace(),
    row = p.row,
    a = row.inventoryChange!;
  const item = w.items.find((i) => i.id === a.itemId);
  const update = (change: Partial<typeof a>) =>
    onChange({ ...row, inventoryChange: { ...a, ...change } });
  const clearError = (field: string) => a.invalidFields.filter((f) => f !== field);
  const invalid = (field: string, bad: boolean) => {
    if (a.invalidFields.includes(field) === bad) return;
    update({ invalidFields: bad ? [...a.invalidFields, field] : clearError(field) });
  };
  const patch = (key: keyof typeof a.patch, value: string | number) => {
    const changed = { ...a.patch, [key]: value };
    if (key === 'sku' && value === '' && a.action === 'create') delete changed.sku;
    update({ patch: changed });
  };
  const title = a.patch.title || item?.title || pendingTitle || 'New inventory item';
  const selected = new Set(a.move?.items.map((r) => r.itemId));
  const orders = a.move
    ? w.orders.filter(
        (o) =>
          o.status === 'Completed' &&
          o.lines.some((l) => selected.has(l.itemId) && !returnedItemIds(w, o.id).has(l.itemId)),
      )
    : [];
  const reversingSale =
    !!a.move && ['unlisted', 'for-sale'].includes(a.move.destination) && orders.length > 0;
  const reversingShipping =
    a.move?.destination === 'sold' &&
    orders.some((o) =>
      o.lines.some(
        (l) => selected.has(l.itemId) && lineFulfillment(o, l.itemId).status !== 'Unfulfilled',
      ),
    );
  const endingListings =
    !!a.move &&
    ['unlisted', 'archived'].includes(a.move.destination) &&
    w.listings.some((l) => selected.has(l.itemId) && l.status === 'Active');
  const consequences = reversingSale || reversingShipping || endingListings;
  const reversedRevenue = reversingSale
    ? orders.reduce((sum, o) => sum + currentOrderTotals(w, o).revenue, 0)
    : 0;
  const acquired = a.patch.purchasedAt ?? item?.purchasedAt ?? '';
  const acquiredDay = acquired.includes('T')
    ? localDay(new Date(acquired), w.settings.timezone)
    : acquired;

  return (
    <article
      className="card conversation-card inventory-proposal"
      tabIndex={-1}
      data-review-incomplete={row.included && !p.ready}
    >
      <div className="conversation-item-heading">
        {item ? <ItemPhoto item={item} /> : <Package size={24} />}
        <div>
          <strong>{title}</strong>
          <small>
            {a.action === 'create'
              ? 'Create inventory'
              : a.action === 'cost'
                ? 'Update purchase cost'
                : a.move
                  ? `Move ${a.move.items.length} item${a.move.items.length === 1 ? '' : 's'} to ${inventoryStageNames[a.move.destination]}`
                  : 'Edit inventory details'}
          </small>
        </div>
        <Badge tone={p.ready ? 'green' : 'amber'}>{p.ready ? 'Ready' : 'Needs information'}</Badge>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          aria-label="Discard pending inventory change"
          onClick={onRemove}
        >
          <Trash2 size={16} />
        </Button>
      </div>
      <fieldset disabled={busy} className="conversation-sale-fields">
        {a.action !== 'stage' && (
          <div className="form-grid">
            {(a.action === 'create' || a.action === 'edit') && (
              <label className="field">
                <span>Item name</span>
                <input
                  aria-label="Inventory proposal name"
                  value={a.patch.title ?? item?.title ?? ''}
                  data-review-missing={!(a.patch.title ?? item?.title ?? '').trim()}
                  onChange={(e) => patch('title', e.target.value)}
                />
              </label>
            )}
            <label className="field">
              <span>
                Purchase cost ($){a.action === 'edit' ? ' · leave unchanged unless correcting' : ''}
              </span>
              <HistoryMoney
                label="Inventory proposal purchase cost"
                value={
                  a.purchaseCost ??
                  (a.action === 'edit' && item && inventoryCostKnown(w, item.id) ? item.cost : null)
                }
                missing={
                  (a.action === 'create' && a.purchaseCost === null) ||
                  a.invalidFields.includes('purchaseCost')
                }
                disabled={busy}
                onValue={(v) =>
                  update({
                    purchaseCost: v,
                    confirmCostCorrection: false,
                    invalidFields: clearError('purchaseCost'),
                  })
                }
                onInvalid={(bad) => invalid('purchaseCost', bad)}
              />
            </label>
            {(a.action === 'create' || a.action === 'edit') && (
              <>
                <label className="field">
                  <span>Estimated / asking value ($)</span>
                  <HistoryMoney
                    label="Inventory proposal asking value"
                    missing={a.invalidFields.includes('asking')}
                    value={a.patch.asking ?? item?.asking ?? null}
                    disabled={busy}
                    onValue={(v) =>
                      update({
                        patch: { ...a.patch, asking: v ?? undefined },
                        invalidFields: clearError('asking'),
                      })
                    }
                    onInvalid={(bad) => invalid('asking', bad)}
                  />
                </label>
                <label className="field">
                  <span>
                    Acquisition date
                    {a.assumedAcquisitionDate ? ' · assumed today, confirm or change' : ''}
                  </span>
                  <input
                    type="date"
                    aria-label="Inventory proposal acquisition date"
                    value={acquiredDay}
                    onChange={(e) =>
                      update({
                        patch: { ...a.patch, purchasedAt: e.target.value },
                        assumedAcquisitionDate: false,
                      })
                    }
                  />
                </label>
              </>
            )}
          </div>
        )}
        {a.purchaseCost !== null &&
          a.action !== 'create' &&
          (a.confirmCostCorrection ||
            p.issues.some((i) => i.includes('Confirm correcting recorded purchase costs'))) && (
            <label className="check-row">
              <input
                type="checkbox"
                checked={a.confirmCostCorrection}
                onChange={(e) => update({ confirmCostCorrection: e.target.checked })}
              />
              Confirm correcting recorded purchase costs, including saved-sale cost basis. Original
              sales and fees are retained.
            </label>
          )}
        {(a.action === 'create' || a.action === 'edit') && (
          <details>
            <summary>Edit item details</summary>
            <div className="form-grid">
              {(
                [
                  'brand',
                  'category',
                  'size',
                  'color',
                  'condition',
                  'sku',
                  'description',
                  'source',
                  'storage',
                  'notes',
                ] as const
              ).map((key) => (
                <label className="field" key={key}>
                  <span>{key[0].toUpperCase() + key.slice(1)}</span>
                  <input
                    aria-label={`Inventory proposal ${key}`}
                    value={a.patch[key] ?? item?.[key] ?? ''}
                    onChange={(e) => patch(key, e.target.value)}
                  />
                </label>
              ))}
            </div>
          </details>
        )}
        {a.move && (
          <>
            <div className="form-grid">
              <label className="field">
                <span>Move to</span>
                <select
                  aria-label="Inventory proposal destination"
                  value={a.move.destination}
                  onChange={(e) =>
                    update({
                      move: {
                        ...a.move!,
                        destination: e.target.value as typeof a.move.destination,
                        confirmConsequences: false,
                      },
                    })
                  }
                >
                  {inventoryStages.map((s) => (
                    <option key={s} value={s}>
                      {inventoryStageNames[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Event date (defaults to this change’s date)</span>
                <input
                  type="date"
                  aria-label="Inventory proposal event date"
                  value={localDay(new Date(a.move.date), w.settings.timezone)}
                  onChange={(e) => {
                    if (e.target.value)
                      update({
                        move: {
                          ...a.move!,
                          date: new Date(
                            zoneMidnight(e.target.value, w.settings.timezone),
                          ).toISOString(),
                          confirmConsequences: false,
                        },
                      });
                  }}
                />
              </label>
            </div>
            {a.move.destination === 'for-sale' &&
              a.move.items.map((target) => (
                <div className="form-grid" key={target.itemId}>
                  <label className="field">
                    <span>
                      Marketplace · {w.items.find((i) => i.id === target.itemId)?.title || title}
                    </span>
                    <select
                      aria-label={`Inventory proposal marketplace ${target.itemId}`}
                      data-review-missing={!target.listing?.marketplace}
                      value={target.listing?.marketplace || ''}
                      onChange={(e) =>
                        update({
                          move: {
                            ...a.move!,
                            items: a.move!.items.map((r) =>
                              r.itemId === target.itemId
                                ? {
                                    ...r,
                                    listing: {
                                      marketplace: e.target.value as NonNullable<
                                        typeof target.listing
                                      >['marketplace'],
                                      price: r.listing?.price ?? null,
                                    },
                                  }
                                : r,
                            ),
                          },
                        })
                      }
                    >
                      <option value="">Choose marketplace</option>
                      {['Depop', 'Vinted', 'eBay', 'Whatnot', 'In person'].map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Thrift Log listing price ($)</span>
                    <HistoryMoney
                      label={`Inventory proposal listing price ${target.itemId}`}
                      missing={
                        target.listing?.price == null ||
                        a.invalidFields.includes(`listingPrice-${target.itemId}`)
                      }
                      value={target.listing?.price ?? null}
                      disabled={busy}
                      onValue={(v) =>
                        update({
                          invalidFields: clearError(`listingPrice-${target.itemId}`),
                          move: {
                            ...a.move!,
                            items: a.move!.items.map((r) =>
                              r.itemId === target.itemId
                                ? {
                                    ...r,
                                    listing: {
                                      marketplace: r.listing?.marketplace ?? null,
                                      price: v,
                                    },
                                  }
                                : r,
                            ),
                          },
                        })
                      }
                      onInvalid={(bad) => invalid(`listingPrice-${target.itemId}`, bad)}
                    />
                  </label>
                </div>
              ))}
            <p>Updates Thrift Log only; external marketplaces are unchanged.</p>
            {consequences && (
              <>
                <p>
                  {reversingSale
                    ? `Reverse ${orders.length} recorded sale${orders.length === 1 ? '' : 's'} (${money(reversedRevenue)} current revenue). Realized revenue/profit will be removed; original sales and correction history are retained.`
                    : reversingShipping
                      ? 'Reset shipping for the selected items and linked package records.'
                      : 'End the selected active Thrift Log listings.'}
                </p>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={a.move.confirmConsequences}
                    onChange={(e) =>
                      update({ move: { ...a.move!, confirmConsequences: e.target.checked } })
                    }
                  />
                  Confirm these linked record changes.
                </label>
              </>
            )}
          </>
        )}
      </fieldset>
      {a.patch.asking !== undefined && (
        <small>{money(a.patch.asking)} estimated / asking value · not realized revenue.</small>
      )}
      {!!p.issues.length && (
        <p className="error-text" tabIndex={-1} data-review-issues>
          {p.issues[0]}
        </p>
      )}
    </article>
  );
}
