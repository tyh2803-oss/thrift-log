'use client';
import { useMemo, useState } from 'react';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import {
  inventoryPipeline,
  inventoryStages,
  inventoryStageNames,
  type InventoryStage,
  type PipelineStage,
} from '@/lib/pipeline';
import { LayoutGrid, List, Plus, Download, ExternalLink, Copy } from 'lucide-react';
import { currentOrderTotals } from '@/lib/ledger';
import { useWorkspace } from '@/lib/use-workspace';
import { money, parseMoney } from '@/lib/finance';
import { downloadCsv } from '@/lib/csv';
import { marketplaces, type Item } from '@/lib/model';
import { Status, ItemPhoto, Empty } from './shared';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { listingMetrics } from '@/lib/listing-metrics';
import { assumedHistoryAcquisition, historyInventoryCostUnknown } from '@/lib/cost-knowledge';
import { PhotoGallery } from './photo-gallery';
import { PipelineMoveDialog } from './pipeline-move-dialog';
import { OrderFulfillment } from './order-fulfillment';
import type { EditorTarget } from './editor';
export function Inventory({
  search,
  onEdit,
  onImport,
  pipelineStage = null,
}: {
  pipelineStage?: PipelineStage | null;
  search: string;
  onEdit: (t: EditorTarget) => void;
  onImport: () => void;
}) {
  const { now, w, dispatch, notify } = useWorkspace();
  const base = usePathname().startsWith('/demo') ? '/demo' : '';
  const router = useRouter();
  const params = useSearchParams();
  const requested = params.get('pipeline') || pipelineStage || 'all';
  const status = inventoryStages.includes(requested as InventoryStage)
    ? (requested as InventoryStage)
    : 'all';
  const pipeline = useMemo(() => inventoryPipeline(w), [w]);
  const entriesById = new Map(pipeline.entries.map((entry) => [entry.item.id, entry]));
  const stageOf = (i: Item) =>
    i.status === 'Archived' ? 'archived' : entriesById.get(i.id)?.stage;
  const [fulfillmentId, setFulfillmentId] = useState<string | null>(null);
  function setStatus(value: string) {
    const query = new URLSearchParams(params.toString());
    if (value === 'all') query.delete('pipeline');
    else query.set('pipeline', value);
    router.replace(`${base}/inventory${query.size ? `?${query}` : ''}`, { scroll: false });
  }
  const [moving, setMoving] = useState<string[] | null>(null);
  const [destination, setDestination] = useState<InventoryStage>('unlisted');
  const [view, setView] = useState<'table' | 'grid'>('table');
  const [tab, setTab] = useState('Inventory');
  const [marketplace, setMarketplace] = useState('All marketplaces');
  const listingSummary = listingMetrics(w, marketplace);
  const [sort, setSort] = useState('Newest');
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<string | null>(null);
  function changeStatus(i: Item) {
    const current = stageOf(i);
    setDestination(
      current === 'for-sale'
        ? 'sold'
        : current === 'sold'
          ? 'shipped'
          : current === 'shipped'
            ? 'sold'
            : current === 'archived'
              ? 'unlisted'
              : 'for-sale',
    );
    setMoving([i.id]);
  }
  const items = w.items
    .filter(
      (i) =>
        (status === 'all' || stageOf(i) === status) &&
        (marketplace === 'All marketplaces' ||
          w.listings.some((l) => l.itemId === i.id && l.marketplace === marketplace)) &&
        `${i.sku} ${i.title} ${i.brand} ${i.category} ${i.source} ${i.storage}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === 'Price: high to low'
        ? b.asking - a.asking
        : sort === 'Oldest'
          ? +new Date(a.purchasedAt) - +new Date(b.purchasedAt)
          : +new Date(b.createdAt) - +new Date(a.createdAt),
    );
  const unknownViewCosts = items.filter(
    (i) => i.status !== 'Sold' && i.status !== 'Archived' && historyInventoryCostUnknown(w, i.id),
  ).length;
  const item = w.items.find((i) => i.id === detail);
  const listings = w.listings.filter((l) => {
    const item = w.items.find((i) => i.id === l.itemId);
    return (
      item &&
      (status === 'all' || stageOf(item) === status) &&
      (marketplace === 'All marketplaces' || l.marketplace === marketplace) &&
      `${item.title} ${item.sku} ${l.marketplace}`.toLowerCase().includes(search.toLowerCase())
    );
  });
  async function updateCost(i: Item, value: string) {
    try {
      if (!value.trim() && historyInventoryCostUnknown(w, i.id)) return;
      const cost = parseMoney(value);
      if (cost !== i.cost && (await dispatch({ type: 'item', value: { ...i, cost } })))
        notify('Purchase cost updated. Historical sale cost basis is unchanged.');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Invalid cost');
    }
  }
  return (
    <>
      <div className="page-toolbar">
        <div className="tabs">
          {['Inventory', 'Listings'].map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t}
              <span>{t === 'Inventory' ? items.length : listings.length}</span>
            </button>
          ))}
        </div>
        <div className="actions">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadCsv(
                'inventory',
                w.items.map((i) => ({
                  sku: i.sku,
                  title: i.title,
                  brand: i.brand,
                  category: i.category,
                  size: i.size,
                  cost: historyInventoryCostUnknown(w, i.id) ? '' : (i.cost / 100).toFixed(2),
                  purchase_cost_status: historyInventoryCostUnknown(w, i.id)
                    ? 'Unknown'
                    : 'Recorded',
                  asking: (i.asking / 100).toFixed(2),
                  purchase_date: assumedHistoryAcquisition(w, i.id) ? '' : i.purchasedAt,
                  source: i.source,
                  status: i.status,
                })),
              )
            }
          >
            <Download size={15} />
            Export
          </Button>
          <Button variant="outline" size="sm" onClick={onImport}>
            Import CSV
          </Button>
          <Button
            size="sm"
            onClick={() => onEdit({ kind: tab === 'Inventory' ? 'item' : 'listing' })}
          >
            <Plus size={15} />
            {tab === 'Inventory' ? 'Add item' : 'Add listing'}
          </Button>
        </div>
      </div>
      <div className="listing-filter">
        <label className="field">
          <span>Marketplace</span>
          <select
            aria-label="Filter marketplace"
            value={marketplace}
            onChange={(e) => setMarketplace(e.target.value)}
          >
            <option>All marketplaces</option>
            {marketplaces.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
      </div>
      {tab === 'Listings' && (
        <section className="card padded listing-overview" aria-label="Listing summary">
          <div className="listing-summary-grid">
            {[
              ['Physical inventory items', String(listingSummary.physicalItems)],
              ['Active listings', String(listingSummary.activeListings)],
              ['Inventory at acquisition cost', money(listingSummary.inventoryCost)],
              ['Combined active asking prices', money(listingSummary.aggregateAsking)],
              ['Cross-listed physical items', String(listingSummary.crossListed)],
              ['Unlisted inventory', String(listingSummary.unlisted)],
              ['Items sold', String(listingSummary.sold)],
              ['Listings needing delisting', String(listingSummary.needsDelisting)],
            ].map(([label, value]) => (
              <div key={label}>
                <small>{label}</small>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <p className="hint">
            Acquisition cost counts each unsold physical item once. Combined asking prices add every
            active listing; they are potential prices, not inventory cost or realized profit.
            Zero-cost records may need review.
          </p>
          <div className="actions listing-breakdown">
            {listingSummary.byMarketplace
              .filter((m) => m.active > 0)
              .map((m) => (
                <span key={m.marketplace}>
                  {m.marketplace}: <strong>{m.active}</strong>
                </span>
              ))}
          </div>
        </section>
      )}
      {tab === 'Inventory' ? (
        <>
          <div className="inventory-stats">
            <span>
              <strong>{items.length}</strong> pieces in this view
            </span>
            <span>
              <strong>
                {money(
                  items
                    .filter((i) => i.status !== 'Sold' && i.status !== 'Archived')
                    .reduce((n, i) => n + i.cost, 0),
                )}
              </strong>{' '}
              {unknownViewCosts ? `known cost · ${unknownViewCosts} unknown` : 'at cost'}
            </span>
            <span>
              <strong>
                {money(
                  items
                    .filter((i) => i.status !== 'Sold' && i.status !== 'Archived')
                    .reduce((n, i) => n + i.asking, 0),
                )}
              </strong>{' '}
              item asking value
            </span>
          </div>
          <section className="card inventory-list-card">
            <div className="table-controls">
              <div className="actions">
                <select
                  aria-label="Filter inventory status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="all">All stages</option>
                  {inventoryStages.map((stage) => (
                    <option key={stage} value={stage}>
                      {inventoryStageNames[stage]}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Sort inventory"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  {['Newest', 'Oldest', 'Price: high to low'].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="segmented">
                <button
                  aria-label="Table view"
                  className={view === 'table' ? 'active' : ''}
                  onClick={() => setView('table')}
                >
                  <List size={16} />
                </button>
                <button
                  aria-label="Grid view"
                  className={view === 'grid' ? 'active' : ''}
                  onClick={() => setView('grid')}
                >
                  <LayoutGrid size={16} />
                </button>
              </div>
            </div>
            <div className="pipeline-bulk-bar" aria-label="Inventory selection">
              <strong aria-live="polite">{selected.length} selected</strong>
              <Button
                size="sm"
                variant="outline"
                disabled={!items.length}
                onClick={() => setSelected([...new Set([...selected, ...items.map((i) => i.id)])])}
              >
                Select all matching ({items.length})
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!selected.length}
                onClick={() => setSelected([])}
              >
                Clear selection
              </Button>
              {!!selected.length && (
                <>
                  <label className="field">
                    <span>Move to</span>
                    <select
                      aria-label="Bulk destination"
                      value={destination}
                      onChange={(e) => setDestination(e.target.value as InventoryStage)}
                    >
                      {inventoryStages.map((stage) => (
                        <option key={stage} value={stage}>
                          {inventoryStageNames[stage]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button size="sm" onClick={() => setMoving(selected)}>
                    Move selected ({selected.length})
                  </Button>
                </>
              )}
              <small>
                Select all includes every item matching the current filters. Selections remain when
                filters change.
                {selected.some((id) => !items.some((i) => i.id === id)) &&
                  ` ${selected.filter((id) => !items.some((i) => i.id === id)).length} selected outside these filters.`}
                {selected.length > 200 && ' Move up to 200 items at a time.'}
              </small>
            </div>
            {!items.length ? (
              <Empty
                title={
                  w.items.length
                    ? 'No items match these filters'
                    : 'A fresh start for your inventory'
                }
                description={
                  w.items.length
                    ? 'Choose another stage or marketplace, or adjust your search.'
                    : 'Add your first find, or import the pieces you already own.'
                }
                action={<Button onClick={() => onEdit({ kind: 'item' })}>Add an item</Button>}
              />
            ) : view === 'grid' ? (
              <div className="photo-grid">
                {items.map((i) => (
                  <div className="product-card selectable-product" key={i.id}>
                    <label className="inventory-select">
                      <input
                        type="checkbox"
                        aria-label={`Select ${i.sku}`}
                        checked={selected.includes(i.id)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, i.id]
                              : selected.filter((id) => id !== i.id),
                          )
                        }
                      />
                      Select item
                    </label>
                    <button className="product-open" onClick={() => setDetail(i.id)}>
                      <ItemPhoto item={i} large />
                      <div>
                        <Status value={stageOf(i) ? inventoryStageNames[stageOf(i)!] : i.status} />
                        <h3>{i.title}</h3>
                        <p>
                          {i.sku} · {i.size}
                        </p>
                        <strong>{money(i.asking)}</strong>
                        <span className="muted">
                          {' '}
                          ·{' '}
                          {historyInventoryCostUnknown(w, i.id)
                            ? 'Cost unknown'
                            : `${money(i.cost)} cost`}
                        </span>
                      </div>
                    </button>
                    <Button size="sm" variant="outline" onClick={() => changeStatus(i)}>
                      Change status
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          aria-label="Select all inventory"
                          checked={items.length > 0 && items.every((i) => selected.includes(i.id))}
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? [...new Set([...selected, ...items.map((i) => i.id)])]
                                : selected.filter((id) => !items.some((i) => i.id === id)),
                            )
                          }
                        />
                      </th>
                      <th>Item</th>
                      <th>Status</th>
                      <th>Cost</th>
                      <th>Asking</th>
                      <th>Age</th>
                      <th>Listings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i) => {
                      const age = Math.max(
                        0,
                        Math.floor((now - +new Date(i.purchasedAt)) / 86400000),
                      );
                      return (
                        <tr key={i.id}>
                          <td>
                            <label className="inventory-check">
                              <input
                                type="checkbox"
                                aria-label={`Select ${i.sku}`}
                                checked={selected.includes(i.id)}
                                onChange={(e) =>
                                  setSelected(
                                    e.target.checked
                                      ? [...selected, i.id]
                                      : selected.filter((id) => id !== i.id),
                                  )
                                }
                              />
                            </label>
                          </td>
                          <td>
                            <button className="item-cell" onClick={() => setDetail(i.id)}>
                              <ItemPhoto item={i} />
                              <span>
                                <strong>{i.title}</strong>
                                <small>
                                  {i.sku} · {i.brand} · {i.size}
                                </small>
                              </span>
                            </button>
                          </td>
                          <td>
                            <Status
                              value={stageOf(i) ? inventoryStageNames[stageOf(i)!] : i.status}
                            />
                            <Button size="sm" variant="ghost" onClick={() => changeStatus(i)}>
                              Change status
                            </Button>
                            {entriesById.get(i.id)?.order && (
                              <>
                                <small className="muted">
                                  {entriesById.get(i.id)?.fulfillment}
                                </small>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setFulfillmentId(entriesById.get(i.id)!.order!.id)}
                                >
                                  Manage fulfillment
                                </Button>
                              </>
                            )}
                          </td>
                          <td data-label="Cost">
                            <input
                              className="cost-input"
                              aria-label={`Cost for ${i.sku}`}
                              key={`${i.id}-${i.cost}`}
                              defaultValue={
                                historyInventoryCostUnknown(w, i.id)
                                  ? ''
                                  : (i.cost / 100).toFixed(2)
                              }
                              placeholder="Unknown"
                              type="number"
                              step="0.01"
                              min="0"
                              onBlur={(e) => void updateCost(i, e.target.value)}
                            />
                          </td>
                          <td className="number" data-label="Asking">
                            {money(i.asking)}
                          </td>
                          <td data-label="Age">
                            <span className={age > 90 ? 'negative' : 'muted'}>
                              {assumedHistoryAcquisition(w, i.id) ? 'Unknown' : `${age}d`}
                            </span>
                          </td>
                          <td>
                            <div className="market-dots">
                              {w.listings
                                .filter((l) => l.itemId === i.id && l.status === 'Active')
                                .map((l) => (
                                  <span title={l.marketplace} key={l.id}>
                                    {l.marketplace[0]}
                                  </span>
                                ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="card">
          {!listings.length ? (
            <Empty
              title="Give your pieces a place to sell"
              description="Link marketplace listings to the physical items you own."
              action={<Button onClick={() => onEdit({ kind: 'listing' })}>Add listing</Button>}
            />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Item / marketplace</th>
                    <th>Price</th>
                    <th>Status</th>
                    <th>Listed</th>
                    <th>External link</th>
                  </tr>
                </thead>
                <tbody>
                  {listings.map((l) => {
                    const i = w.items.find((i) => i.id === l.itemId)!;
                    return (
                      <tr key={l.id}>
                        <td>
                          <button
                            className="cell-button"
                            onClick={() => onEdit({ kind: 'listing', value: l })}
                          >
                            <strong>{i.title}</strong>
                            <small>
                              {i.sku} · {l.marketplace} · {l.format}
                            </small>
                          </button>
                        </td>
                        <td>{money(l.price)}</td>
                        <td>
                          <Status value={l.status} />
                        </td>
                        <td>{Math.floor((now - +new Date(l.listedAt)) / 86400000)}d ago</td>
                        <td>
                          {l.url ? (
                            <a
                              href={l.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-link"
                            >
                              Open <ExternalLink size={13} />
                            </a>
                          ) : (
                            <span className="muted">Not provided</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {fulfillmentId && (
        <OrderFulfillment orderId={fulfillmentId} onClose={() => setFulfillmentId(null)} />
      )}
      {moving && (
        <PipelineMoveDialog
          ids={moving}
          initialDestination={destination}
          onClose={() => setMoving(null)}
          onSaved={(successIds, failures) =>
            setSelected((ids) => [
              ...new Set([
                ...ids.filter((id) => !successIds.includes(id)),
                ...failures.map((failure) => failure.itemId),
              ]),
            ])
          }
        />
      )}
      {item && (
        <Dialog
          open
          onClose={() => setDetail(null)}
          title={item.title}
          description={`${item.sku} · ${item.brand} · ${item.size}`}
          wide
        >
          <div className="item-detail">
            <PhotoGallery key={item.id} item={item} />
            <div>
              <Status value={stageOf(item) ? inventoryStageNames[stageOf(item)!] : item.status} />
              <dl>
                <div>
                  <dt>Purchase cost</dt>
                  <dd>{historyInventoryCostUnknown(w, item.id) ? 'Unknown' : money(item.cost)}</dd>
                </div>
                <div>
                  <dt>Asking price</dt>
                  <dd>{money(item.asking)}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>{item.source || 'Not recorded'}</dd>
                </div>
                <div>
                  <dt>Storage</dt>
                  <dd>{item.storage || 'Not recorded'}</dd>
                </div>
              </dl>
              <p>{item.notes || item.description}</p>
              <div className="actions">
                <Button
                  onClick={() => {
                    setDetail(null);
                    onEdit({ kind: 'item', value: item });
                  }}
                >
                  Edit item
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setDetail(null);
                    changeStatus(item);
                  }}
                >
                  Change status
                </Button>
                {entriesById.get(item.id)?.order && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setDetail(null);
                      setFulfillmentId(entriesById.get(item.id)!.order!.id);
                    }}
                  >
                    Manage fulfillment
                  </Button>
                )}
                {item.status !== 'Sold' && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setDetail(null);
                      onEdit({ kind: 'order', itemId: item.id });
                    }}
                  >
                    Record sale
                  </Button>
                )}
              </div>
            </div>
          </div>
          <div className="detail-section">
            <div className="card-heading">
              <h3>Marketplace listings</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDetail(null);
                  onEdit({ kind: 'listing', itemId: item.id });
                }}
              >
                Add listing
              </Button>
            </div>
            {w.listings
              .filter((l) => l.itemId === item.id)
              .map((l) => (
                <button
                  className="detail-row"
                  key={l.id}
                  onClick={() => {
                    setDetail(null);
                    onEdit({ kind: 'listing', value: l });
                  }}
                >
                  <span>{l.marketplace}</span>
                  <strong>{money(l.price)}</strong>
                  <Status value={l.status} />
                </button>
              ))}
            <h3>Sale history</h3>
            {w.orders
              .filter((o) => o.lines.some((l) => l.itemId === item.id))
              .map((o) => (
                <button
                  className="detail-row"
                  key={o.id}
                  onClick={() => {
                    setDetail(null);
                    onEdit({ kind: 'order', value: o });
                  }}
                >
                  <span>
                    {o.marketplace} · {new Date(o.date).toLocaleDateString()}
                  </span>
                  <strong>
                    {currentOrderTotals(w, o).profitKnown
                      ? `${money(currentOrderTotals(w, o).profit)} profit`
                      : 'Unknown cost · profit incomplete'}
                  </strong>
                  <Status value={o.status} />
                </button>
              ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDetail(null);
                onEdit({
                  kind: 'item',
                  value: {
                    ...item,
                    id: crypto.randomUUID(),
                    sku: `${item.sku}-COPY`,
                    status: 'Purchased',
                    createdAt: new Date().toISOString(),
                  },
                });
              }}
            >
              <Copy size={14} />
              Duplicate item
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
