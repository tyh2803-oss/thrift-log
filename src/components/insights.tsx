'use client';
import { useState } from 'react';
import { Plus, Download } from 'lucide-react';
import { orderPostings, ledgerExportRows } from '@/lib/ledger';
import { historyCostUnknown, assumedHistoryAcquisition } from '@/lib/cost-knowledge';
import { useWorkspace } from '@/lib/use-workspace';
import { metrics, money, laborMs, allocate } from '@/lib/finance';
import { downloadCsv } from '@/lib/csv';
import { Metric, Empty } from './shared';
import { BreakdownChart } from './charts';
import { Button } from './ui/button';
import type { EditorTarget } from './editor';
export function Insights({
  range,
  onEdit,
}: {
  range: [number, number];
  onEdit: (t: EditorTarget) => void;
}) {
  const { now, w } = useWorkspace();
  const [tab, setTab] = useState('Overview');
  const [dimension, setDimension] = useState<'brand' | 'category' | 'marketplace' | 'source'>(
    'marketplace',
  );
  const m = metrics(w, ...range);
  const groups = new Map<
    string,
    {
      name: string;
      revenue: number;
      profit: number;
      profitKnown: boolean;
      datedUnits: number;
      units: number;
      cogs: number;
      fees: number;
      days: number;
      salesUnits: number;
      merchandise: number;
    }
  >();
  const postings = orderPostings(w, ...range);
  for (const line of postings) {
    const order = w.orders.find((o) => o.id === line.orderId)!;
    const item = w.items.find((i) => i.id === line.itemId);
    const name =
      (dimension === 'marketplace'
        ? order.marketplace
        : dimension === 'source'
          ? item?.source
          : item?.[dimension]) || 'Unattributed';
    const r = groups.get(name) || {
      name,
      revenue: 0,
      profit: 0,
      profitKnown: true,
      datedUnits: 0,
      units: 0,
      cogs: 0,
      fees: 0,
      days: 0,
      salesUnits: 0,
      merchandise: 0,
    };
    r.revenue += line.revenue;
    r.profit += line.revenue - line.cogs - line.direct;
    if (historyCostUnknown(w, line.orderId, line.itemId) && line.units !== 0) r.profitKnown = false;
    r.cogs += line.cogs;
    r.units += line.units;
    r.fees += line.fees;
    if (line.id === order.id && line.units > 0 && order.type === 'Sale') {
      if (item && !assumedHistoryAcquisition(w, item.id)) {
        r.days += Math.max(0, (Date.parse(order.date) - Date.parse(item.purchasedAt)) / 86400000);
        r.datedUnits++;
      }
      r.salesUnits++;
      r.merchandise +=
        line.gross -
        allocate(
          order.discount,
          order.lines.map((l) => l.price),
        )[order.lines.findIndex((l) => l.itemId === line.itemId)];
    }
    groups.set(name, r);
  }
  const rows = [...groups.values()].sort((a, b) => b.profit - a.profit);
  const expenses = w.expenses.filter(
    (e) => +new Date(e.date) >= range[0] && +new Date(e.date) <= range[1],
  );
  const cashPurchases = w.items
    .filter(
      (i) =>
        !assumedHistoryAcquisition(w, i.id) &&
        +new Date(i.purchasedAt) >= range[0] &&
        +new Date(i.purchasedAt) <= range[1],
    )
    .reduce((n, i) => n + i.cost, 0);
  return (
    <>
      <div className="page-toolbar">
        <div className="tabs">
          {['Overview', 'Finances', 'Expenses', 'Ledger'].map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
        <div className="actions">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadCsv(
                tab === 'Ledger'
                  ? 'dated-ledger'
                  : tab === 'Expenses'
                    ? 'expenses'
                    : 'financial-summary',
                tab === 'Ledger'
                  ? ledgerExportRows(w, ...range)
                  : tab === 'Expenses'
                    ? expenses.map((e) => ({ ...e, amount: e.amount / 100 }))
                    : [
                        {
                          from: new Date(range[0]).toISOString(),
                          to: new Date(range[1]).toISOString(),
                          revenue: m.revenue / 100,
                          cogs: m.profitKnown ? m.cogs / 100 : '',
                          unknown_purchase_costs: m.unknownCosts,
                          direct_costs: m.direct / 100,
                          operating_expenses: m.expenses / 100,
                          net_operating_profit: m.profitKnown ? m.profit / 100 : '',
                          hours: m.hours,
                          hourly: m.hourly === null ? '' : m.hourly / 100,
                        },
                      ],
              )
            }
          >
            <Download size={15} />
            Export
          </Button>
          <Button size="sm" onClick={() => onEdit({ kind: 'expense' })}>
            <Plus size={15} />
            Record expense
          </Button>
        </div>
      </div>
      {!m.profitKnown && (
        <p className="error-box">
          {m.unknownCosts} purchase costs are unknown. Profit, margin, ROI and profit charts are
          incomplete; revenue and recorded fees remain available.
        </p>
      )}
      {tab === 'Overview' ? (
        <>
          <div className="metric-grid">
            <Metric
              label="Operating profit"
              tone="profit"
              value={m.profitKnown ? money(m.profit) : '—'}
              note={
                m.profitKnown
                  ? `${m.margin.toFixed(1)}% margin`
                  : `${m.unknownCosts} purchase costs unknown`
              }
              positive={m.profitKnown && m.profit > 0}
            />
            <Metric
              label="Average profit / sold item"
              tone="profit"
              value={
                m.sold && m.profitKnown
                  ? money(
                      postings
                        .filter((p) => w.orders.find((o) => o.id === p.orderId)?.type === 'Sale')
                        .reduce((n, p) => n + p.revenue - p.cogs - p.direct, 0) / m.sold,
                    )
                  : '—'
              }
              note="Sale profit before general expenses"
            />
            <Metric label="Items sold" value={String(m.sold)} note="Completed merchandise sales" />
            <Metric
              label="Capital in inventory"
              tone="cost"
              value={m.inventoryUnknownCosts ? '—' : money(m.inventoryCost)}
              note={
                m.inventoryUnknownCosts
                  ? `${m.inventoryUnknownCosts} purchase costs unknown`
                  : 'Current unsold item purchase costs'
              }
            />
          </div>
          <section className="card">
            <div className="card-heading">
              <div>
                <span className="eyebrow">FOLLOW THE GOOD FINDS</span>
                <h2>What’s working for your business?</h2>
              </div>
              <select
                aria-label="Analytics grouping"
                value={dimension}
                onChange={(e) => setDimension(e.target.value as typeof dimension)}
              >
                <option value="marketplace">By marketplace</option>
                <option value="brand">By brand</option>
                <option value="category">By category</option>
                <option value="source">By sourcing location</option>
              </select>
            </div>
            {rows.length ? (
              <>
                <BreakdownChart
                  data={rows
                    .filter((r) => r.profitKnown)
                    .map((r) => ({ name: r.name, value: r.profit / 100 }))}
                />
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{dimension}</th>
                        <th>Revenue</th>
                        <th>Item profit</th>
                        <th>Net sold</th>
                        <th>Average sale</th>
                        <th>Fees</th>
                        <th>Average days to sale</th>
                        <th>ROI on COGS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.name}>
                          <td>
                            <strong>{r.name}</strong>
                          </td>
                          <td>{money(r.revenue)}</td>
                          <td className={r.profit >= 0 ? 'positive' : 'negative'}>
                            {r.profitKnown ? money(r.profit) : 'Unknown cost'}
                          </td>
                          <td>{r.units}</td>
                          <td>{r.salesUnits ? money(r.merchandise / r.salesUnits) : '—'}</td>
                          <td>{money(r.fees)}</td>
                          <td>{r.datedUnits ? (r.days / r.datedUnits).toFixed(1) : '—'}</td>
                          <td>
                            {r.profitKnown && r.cogs > 0
                              ? `${((r.profit / r.cogs) * 100).toFixed(0)}%`
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="hint padded">
                  Item profit includes allocated direct costs, discounts, and refunds; excludes
                  general operating expenses. Precise marketplace labor attribution is unavailable
                  except for time explicitly linked to a show.
                </p>
              </>
            ) : (
              <Empty
                title="Insights start with your first sale"
                description="As you record your work, the patterns will become clear."
              />
            )}
          </section>
          <div className="bottom-grid">
            <section className="card padded">
              <h3>Inventory that needs a little love</h3>
              <p>
                {
                  w.items.filter(
                    (i) =>
                      !['Sold', 'Archived'].includes(i.status) &&
                      now - +new Date(i.purchasedAt) > 90 * 86400000,
                  ).length
                }{' '}
                unsold items are over 90 days old.
              </p>
              <p className="muted">
                Current asking value: {money(m.inventoryAsking)}. This is potential revenue, not
                earned income.
              </p>
            </section>
            <section className="card padded">
              <h3>Time by category</h3>
              {(['Buying', 'Listing', 'Selling'] as const).map((c) => (
                <div className="detail-row" key={c}>
                  <span>{c}</span>
                  <strong>
                    {(
                      laborMs(
                        w.sessions.filter((s) => s.category === c),
                        ...range,
                      ) / 3600000
                    ).toFixed(1)}
                    h
                  </strong>
                </div>
              ))}
            </section>
          </div>
        </>
      ) : tab === 'Finances' ? (
        <div className="finance-grid">
          <section className="card padded">
            <span className="eyebrow">PROFIT & LOSS</span>
            <h2>Your money, made clear.</h2>
            <dl className="financial-statement">
              <div data-metric="revenue">
                <dt>Seller revenue</dt>
                <dd>{money(m.revenue)}</dd>
              </div>
              <div data-metric="cost">
                <dt>Cost of goods sold</dt>
                <dd>
                  {m.profitKnown
                    ? `− ${money(m.cogs)}`
                    : `${money(m.cogs)} known · ${m.unknownCosts} unknown`}
                </dd>
              </div>
              <div className="statement-subtotal" data-metric="profit">
                <dt>Gross profit</dt>
                <dd className={m.revenue - m.cogs < 0 ? 'negative' : ''}>
                  {m.profitKnown ? money(m.revenue - m.cogs) : '—'}
                </dd>
              </div>
              <div data-metric="cost">
                <dt>Direct selling costs</dt>
                <dd>− {money(m.direct)}</dd>
              </div>
              <div data-metric="cost">
                <dt>Operating expenses</dt>
                <dd>− {money(m.expenses)}</dd>
              </div>
              <div className="statement-total" data-metric="profit">
                <dt>Net operating profit</dt>
                <dd className={m.profit < 0 ? 'negative' : ''}>
                  {m.profitKnown ? money(m.profit) : '—'}
                </dd>
              </div>
            </dl>
            <p className="hint">
              Seller revenue includes merchandise less discounts, buyer shipping, tips, refunds, and
              adjustments. Direct costs include fees net of credits, seller shipping, packaging, and
              other order costs.
            </p>
          </section>
          <section className="card padded">
            <span className="eyebrow">CASH & INVENTORY</span>
            <h2>Keep the distinctions.</h2>
            <dl className="financial-statement">
              <div>
                <dt>Actual payout cash in period</dt>
                <dd>{money(m.payoutReceived)}</dd>
              </div>
              <div>
                <dt>Pending net proceeds</dt>
                <dd>{money(m.pendingPayout)}</dd>
              </div>
              <div>
                <dt>Inventory acquired at cost</dt>
                <dd>
                  {money(cashPurchases)}
                  {w.items.some((i) => assumedHistoryAcquisition(w, i.id)) && (
                    <small>Historical items with unknown purchase dates are excluded.</small>
                  )}
                </dd>
              </div>
              <div>
                <dt>Unsold inventory at cost (current)</dt>
                <dd>
                  {m.inventoryUnknownCosts ? 'Unknown purchase costs' : money(m.inventoryCost)}
                </dd>
              </div>
              <div>
                <dt>Unsold inventory asking value</dt>
                <dd>{money(m.inventoryAsking)}</dd>
              </div>
              <div>
                <dt>Period hours worked</dt>
                <dd>{m.hours.toFixed(2)}h</dd>
              </div>
              <div>
                <dt>Period effective hourly earnings</dt>
                <dd>{m.hourly === null ? '—' : money(m.hourly)}</dd>
              </div>
            </dl>
            <p className="hint">
              Inventory purchases are assets until sold. Pending proceeds are not bank deposits.
              Recorded payout receipts track actual cash separately from profit. Legacy manual Paid
              flags are not cash receipts. Bank import and reconciliation remain pending.
            </p>
          </section>
        </div>
      ) : tab === 'Ledger' ? (
        <section className="card">
          <div className="card-heading">
            <h2>Dated financial ledger</h2>
          </div>
          <p className="subtitle">
            Original sales and later refunds stay in their actual periods. Cash receipts are shown
            separately in Sales → Payouts.
          </p>
          {postings.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Event / order</th>
                    <th>Piece</th>
                    <th>Revenue</th>
                    <th>COGS</th>
                    <th>Direct costs</th>
                    <th>Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {postings
                    .sort((a, b) => +new Date(b.date) - +new Date(a.date))
                    .map((p, i) => (
                      <tr key={`${p.id}-${p.itemId}-${i}`}>
                        <td>{new Date(p.date).toLocaleDateString()}</td>
                        <td>
                          {w.financialEvents.find((e) => e.id === p.id)?.kind || 'Original sale'}
                          <small className="block muted">
                            {w.orders.find((o) => o.id === p.orderId)?.externalId ||
                              p.orderId.slice(0, 8)}
                          </small>
                        </td>
                        <td>
                          {w.items.find((item) => item.id === p.itemId)?.sku || 'No physical item'}
                        </td>
                        <td>{money(p.revenue)}</td>
                        <td>
                          {historyCostUnknown(w, p.orderId, p.itemId) ? 'Unknown' : money(p.cogs)}
                        </td>
                        <td>{money(p.direct)}</td>
                        <td>
                          {historyCostUnknown(w, p.orderId, p.itemId)
                            ? 'Unknown cost'
                            : money(p.revenue - p.cogs - p.direct)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="No financial postings in this period"
              description="Record a sale or dated adjustment to build your ledger."
            />
          )}
        </section>
      ) : (
        <section className="card">
          {expenses.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Expense</th>
                    <th>Category</th>
                    <th>Date</th>
                    <th>Amount</th>
                    <th>Association</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <button
                          className="cell-button"
                          onClick={() => onEdit({ kind: 'expense', value: e })}
                        >
                          <strong>{e.title}</strong>
                        </button>
                      </td>
                      <td>{e.category}</td>
                      <td>{new Date(e.date).toLocaleDateString()}</td>
                      <td>{money(e.amount)}</td>
                      <td>
                        {w.shows.find((s) => s.id === e.showId)?.name ||
                          w.trips.find((t) => t.id === e.tripId)?.name ||
                          'General business'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="Keep the little costs in sight"
              description="Track supplies, travel, equipment, and other operating expenses."
              action={<Button onClick={() => onEdit({ kind: 'expense' })}>Record expense</Button>}
            />
          )}
        </section>
      )}
    </>
  );
}
