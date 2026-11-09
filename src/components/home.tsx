'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowUpRight,
  ArrowRight,
  Radio,
  ShoppingBag,
  Clock3,
  Wallet,
  TrendingUp,
  Package,
  ListChecks,
} from 'lucide-react';
import { currentOrderTotals, orderPostings } from '@/lib/ledger';
import { useWorkspace } from '@/lib/use-workspace';
import { metrics, money, duration } from '@/lib/finance';
import { periodRange } from '@/lib/dates';
import { Metric, Badge, ItemPhoto, Empty } from './shared';
import { TrendChart } from './charts';
import { Button } from './ui/button';
import type { EditorTarget } from './editor';
export function Home({
  range,
  onEdit,
}: {
  range: [number, number];
  onEdit: (t: EditorTarget) => void;
}) {
  const { now, w } = useWorkspace();
  const base = usePathname().startsWith('/demo') ? '/demo' : '';
  const [metric, setMetric] = useState<'profit' | 'revenue'>('profit');
  const m = metrics(w, ...range);
  const month = metrics(w, ...periodRange('This month', w.settings.timezone));
  const upcoming = [...w.shows]
    .filter((s) => s.status !== 'Ended')
    .sort((a, b) => +new Date(a.date) - +new Date(b.date))[0];
  const recent = [...w.orders]
    .filter((o) => +new Date(o.date) >= range[0] && +new Date(o.date) <= range[1])
    .sort((a, b) => +new Date(b.date) - +new Date(a.date))
    .slice(0, 4);
  const start = Math.max(range[0], Math.min(now, ...w.orders.map((o) => +new Date(o.date))));
  const end = Math.min(range[1], now);
  const step = Math.max(1, Math.ceil((end - start) / 86400000 / 11));
  const data = Array.from(
    { length: Math.max(1, Math.ceil((end - start + 1) / 86400000 / step)) },
    (_, i) => {
      const from = start + i * step * 86400000;
      const to = Math.min(end, from + step * 86400000 - 1);
      const value = metrics(w, from, to);
      return {
        label: new Date(from).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          timeZone: w.settings.timezone,
        }),
        revenue: value.revenue / 100,
        profit: value.profit / 100,
      };
    },
  );
  const needing = w.items.filter(
    (i) => !['Listed', 'Sold', 'Archived', 'Reserved'].includes(i.status),
  );
  const revenueByMarket = ['Depop', 'eBay', 'Whatnot', 'Vinted'].map((name) => ({
    name,
    revenue: orderPostings(w, ...range)
      .filter((p) => p.marketplace === name)
      .reduce((n, p) => n + p.revenue, 0),
  }));
  const max = Math.max(1, ...revenueByMarket.map((r) => r.revenue));
  return (
    <>
      <div className="metric-grid">
        <Metric
          label="Total revenue"
          value={money(m.revenue)}
          note={`${m.sold} physical items sold`}
          icon={<Wallet size={17} />}
        />
        <Metric
          label="Net operating profit"
          value={money(m.profit)}
          note={`${m.margin.toFixed(1)}% profit margin`}
          positive={m.profit > 0}
          icon={<TrendingUp size={17} />}
        />
        <Metric
          label="Time invested"
          value={duration(m.hours * 3600000)}
          note="Buying, listing & selling"
          icon={<Clock3 size={17} />}
        />
        <Metric
          label="Effective hourly earnings"
          value={m.hourly === null ? '—' : `${money(m.hourly)}/hr`}
          note="Profit ÷ hours in this period"
          positive={!!m.hourly && m.hourly > 0}
          icon={<ArrowUpRight size={17} />}
        />
      </div>
      <div className="dashboard-grid">
        {w.settings.widgets.map((widget) => {
          if (widget === 'chart')
            return (
              <section className="card chart-card" key={widget}>
                <div className="card-heading">
                  <div>
                    <span className="eyebrow">THE BIG PICTURE</span>
                    <h2>A little progress, every day.</h2>
                  </div>
                  <div className="segmented">
                    <button
                      className={metric === 'profit' ? 'active' : ''}
                      onClick={() => setMetric('profit')}
                    >
                      Profit
                    </button>
                    <button
                      className={metric === 'revenue' ? 'active' : ''}
                      onClick={() => setMetric('revenue')}
                    >
                      Revenue
                    </button>
                  </div>
                </div>
                <div className="chart-total">
                  {money(metric === 'profit' ? m.profit : m.revenue)}
                  <span>{metric === 'profit' ? 'earned after costs' : 'seller revenue'}</span>
                </div>
                <TrendChart data={data} metric={metric} />
                <div className="chart-footer">
                  <span className="dot" />{' '}
                  {metric === 'profit' ? 'Net operating profit' : 'Revenue'}{' '}
                  <span>Based on recorded transactions</span>
                </div>
              </section>
            );
          if (widget === 'shows')
            return upcoming ? (
              <section className="card show-card" key={widget}>
                <div className="show-top">
                  <span className="icon-tile">
                    <Radio size={20} />
                  </span>
                  <Badge tone="green">
                    {upcoming.type === 'Whatnot' ? 'NEXT LIVE SHOW' : 'UPCOMING EVENT'}
                  </Badge>
                </div>
                <p className="show-date">
                  {new Date(upcoming.date).toLocaleDateString('en-US', {
                    weekday: 'long',
                    month: 'short',
                    day: 'numeric',
                    timeZone: w.settings.timezone,
                  })}{' '}
                  ·{' '}
                  {new Date(upcoming.date).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    timeZone: w.settings.timezone,
                  })}
                </p>
                <h2>{upcoming.name}</h2>
                <p>
                  {upcoming.notes || 'Your next opportunity to turn good finds into great sales.'}
                </p>
                <div className="show-stats">
                  <div>
                    <strong>{upcoming.lineup.length}</strong>
                    <span>items in lineup</span>
                  </div>
                  <div>
                    <strong>
                      {upcoming.checklist.filter((t) => t.done).length}/{upcoming.checklist.length}
                    </strong>
                    <span>tasks complete</span>
                  </div>
                </div>
                <Button variant="outline" onClick={() => onEdit({ kind: 'show', value: upcoming })}>
                  Prepare your show <ArrowRight size={16} />
                </Button>
                <span className="show-decoration">
                  <Radio size={100} strokeWidth={0.7} />
                </span>
              </section>
            ) : (
              <section className="card" key={widget}>
                <div className="card-heading">
                  <h2>Your next show</h2>
                  <Radio size={20} />
                </div>
                <Empty
                  title="Make room for a good show"
                  description="Pick your pieces, set a date, and go live."
                  action={
                    <Button variant="outline" onClick={() => onEdit({ kind: 'show' })}>
                      Plan a show
                    </Button>
                  }
                />
              </section>
            );
          if (widget === 'sales')
            return (
              <section className="card recent-card" key={widget}>
                <div className="card-heading">
                  <h2>Fresh off the rack</h2>
                  <Link className="text-link" href={`${base}/sales`}>
                    All sales <ArrowRight size={14} />
                  </Link>
                </div>
                <p className="subtitle">Your most recent sales, all in one place.</p>
                {recent.length ? (
                  <div className="sale-list">
                    {recent.map((o) => {
                      const item = w.items.find((i) => i.id === o.lines[0]?.itemId);
                      return (
                        <button
                          className="sale-row"
                          key={o.id}
                          onClick={() => onEdit({ kind: 'order', value: o })}
                        >
                          {item ? (
                            <ItemPhoto item={item} />
                          ) : (
                            <span className="icon-tile">
                              <ShoppingBag size={18} />
                            </span>
                          )}
                          <span className="sale-description">
                            <strong>
                              {item?.title || 'Tip'}
                              {o.lines.length > 1 ? ` + ${o.lines.length - 1}` : ''}
                            </strong>
                            <span>
                              {o.marketplace} <i>·</i>{' '}
                              {new Date(o.date).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                timeZone: w.settings.timezone,
                              })}
                            </span>
                          </span>
                          <span className="sale-value">
                            <strong>{money(currentOrderTotals(w, o).revenue)}</strong>
                            <span
                              className={
                                currentOrderTotals(w, o).profit >= 0 ? 'positive' : 'negative'
                              }
                            >
                              {money(currentOrderTotals(w, o).profit)} profit
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <Empty
                    title="Your first sale starts here"
                    description="Record a sale to see your real earnings."
                    action={
                      <Button onClick={() => onEdit({ kind: 'order' })}>Record a sale</Button>
                    }
                  />
                )}
              </section>
            );
          return (
            <section className="card" key={widget}>
              <div className="card-heading">
                <h2>Where your sales happen</h2>
                <ShoppingBag size={18} className="muted" />
              </div>
              <p className="subtitle">Revenue across your marketplaces.</p>
              <div className="market-bars">
                {revenueByMarket.map((r, i) => (
                  <div className="market-row" key={r.name}>
                    <span className={`market-icon market-${i}`}>{r.name.slice(0, 1)}</span>
                    <div>
                      <div className="market-label">
                        <strong>{r.name}</strong>
                        <span>{money(r.revenue)}</span>
                      </div>
                      <div className="progress-track">
                        <span style={{ width: `${(Math.max(0, r.revenue) / max) * 100}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <Link className="text-link" href={`${base}/insights`}>
                Compare marketplace performance <ArrowRight size={14} />
              </Link>
            </section>
          );
        })}
      </div>
      <div className="bottom-grid">
        <section className="card inventory-summary">
          <span className="icon-tile">
            <Package size={20} />
          </span>
          <div>
            <h3>Your next sale is already here.</h3>
            <p>
              {needing.length} items waiting to be listed · {money(m.inventoryCost)} in unsold
              inventory
            </p>
          </div>
          <Link className="btn btn-outline" href={`${base}/inventory`}>
            Open inventory <ArrowRight size={16} />
          </Link>
        </section>
        <section className="card goal-card">
          <div className="card-heading">
            <h3>Monthly profit goal</h3>
            <span>
              {Math.min(
                100,
                Math.max(0, Math.round((month.profit / Math.max(1, w.settings.monthlyGoal)) * 100)),
              )}
              %
            </span>
          </div>
          <div className="progress-track">
            <span
              style={{
                width: `${Math.min(100, Math.max(0, (month.profit / Math.max(1, w.settings.monthlyGoal)) * 100))}%`,
              }}
            />
          </div>
          <p>
            {money(month.profit)} of {money(w.settings.monthlyGoal)} <span>this month</span>
          </p>
        </section>
      </div>
      <div className="quiet-note">
        <ListChecks size={14} /> Good records. Clear numbers. Better decisions.
      </div>
    </>
  );
}
