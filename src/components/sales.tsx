'use client';
import { useState } from 'react';
import { Plus, Radio, ArrowUpRight, Download, Printer, CheckCircle2 } from 'lucide-react';
import { historyInventoryCostUnknown } from '@/lib/cost-knowledge';
import { currentOrderTotals, payoutStatus } from '@/lib/ledger';
import { useWorkspace } from '@/lib/use-workspace';
import { money, metrics, duration } from '@/lib/finance';
import { downloadCsv } from '@/lib/csv';
import { marketplaces } from '@/lib/model';
import { Empty, Status, Metric, ItemPhoto, CheckButton, Badge } from './shared';
import { Button } from './ui/button';
import { PipelineSales } from './pipeline-sales';
import { OrderFulfillment } from './order-fulfillment';
import type { PipelineStage } from '@/lib/pipeline';
import { OrderLedger } from './order-ledger';
import { Fulfillment } from './fulfillment';
import { Dialog } from './ui/dialog';
import type { EditorTarget } from './editor';
export function Sales({
  search,
  range,
  onEdit,
  onImport,
  pipelineStage = null,
}: {
  pipelineStage?: PipelineStage | null;
  search: string;
  range: [number, number];
  onEdit: (t: EditorTarget) => void;
  onImport: () => void;
}) {
  const { now, w, dispatch } = useWorkspace();
  const [tab, setTab] = useState('Orders');
  const [market, setMarket] = useState('All marketplaces');
  const [status, setStatus] = useState('All orders');
  const [fulfillmentOrderId, setFulfillmentOrderId] = useState<string | null>(null);
  const [ledgerOrderId, setLedgerOrderId] = useState<string | null>(null);
  const [showId, setShowId] = useState<string | null>(null);
  const orders = w.orders
    .filter(
      (o) =>
        (market === 'All marketplaces' || o.marketplace === market) &&
        (status === 'All orders' || o.fulfillment === status || payoutStatus(w, o) === status) &&
        +new Date(o.date) >= range[0] &&
        +new Date(o.date) <= range[1] &&
        `${o.externalId} ${o.marketplace} ${o.lines.map((l) => w.items.find((i) => i.id === l.itemId)?.title).join(' ')}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) => +new Date(b.date) - +new Date(a.date));
  const shows = w.shows
    .filter((s) => s.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => +new Date(b.date) - +new Date(a.date));
  const show = w.shows.find((s) => s.id === showId);
  const sm = show ? metrics(w, 0, now, show.id) : null;
  const exportOrders = () =>
    downloadCsv(
      'sales',
      orders.map((o) => {
        const t = currentOrderTotals(w, o);
        return {
          order_id: o.externalId || o.id,
          physical_skus: o.lines.map((l) => w.items.find((i) => i.id === l.itemId)?.sku).join('|'),
          marketplace: o.marketplace,
          date: o.date,
          merchandise_gross: t.gross / 100,
          lifetime_revenue: t.revenue / 100,
          lifetime_cogs: t.profitKnown ? t.cogs / 100 : '',
          purchase_cost_status: t.profitKnown ? 'Recorded' : 'Unknown',
          lifetime_fees: t.fees / 100,
          lifetime_direct_costs: t.direct / 100,
          lifetime_profit: t.profitKnown ? t.profit / 100 : '',
          status: o.status,
          fulfillment: o.fulfillment,
          payout: payoutStatus(w, o),
        };
      }),
    );
  return (
    <>
      <div className="page-toolbar">
        <div className="tabs">
          {['Orders', 'Shows & events', 'Payouts', 'Shipments'].map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
        {['Orders', 'Shows & events'].includes(tab) && (
          <div className="actions">
            <Button variant="outline" size="sm" onClick={exportOrders}>
              <Download size={15} />
              Export
            </Button>
            <Button variant="outline" size="sm" onClick={onImport}>
              Import CSV
            </Button>
            <Button size="sm" onClick={() => onEdit({ kind: tab === 'Orders' ? 'order' : 'show' })}>
              <Plus size={15} />
              {tab === 'Orders' ? 'Record sale' : 'Plan a show'}
            </Button>
          </div>
        )}
      </div>
      {tab === 'Orders' && pipelineStage ? (
        <>
          <div className="actions pipeline-market-filter">
            <label className="field">
              <span>Marketplace</span>
              <select
                className="marketplace-select"
                data-marketplace={market}
                value={market}
                onChange={(e) => setMarket(e.target.value)}
              >
                <option>All marketplaces</option>
                {marketplaces.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
          </div>
          <PipelineSales
            stage={pipelineStage}
            search={search}
            market={market}
            onEdit={onEdit}
            onFulfill={setFulfillmentOrderId}
          />
        </>
      ) : tab === 'Orders' ? (
        <section className="card">
          <div className="table-controls">
            <div className="actions">
              <select
                className="marketplace-select"
                data-marketplace={market}
                aria-label="Filter marketplace"
                value={market}
                onChange={(e) => setMarket(e.target.value)}
              >
                <option>All marketplaces</option>
                {marketplaces.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              <select
                aria-label="Filter order status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {['All orders', 'Unfulfilled', 'Shipped', 'Delivered', 'Pending', 'Paid'].map(
                  (s) => (
                    <option key={s}>{s}</option>
                  ),
                )}
              </select>
            </div>
            <span className="muted">{orders.length} orders</span>
          </div>
          {orders.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Marketplace</th>
                    <th>Revenue</th>
                    <th>Profit</th>
                    <th>Fulfillment</th>
                    <th>Payout</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <td className="sales-order-cell">
                        <button
                          className="cell-button"
                          onClick={() => onEdit({ kind: 'order', value: o })}
                        >
                          <strong>
                            {o.lines
                              .map((l) => w.items.find((i) => i.id === l.itemId)?.title)
                              .join(', ') || 'Tip'}
                          </strong>
                          <small>
                            {o.externalId || o.id.slice(0, 8)} ·{' '}
                            {new Date(o.date).toLocaleDateString()} · {o.lines.length} items
                          </small>
                        </button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setLedgerOrderId(o.id)}
                          aria-label={`Adjustments for ${o.externalId || o.id.slice(0, 8)}`}
                        >
                          Adjustments & returns
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Fulfillment for ${o.externalId || o.id.slice(0, 8)}`}
                          onClick={() => setFulfillmentOrderId(o.id)}
                        >
                          Item fulfillment
                        </Button>
                      </td>
                      <td>
                        {o.marketplace}
                        {o.type !== 'Sale' && <Badge>{o.type}</Badge>}
                      </td>
                      <td className="number">{money(currentOrderTotals(w, o).revenue)}</td>
                      <td
                        className={
                          currentOrderTotals(w, o).profit >= 0
                            ? 'positive number'
                            : 'negative number'
                        }
                      >
                        {currentOrderTotals(w, o).profitKnown
                          ? money(currentOrderTotals(w, o).profit)
                          : 'Unknown cost'}
                      </td>
                      <td>
                        <Status value={o.fulfillment} />
                      </td>
                      <td>
                        <Status value={payoutStatus(w, o)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="Every sale tells a story"
              description="Record a sale or import your marketplace report to start tracking profit."
              action={<Button onClick={() => onEdit({ kind: 'order' })}>Record sale</Button>}
            />
          )}
        </section>
      ) : tab === 'Payouts' || tab === 'Shipments' ? (
        <Fulfillment kind={tab} range={range} search={search} />
      ) : (
        <div className="show-grid">
          {shows.map((s) => {
            const m = metrics(w, 0, now, s.id);
            return (
              <button key={s.id} className="card show-preview" onClick={() => setShowId(s.id)}>
                <div className="card-heading">
                  <span className="icon-tile">
                    <Radio size={20} />
                  </span>
                  <Status value={s.status} />
                </div>
                <p className="eyebrow">
                  {s.type} ·{' '}
                  {new Date(s.date).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
                <h2>{s.name}</h2>
                <p>
                  {s.lineup.length} planned items · {m.sold} sold
                </p>
                <div className="show-preview-footer">
                  <div>
                    <span>{s.status === 'Ended' ? 'Realized profit' : 'Lineup asking value'}</span>
                    <strong>
                      {s.status === 'Ended' && !m.profitKnown
                        ? 'Profit incomplete'
                        : money(
                            s.status === 'Ended'
                              ? m.profit
                              : s.lineup.reduce(
                                  (n, l) =>
                                    n + (w.items.find((i) => i.id === l.itemId)?.asking || 0),
                                  0,
                                ),
                          )}
                    </strong>
                  </div>
                  <ArrowUpRight size={22} />
                </div>
              </button>
            );
          })}
          {!shows.length && (
            <section className="card">
              <Empty
                title="Your next show starts here"
                description="Select a few pieces, plan your lineup, and track the results."
                action={<Button onClick={() => onEdit({ kind: 'show' })}>Plan a show</Button>}
              />
            </section>
          )}
        </div>
      )}
      {fulfillmentOrderId && (
        <OrderFulfillment
          orderId={fulfillmentOrderId}
          onClose={() => setFulfillmentOrderId(null)}
        />
      )}
      {ledgerOrderId && (
        <OrderLedger orderId={ledgerOrderId} onClose={() => setLedgerOrderId(null)} />
      )}
      {show && sm && (
        <Dialog
          open
          onClose={() => setShowId(null)}
          title={show.name}
          description={`${show.type} · ${new Date(show.date).toLocaleString()} · ${show.status}`}
          wide
        >
          <div className="show-detail">
            <div className="metric-grid compact">
              <Metric label="Revenue" value={money(sm.revenue)} note={`${sm.sold} items sold`} />
              <Metric
                label="Realized profit"
                value={sm.profitKnown ? money(sm.profit) : '—'}
                note={
                  sm.profitKnown
                    ? 'After direct & event costs'
                    : `${sm.unknownCosts} purchase costs unknown`
                }
                positive={sm.profitKnown && sm.profit > 0}
              />
              <Metric
                label="Labor earnings"
                value={sm.hourly === null ? '—' : `${money(sm.hourly)}/hr`}
                note={`${duration(sm.hours * 3600000)} total labor`}
              />
              <Metric
                label="Livestream earnings"
                value={
                  show.durationMinutes && sm.profitKnown
                    ? `${money(sm.profit / (show.durationMinutes / 60))}/hr`
                    : '—'
                }
                note={
                  show.durationMinutes
                    ? `${show.durationMinutes} minutes live`
                    : 'No duration recorded'
                }
              />
            </div>
            <div className="actions">
              <Button
                onClick={() => {
                  setShowId(null);
                  onEdit({ kind: 'show', value: show });
                }}
              >
                Edit show & lineup
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowId(null);
                  onEdit({ kind: 'order', showId: show.id });
                }}
              >
                Record sale
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowId(null);
                  onEdit({ kind: 'expense', showId: show.id });
                }}
              >
                Add expense
              </Button>
              <Button variant="ghost" onClick={() => window.print()}>
                <Printer size={15} />
                Print checklist
              </Button>
            </div>
            <h3>Preparation</h3>
            {show.checklist.map((task, i) => (
              <CheckButton
                key={i}
                checked={task.done}
                onClick={() =>
                  void dispatch({
                    type: 'show',
                    value: {
                      ...show,
                      checklist: show.checklist.map((t, j) =>
                        i === j ? { ...t, done: !t.done } : t,
                      ),
                    },
                  })
                }
              >
                {task.title}
              </CheckButton>
            ))}
            <h3>Lineup</h3>
            {show.lineup.length ? (
              show.lineup.map((line) => {
                const i = w.items.find((i) => i.id === line.itemId)!;
                return (
                  <div className="detail-row" key={i.id}>
                    <ItemPhoto item={i} />
                    <div className="grow">
                      <strong>{i.title}</strong>
                      <small>
                        {i.sku} · {historyInventoryCostUnknown(w, i.id) ? 'Unknown' : money(i.cost)}{' '}
                        cost · {money(line.startingBid)} starting bid
                      </small>
                    </div>
                    <Status value={i.status} />
                    <Badge>{line.presented ? 'Presented' : 'Planned'}</Badge>
                  </div>
                );
              })
            ) : (
              <p className="muted">Add inventory to build your lineup.</p>
            )}
            <details>
              <summary>Profit breakdown & follow-up</summary>
              <dl>
                <div>
                  <dt>Cost of goods sold</dt>
                  <dd>{sm.profitKnown ? money(sm.cogs) : 'Unknown purchase costs'}</dd>
                </div>
                <div>
                  <dt>Direct selling costs</dt>
                  <dd>{money(sm.direct)}</dd>
                </div>
                <div>
                  <dt>Event expenses</dt>
                  <dd>{money(sm.expenses)}</dd>
                </div>
                <div>
                  <dt>Pending net proceeds</dt>
                  <dd>{money(sm.pendingPayout)}</dd>
                </div>
                <div>
                  <dt>Orders to fulfill</dt>
                  <dd>
                    {
                      w.orders.filter(
                        (o) =>
                          o.showId === show.id &&
                          o.fulfillment === 'Unfulfilled' &&
                          o.status === 'Completed',
                      ).length
                    }
                  </dd>
                </div>
                <div>
                  <dt>Unsold planned pieces</dt>
                  <dd>
                    {
                      show.lineup.filter(
                        (l) => w.items.find((i) => i.id === l.itemId)?.status !== 'Sold',
                      ).length
                    }
                  </dd>
                </div>
              </dl>
              <p className="hint">
                <CheckCircle2 size={14} /> Profit is calculated from recorded orders, expenses, and
                time. Audience metrics and estimated API earnings are not available.
              </p>
            </details>
          </div>
        </Dialog>
      )}
    </>
  );
}
