'use client';
import { useMemo, useRef, useState } from 'react';
import {
  inventoryStages,
  inventoryStageNames,
  inventoryPipeline,
  type InventoryStage,
} from '@/lib/pipeline';
import { type PipelineMove, type MoveFailure } from '@/lib/pipeline-moves';
import { orderTotalsById, returnedItemIds } from '@/lib/ledger';
import { listingAmount, confirmedFreeInventory } from '@/lib/assistant/listing-review';
import { money } from '@/lib/money';
import { marketplaces } from '@/lib/model';
import { useWorkspace } from '@/lib/use-workspace';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { ItemPhoto } from './shared';
type Entry = {
  itemId: string;
  saleDate: string;
  marketplace: string;
  price: string;
  cost: string;
  fees: string;
  processing: string;
  shipping: string;
  shippingCollected: string;
  discount: string;
  other: string;
};
const expenseFields = [
  'fees',
  'processing',
  'shipping',
  'shippingCollected',
  'discount',
  'other',
] as const;
const names = {
  fees: 'Marketplace fees',
  processing: 'Processing fees',
  shipping: 'Seller shipping',
  shippingCollected: 'Shipping received',
  discount: 'Discount',
  other: 'Other direct costs',
};
export function PipelineMoveDialog({
  ids,
  initialDestination,
  onClose,
  onSaved,
}: {
  ids: string[];
  initialDestination?: InventoryStage;
  onClose: () => void;
  onSaved: (successIds: string[], failures: MoveFailure[]) => void;
}) {
  const { w, movePipeline, saving, error, notify, refresh } = useWorkspace();
  const totals = useMemo(() => orderTotalsById(w), [w]);
  const marketplace = 'All marketplaces' as string;
  const snapshot = useMemo(() => inventoryPipeline(w), [w]);
  const [destination, setDestination] = useState<InventoryStage>(initialDestination || 'unlisted');
  const [date, setDate] = useState(() =>
    new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16),
  );
  const [market, setMarket] = useState(marketplace === 'All marketplaces' ? '' : marketplace);
  const [rows, setRows] = useState<Entry[]>(() =>
    ids.map((id) => {
      const item = w.items.find((i) => i.id === id)!;
      const active = w.listings.filter((l) => l.itemId === id);
      return {
        itemId: id,
        saleDate: '',
        marketplace:
          marketplace === 'All marketplaces'
            ? new Set(active.map((l) => l.marketplace)).size === 1
              ? active[0]?.marketplace || ''
              : ''
            : marketplace,
        price: '',
        cost: item.cost > 0 || confirmedFreeInventory(w, id) ? String(item.cost / 100) : '',
        fees: '',
        processing: '',
        shipping: '',
        shippingCollected: '',
        discount: '',
        other: '',
      };
    }),
  );
  const [confirmed, setConfirmed] = useState(false),
    [failures, setFailures] = useState<MoveFailure[]>([]),
    [localError, setLocalError] = useState('');
  const prepared = useRef<PipelineMove | null>(null),
    lock = useRef(false);
  const selected = new Set(rows.map((r) => r.itemId));
  const entries = snapshot.entries.filter((e) => selected.has(e.item.id));
  const orders = [
    ...new Map(entries.flatMap((e) => (e.order ? [[e.order.id, e.order] as const] : []))).values(),
  ];
  const undo = orders.length > 0 && ['unlisted', 'for-sale'].includes(destination);
  const consequential =
    undo ||
    (['unlisted', 'archived'].includes(destination) &&
      entries.some((e) => e.listings.length > 0)) ||
    (destination === 'sold' && entries.some((e) => e.stage === 'shipped'));
  const impact = orders.reduce((n, o) => n + totals.get(o.id)!.revenue, 0);
  const profitImpact = orders.reduce((n, o) => n - totals.get(o.id)!.profit, 0);
  const relatedOrders = new Set(orders.map((order) => order.id));
  for (const pkg of w.shipments)
    if (pkg.orderIds.some((id) => relatedOrders.has(id)))
      pkg.orderIds.forEach((id) => relatedOrders.add(id));
  const relatedIds = [
    ...new Set(
      w.orders
        .filter((order) => relatedOrders.has(order.id))
        .flatMap((order) =>
          order.lines
            .filter((line) => !returnedItemIds(w, order.id).has(line.itemId))
            .map((line) => line.itemId),
        ),
    ),
  ].filter((id) => !selected.has(id));
  const groupMove =
    undo ||
    (orders.some((order) => w.shipments.some((pkg) => pkg.orderIds.includes(order.id))) &&
      ['sold', 'shipped'].includes(destination));
  function includeRelated() {
    invalidate();
    setRows([
      ...rows,
      ...relatedIds.map((id) => {
        const item = w.items.find((item) => item.id === id)!;
        return {
          itemId: id,
          saleDate: '',
          marketplace: market,
          price: '',
          cost: item.cost > 0 || confirmedFreeInventory(w, id) ? String(item.cost / 100) : '',
          fees: '',
          processing: '',
          shipping: '',
          shippingCollected: '',
          discount: '',
          other: '',
        };
      }),
    ]);
    setConfirmed(false);
  }

  function invalidate() {
    prepared.current = null;
    setLocalError('');
    setFailures([]);
  }
  function update(index: number, key: keyof Entry, value: string) {
    invalidate();
    setRows(rows.map((r, i) => (i === index ? { ...r, [key]: value } : r)));
  }
  function amount(raw: string) {
    return listingAmount(raw).value;
  }
  async function save() {
    if (lock.current || saving) return;
    lock.current = true;
    setLocalError('');
    try {
      if (!prepared.current) {
        if (!date || !Number.isFinite(Date.parse(date)))
          throw new Error('Choose a valid event date.');
        const at = new Date(date).toISOString();
        prepared.current = {
          id: crypto.randomUUID(),
          revision: w.revision,
          destination,
          date: at,
          confirmConsequences: confirmed,
          items: rows.map((row) => {
            const e = snapshot.entries.find((e) => e.item.id === row.itemId),
              item = w.items.find((i) => i.id === row.itemId)!;
            const needsSale = ['sold', 'shipped'].includes(destination) && !e?.order;
            return {
              itemId: row.itemId,
              ...(destination === 'for-sale' && e?.stage !== 'for-sale'
                ? {
                    listing: {
                      marketplace: (row.marketplace || null) as
                        (typeof marketplaces)[number] | null,
                      price: amount(
                        row.price || (item.asking > 0 ? String(item.asking / 100) : ''),
                      ),
                    },
                  }
                : {}),
              ...(needsSale
                ? {
                    sale: {
                      marketplace: (row.marketplace || null) as
                        (typeof marketplaces)[number] | null,
                      date: new Date(row.saleDate || date).toISOString(),
                      price: amount(row.price),
                      purchaseCost: amount(row.cost),
                      ...Object.fromEntries(expenseFields.map((key) => [key, amount(row[key])])),
                    } as NonNullable<PipelineMove['items'][number]['sale']>,
                  }
                : {}),
            };
          }),
        };
      }
      const result = await movePipeline(prepared.current);
      if (!result) return;
      onSaved(result.successIds, result.failures);
      setFailures(result.failures);
      if (result.successIds.length)
        notify(
          `${result.successIds.length} items processed${result.unchangedIds.length ? ` (${result.unchangedIds.length} already in stage)` : ''}; ${result.failures.length} failed. Changes are internal to Thrift Log.`,
        );
      if (!result.failures.length) onClose();
      else {
        setRows(rows.filter((r) => !result.successIds.includes(r.itemId)));
        prepared.current = null;
      }
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Check the required fields.');
    } finally {
      lock.current = false;
    }
  }
  return (
    <Dialog
      open
      onClose={() => {
        if (!saving) onClose();
      }}
      title="Change pipeline status"
      description="Manage Thrift Log records only. No marketplace is published, removed or synchronized."
      wide
    >
      <div className="editor-form pipeline-move-review">
        <div className="pipeline-top-actions">
          <strong>{rows.length} physical items selected</strong>
          <Button
            aria-label="Save status changes at top"
            disabled={saving || !rows.length || (consequential && !confirmed)}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>Move to</span>
            <select
              aria-label="Move to stage"
              value={destination}
              disabled={saving}
              onChange={(e) => {
                invalidate();
                setDestination(e.target.value as InventoryStage);
                setConfirmed(false);
              }}
            >
              {inventoryStages.map((s) => (
                <option value={s} key={s}>
                  {inventoryStageNames[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Event / sale date (this device’s time)</span>
            <input
              aria-label="Move date"
              type="datetime-local"
              value={date}
              disabled={saving}
              onChange={(e) => {
                invalidate();
                setDate(e.target.value);
              }}
            />
          </label>
        </div>
        {rows.some((row) => {
          const entry = snapshot.entries.find((e) => e.item.id === row.itemId);
          return ['sold', 'shipped'].includes(destination)
            ? !entry?.order
            : destination === 'for-sale' && entry?.stage !== 'for-sale';
        }) && (
          <div className="pipeline-shared-defaults">
            <label className="field">
              <span>Shared marketplace</span>
              <select
                value={market}
                aria-label="Shared marketplace"
                disabled={saving}
                onChange={(e) => setMarket(e.target.value)}
              >
                <option value="">Choose marketplace</option>
                {marketplaces.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <Button
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={() => {
                invalidate();
                setRows(rows.map((r) => ({ ...r, marketplace: market || r.marketplace })));
              }}
            >
              Apply marketplace to rows
            </Button>
            {destination !== 'for-sale' && (
              <Button
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => {
                  invalidate();
                  setRows(
                    rows.map((r) => ({
                      ...r,
                      ...Object.fromEntries(expenseFields.map((k) => [k, r[k] || '0'])),
                    })),
                  );
                }}
              >
                Confirm blank sale expenses are $0
              </Button>
            )}
          </div>
        )}
        {groupMove && relatedIds.length > 0 && (
          <div className="error-box">
            <p>
              This correction affects linked order or package items:{' '}
              {relatedIds.map((id) => w.items.find((item) => item.id === id)?.sku).join(', ')}.
              Review them together.
            </p>
            <Button variant="outline" disabled={saving} onClick={includeRelated}>
              Include related items ({relatedIds.length})
            </Button>
          </div>
        )}
        {undo && (
          <p className="error-box">
            Undo accidental sale entries for {orders.length} complete orders: net recognized revenue
            decreases by {money(impact)} and recognized profit changes by{' '}
            {orders.every((o) => totals.get(o.id)!.profitKnown)
              ? money(profitImpact)
              : 'an unknown amount (purchase costs incomplete)'}
            ; their remaining purchase cost and recorded selling costs are reversed with dated
            correction entries. Original orders, shipping references and ledger history remain. No
            cash refund is sent. Real returns/refunds belong in the order ledger; paid-out sales
            require cash reconciliation first.
          </p>
        )}
        {consequential && (
          <label className="check-row">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={saving}
              onChange={(e) => {
                invalidate();
                setConfirmed(e.target.checked);
              }}
            />
            I confirm these internal listing / shipping corrections and any accidental sale
            reversals. Restored items are in my possession.
          </label>
        )}
        {(localError || error) && (
          <p role="alert" className="error-box">
            {localError || error}
          </p>
        )}
        {!!failures.length && (
          <div role="alert" className="error-box">
            <strong>{failures.length} items failed; their selection is retained.</strong>
            {failures.map((f) => (
              <p key={f.itemId}>
                {w.items.find((i) => i.id === f.itemId)?.sku}: {f.message}
              </p>
            ))}
          </div>
        )}
        {rows.map((row, index) => {
          const item = w.items.find((i) => i.id === row.itemId)!,
            entry = snapshot.entries.find((e) => e.item.id === row.itemId),
            sale = ['sold', 'shipped'].includes(destination) && !entry?.order,
            listing = destination === 'for-sale' && entry?.stage !== 'for-sale';
          return (
            <fieldset disabled={saving} key={row.itemId} className="pipeline-move-row">
              <legend>
                {item.sku} · {item.title}
              </legend>
              <div className="actions">
                <ItemPhoto item={item} />
                <small>Current: {entry ? inventoryStageNames[entry.stage] : item.status}</small>
              </div>
              {(sale || listing) && (
                <div className="form-grid">
                  <label className="field">
                    <span>Marketplace · {item.sku}</span>
                    <select
                      aria-label={`Marketplace · ${item.sku}`}
                      value={row.marketplace}
                      onChange={(e) => update(index, 'marketplace', e.target.value)}
                    >
                      <option value="">Choose marketplace</option>
                      {marketplaces.map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>
                      {sale ? 'Actual sale price' : 'Asking price'} ($) · {item.sku}
                    </span>
                    <input
                      aria-label={`${sale ? 'Actual sale price' : 'Asking price'} ($) · ${item.sku}`}
                      inputMode="decimal"
                      value={row.price}
                      placeholder={
                        sale
                          ? 'Required actual proceeds'
                          : item.asking
                            ? String(item.asking / 100)
                            : 'Required asking price'
                      }
                      onChange={(e) => update(index, 'price', e.target.value)}
                    />
                    <small>
                      Stored asking price: {money(item.asking)}
                      {sale ? ' — never used as actual proceeds.' : ''}
                    </small>
                  </label>
                </div>
              )}
              {sale && (
                <>
                  <label className="field">
                    <span>Sale date · {item.sku}</span>
                    <input
                      type="datetime-local"
                      value={row.saleDate || date}
                      onChange={(e) => update(index, 'saleDate', e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Purchase cost ($) · {item.sku}</span>
                    <input
                      inputMode="decimal"
                      readOnly={item.cost > 0 || confirmedFreeInventory(w, item.id)}
                      value={row.cost}
                      onChange={(e) => update(index, 'cost', e.target.value)}
                    />
                  </label>
                  <div className="form-grid">
                    {expenseFields.map((key) => (
                      <label className="field" key={key}>
                        <span>
                          {names[key]} ($) · {item.sku}
                        </span>
                        <input
                          inputMode="decimal"
                          placeholder="Unknown"
                          value={row[key]}
                          onChange={(e) => update(index, key, e.target.value)}
                        />
                      </label>
                    ))}
                  </div>
                  <small>
                    Packaging, tips, refunds and adjustments start at zero for this new sale. Use
                    the order editor for those entries.
                  </small>
                </>
              )}
            </fieldset>
          );
        })}
        <div className="actions">
          <Button
            disabled={saving || !rows.length || (consequential && !confirmed)}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save status changes'}
          </Button>
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => {
              prepared.current = null;
              void refresh();
            }}
          >
            Refresh workspace
          </Button>
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
