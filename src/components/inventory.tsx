'use client';
import { useState } from 'react';
import { LayoutGrid, List, Plus, Download, ExternalLink, Copy } from 'lucide-react';
import { currentOrderTotals } from '@/lib/ledger';
import { useWorkspace } from '@/lib/use-workspace';
import { money, parseMoney } from '@/lib/finance';
import { downloadCsv } from '@/lib/csv';
import { itemStatuses, type Item } from '@/lib/model';
import { Status, ItemPhoto, Empty } from './shared';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { PhotoGallery } from './photo-gallery';
import type { EditorTarget } from './editor';
export function Inventory({
  search,
  onEdit,
  onImport,
}: {
  search: string;
  onEdit: (t: EditorTarget) => void;
  onImport: () => void;
}) {
  const { now, w, dispatch, notify } = useWorkspace();
  const [view, setView] = useState<'table' | 'grid'>('table');
  const [tab, setTab] = useState('Inventory');
  const [status, setStatus] = useState('All statuses');
  const [sort, setSort] = useState('Newest');
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<string | null>(null);
  const items = w.items
    .filter(
      (i) =>
        (status === 'All statuses' || i.status === status) &&
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
  const item = w.items.find((i) => i.id === detail);
  const listings = w.listings.filter((l) => {
    const item = w.items.find((i) => i.id === l.itemId);
    return (
      item &&
      `${item.title} ${item.sku} ${l.marketplace}`.toLowerCase().includes(search.toLowerCase())
    );
  });
  async function updateCost(i: Item, value: string) {
    try {
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
              <span>{t === 'Inventory' ? w.items.length : w.listings.length}</span>
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
                  cost: (i.cost / 100).toFixed(2),
                  asking: (i.asking / 100).toFixed(2),
                  purchase_date: i.purchasedAt,
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
              at cost
            </span>
            <span>
              <strong>
                {money(
                  items
                    .filter((i) => i.status !== 'Sold' && i.status !== 'Archived')
                    .reduce((n, i) => n + i.asking, 0),
                )}
              </strong>{' '}
              asking value
            </span>
          </div>
          <section className="card">
            <div className="table-controls">
              <div className="actions">
                <select
                  aria-label="Filter inventory status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option>All statuses</option>
                  {itemStatuses.map((s) => (
                    <option key={s}>{s}</option>
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
            {!!selected.length && (
              <div className="bulk-bar">
                <span>{selected.length} selected</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void dispatch(
                      w.items
                        .filter((i) => selected.includes(i.id) && i.status !== 'Sold')
                        .map((i) => ({ type: 'item', value: { ...i, status: 'Ready to List' } })),
                    );
                    setSelected([]);
                  }}
                >
                  Mark ready to list
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                  Clear
                </Button>
              </div>
            )}
            {!items.length ? (
              <Empty
                title="A fresh start for your inventory"
                description="Add your first find, or import the pieces you already own."
                action={<Button onClick={() => onEdit({ kind: 'item' })}>Add an item</Button>}
              />
            ) : view === 'grid' ? (
              <div className="photo-grid">
                {items.map((i) => (
                  <button className="product-card" key={i.id} onClick={() => setDetail(i.id)}>
                    <ItemPhoto item={i} large />
                    <div>
                      <Status value={i.status} />
                      <h3>{i.title}</h3>
                      <p>
                        {i.sku} · {i.size}
                      </p>
                      <strong>{money(i.asking)}</strong>
                      <span className="muted"> · {money(i.cost)} cost</span>
                    </div>
                  </button>
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
                          checked={items.length > 0 && selected.length === items.length}
                          onChange={(e) =>
                            setSelected(e.target.checked ? items.map((i) => i.id) : [])
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
                            <Status value={i.status} />
                          </td>
                          <td>
                            <input
                              className="cost-input"
                              aria-label={`Cost for ${i.sku}`}
                              key={`${i.id}-${i.cost}`}
                              defaultValue={(i.cost / 100).toFixed(2)}
                              type="number"
                              step="0.01"
                              min="0"
                              onBlur={(e) => void updateCost(i, e.target.value)}
                            />
                          </td>
                          <td className="number">{money(i.asking)}</td>
                          <td>
                            <span className={age > 90 ? 'negative' : 'muted'}>{age}d</span>
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
              <Status value={item.status} />
              <dl>
                <div>
                  <dt>Purchase cost</dt>
                  <dd>{money(item.cost)}</dd>
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
                  <strong>{money(currentOrderTotals(w, o).profit)} profit</strong>
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
