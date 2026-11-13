'use client';
import { browserScope, clearPrivateBrowserState } from '@/lib/browser-scope';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  LayoutDashboard,
  Package,
  ShoppingBag,
  Clock3,
  ChartNoAxesCombined,
  Settings2,
  Search,
  Bell,
  Plus,
  ChevronDown,
  ArrowUpRight,
  Radio,
  MapPin,
  Play,
  Leaf,
  LogOut,
  WifiOff,
  RefreshCw,
  X,
  CircleHelp,
} from 'lucide-react';
import { useWorkspace } from '@/lib/use-workspace';
import { useNow } from '@/lib/use-now';
import { NavigationProgress } from './navigation-progress';
import { returnedItemIds } from '@/lib/ledger';
import { periodRange, periods, type Period } from '@/lib/dates';
import { lineFulfillment } from '@/lib/fulfillment-state';
import { readPipelineStage } from '@/lib/pipeline';
import type { Session } from '@/lib/model';
import { Home } from './home';
import { Inventory } from './inventory';
import { Sales } from './sales';
import { Activity } from './activity';
import { Insights } from './insights';
import { WhatnotAutoSync } from './whatnot-auto-sync';
import { Settings } from './settings';
import { Editor, type EditorTarget } from './editor';
import { Importer } from './importer';
import { Assistant } from './assistant';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Badge, Empty } from './shared';
const nav = [
  { href: '/', label: 'Home', icon: LayoutDashboard },
  { href: '/inventory', label: 'Inventory', icon: Package },
  { href: '/sales', label: 'Sales', icon: ShoppingBag },
  { href: '/activity', label: 'Activity', icon: Clock3 },
  { href: '/insights', label: 'Insights', icon: ChartNoAxesCombined },
];
export function ThriftApp({
  section,
  demo,
  email,
  userId,
  isOwner = false,
}: {
  userId?: string;
  isOwner?: boolean;
  pipeline?: string;
  section: string;
  demo: boolean;
  email?: string;
}) {
  const workspace = useWorkspace();
  const matches = workspace.scope === browserScope(demo, userId) && workspace.isOwner === isOwner;
  useEffect(() => {
    if (!matches) {
      // A session changed in another tab. Never render a different account's cached
      // workspace; remount the layout using the freshly authorized server identity.
      clearPrivateBrowserState();
      window.location.reload();
    }
  }, [matches]);
  if (!matches)
    return (
      <p className="loading" role="status">
        Rechecking your workspace…
      </p>
    );
  return <Shell section={section} email={email} />;
}
function Shell({ section, email }: { section: string; email?: string }) {
  const params = useSearchParams();
  const pipelineStage = readPipelineStage(params.get('pipeline'));
  const inventoryStage = pipelineStage;
  const salesStage = pipelineStage === 'sold' || pipelineStage === 'shipped' ? pipelineStage : null;
  const { w, ready, demo, saving, error, notice, dispatch, refresh, notify } = useWorkspace();
  const now = useNow(w.sessions.some((s) => s.state === 'Running') ? 1000 : 60_000, w);
  const base = usePathname().startsWith('/demo') ? '/demo' : '';
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<Period>('Last 30 days');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [importing, setImporting] = useState(false);
  const [assistant, setAssistant] = useState(false);
  const [scanItemId, setScanItemId] = useState<string | undefined>();
  const [quick, setQuick] = useState(false);
  const [timerMenu, setTimerMenu] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [help, setHelp] = useState(false);
  const [online, setOnline] = useState(true);
  const [association, setAssociation] = useState('');
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('[aria-label=\"Search your business\"]')?.focus();
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  const [from, to] = periodRange(period, w.settings.timezone, customStart, customEnd);
  const range = useMemo<[number, number]>(() => [from, to], [from, to]);
  const openImporter = useCallback(() => setImporting(true), []);
  const active = w.sessions.find((s) => ['Running', 'Paused'].includes(s.state));
  useEffect(() => {
    const connection = () => setOnline(navigator.onLine);
    const initial = setTimeout(connection, 0);
    window.addEventListener('online', connection);
    window.addEventListener('offline', connection);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    return () => {
      clearTimeout(initial);
      window.removeEventListener('online', connection);
      window.removeEventListener('offline', connection);
    };
  }, []);
  const start = useCallback(
    async (category: Session['category'], links: Partial<Session> = {}) => {
      const showId = association.startsWith('show:') ? association.slice(5) : null;
      const tripId = association.startsWith('trip:') ? association.slice(5) : null;
      if (
        await dispatch({
          type: 'session',
          value: {
            id: crypto.randomUUID(),
            category,
            subcategory: '',
            notes: '',
            showId,
            tripId,
            locationId: null,
            ...links,
            segments: [{ start: new Date().toISOString(), end: null }],
            state: 'Running',
          },
        })
      ) {
        setTimerMenu(false);
        notify(`${category} timer started.`);
      }
    },
    [association, dispatch, notify],
  );
  const control = useCallback(
    async (action: 'pause' | 'resume' | 'end') => {
      if (!active) return;
      const at = new Date().toISOString();
      const segments =
        action === 'resume'
          ? [...active.segments, { start: at, end: null }]
          : active.segments.map((s) => (s.end ? s : { ...s, end: at }));
      await dispatch({
        type: 'session',
        value: {
          ...active,
          segments,
          state: action === 'end' ? 'Ended' : action === 'pause' ? 'Paused' : 'Running',
        },
      });
    },
    [active, dispatch],
  );
  const title =
    section === 'home'
      ? 'A good day for good finds.'
      : section === 'inventory'
        ? 'Every piece, in its place.'
        : section === 'sales'
          ? 'Good finds. Great sales.'
          : section === 'activity'
            ? 'Make your time count.'
            : section === 'insights'
              ? 'See the bigger picture.'
              : 'A workspace that feels like you.';
  const subtitles: Record<string, string> = {
    home: 'Here’s how your reselling business is coming along.',
    inventory: 'One home for your inventory, wherever it’s listed.',
    sales: 'Your orders, live shows, and everything in between.',
    activity: 'Keep track of the work behind every sale.',
    insights: 'Clear numbers. Better decisions. More of what works.',
    settings: 'A few thoughtful defaults, just for your business.',
  };
  const delist = w.listings.filter((l) => l.status === 'Needs delisting');
  const fulfill = w.orders.filter(
    (o) =>
      o.status === 'Completed' &&
      o.lines.some(
        (l) =>
          !returnedItemIds(w, o.id).has(l.itemId) &&
          lineFulfillment(o, l.itemId).status === 'Unfulfilled',
      ),
  );
  const missing = w.items.filter((i) => i.cost === 0 && i.status !== 'Archived');
  const stale = w.listings.filter(
    (l) => l.status === 'Active' && now - +new Date(l.listedAt) > 90 * 86400000,
  );
  const alerts = delist.length + fulfill.length + missing.length + stale.length;
  const edit = useCallback((t: EditorTarget) => {
    setEditor(t);
    setQuick(false);
  }, []);
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <Link href={`${base}/`} className="brand" aria-label="Thrift Log home">
          <span className="brand-mark">
            <Leaf size={23} strokeWidth={1.8} />
          </span>
          <span>
            thrift<span className="brand-light">log</span>
            <small>GOOD FINDS. CLEAR NUMBERS.</small>
          </span>
        </Link>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <nav>
          {nav.map((n) => (
            <Link
              key={n.href}
              className={`nav-link ${section === n.label.toLowerCase() ? 'active' : ''}`}
              href={`${base}${n.href}`}
              onClick={() => setSearch('')}
            >
              <n.icon size={19} />
              <span>{n.label}</span>
              <NavigationProgress />
              {n.label === 'Inventory' && (
                <small>
                  {w.items.filter((i) => i.status !== 'Sold' && i.status !== 'Archived').length}
                </small>
              )}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <span>SMALL STEPS, REAL GROWTH</span>
            <Leaf size={22} />
            <p>
              Build a business that
              <br />
              works for you.
            </p>
            <Link href={`${base}/insights`}>
              Find your insights <ArrowUpRight size={14} />
            </Link>
          </div>
          <Link
            href={`${base}/settings`}
            className={`nav-link ${section === 'settings' ? 'active' : ''}`}
          >
            <Settings2 size={18} />
            Settings
            <NavigationProgress />
          </Link>
          <button className="nav-link" onClick={() => setHelp(true)}>
            <CircleHelp size={18} />A little help
          </button>
          <div className="profile">
            <span className="avatar">{email ? email[0].toUpperCase() : 'T'}</span>
            <div>
              <strong>{demo ? 'Your demo workspace' : 'Your private workspace'}</strong>
              <small>{demo ? 'A little room to explore' : email}</small>
            </div>
            {!demo && (
              <button
                aria-label="Sign out"
                className="plain-icon"
                onClick={async () => {
                  const response = await fetch('/api/auth', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'signout' }),
                  });
                  if (!response.ok) {
                    notify('Sign-out was not confirmed. Try again.');
                    return;
                  }
                  clearPrivateBrowserState();
                  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Clear private state after sign-out.
                  window.location.assign('/login');
                }}
              >
                <LogOut size={16} />
              </button>
            )}
          </div>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span>
            <strong>{section[0].toUpperCase() + section.slice(1)}</strong>
          </div>
          <label className="search-box">
            <Search size={16} />
            <input
              placeholder="Search your business…"
              aria-label="Search your business"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <kbd>⌘ K</kbd>
          </label>
          <div className="topbar-actions">
            <button
              className="notification-button"
              aria-label="Open notifications"
              onClick={() => setNotifications(true)}
            >
              <Bell size={19} />
              {alerts > 0 && <span />}
            </button>
            <span className="topbar-divider" />
            <Link
              href={`${base}/settings`}
              aria-label="Open settings"
              className="avatar avatar-small"
            >
              {demo ? 'T' : email?.[0].toUpperCase()}
            </Link>
          </div>
        </header>
        <main>
          <div className={`environment-banner ${!online ? 'offline-banner' : ''}`}>
            {!online ? (
              <>
                <WifiOff size={14} />
                <span>
                  Offline ·{' '}
                  {demo
                    ? 'Demo edits stay in this browser.'
                    : 'Private records require a connection to save. Marketplace data may be stale.'}
                </span>
              </>
            ) : demo ? (
              <>
                <span className="demo-dot" />
                <span>
                  <strong>Demo workspace</strong> · Fictional sample data, saved in this browser.
                </span>
                <Link href="/login">
                  Use your private workspace <ArrowUpRight size={12} />
                </Link>
              </>
            ) : (
              <>
                <span className="demo-dot" />
                Private workspace · {saving ? 'Saving…' : 'Connected to Supabase'}
              </>
            )}
          </div>
          <WhatnotAutoSync />
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {section === 'home' ? 'YOUR BUSINESS, AT A GLANCE' : section.toUpperCase()}
              </div>
              <h1>{title}</h1>
              <p>{subtitles[section]}</p>
            </div>
            <div className="heading-actions">
              {['home', 'sales', 'activity', 'insights'].includes(section) &&
                !(section === 'sales' && salesStage) && (
                  <select
                    aria-label="Date range"
                    className="date-filter"
                    value={period}
                    onChange={(e) => setPeriod(e.target.value as Period)}
                  >
                    {periods.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                )}
              <div className="popover-anchor">
                <Button onClick={() => setQuick(!quick)}>
                  <Plus size={17} />
                  <span>Quick add</span>
                  <ChevronDown size={14} />
                </Button>
                {quick && (
                  <div className="popover quick-menu">
                    <button
                      onClick={() => {
                        setAssistant(true);
                        setQuick(false);
                      }}
                    >
                      <CircleHelp size={17} />
                      AI assistant
                    </button>
                    <button onClick={() => edit({ kind: 'item' })}>
                      <Package size={17} />
                      Add item
                    </button>
                    <button
                      onClick={() => {
                        setTimerMenu(true);
                        setQuick(false);
                      }}
                    >
                      <Clock3 size={17} />
                      Start timer
                    </button>
                    <button onClick={() => edit({ kind: 'order' })}>
                      <ShoppingBag size={17} />
                      Record sale
                    </button>
                    <button onClick={() => edit({ kind: 'item' })}>
                      <Plus size={17} />
                      Record purchase
                    </button>
                    <button onClick={() => edit({ kind: 'trip' })}>
                      <MapPin size={17} />
                      Create sourcing trip
                    </button>
                    <button onClick={() => edit({ kind: 'show' })}>
                      <Radio size={17} />
                      Plan a show
                    </button>
                    <button onClick={() => edit({ kind: 'expense' })}>
                      <Plus size={17} />
                      Record expense
                    </button>
                    <button
                      onClick={() => {
                        setImporting(true);
                        setQuick(false);
                      }}
                    >
                      Import CSV
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
          {period === 'Custom' && !(section === 'sales' && salesStage) && (
            <div className="custom-dates">
              <label>
                From{' '}
                <input
                  aria-label="Custom start date"
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                />
              </label>
              <label>
                To{' '}
                <input
                  aria-label="Custom end date"
                  type="date"
                  value={customEnd}
                  min={customStart}
                  onChange={(e) => setCustomEnd(e.target.value)}
                />
              </label>
            </div>
          )}
          {error && (
            <div className="error-box" role="alert">
              <span>{error}</span>
              <Button variant="outline" size="sm" onClick={() => void refresh()}>
                <RefreshCw size={13} />
                Refresh workspace
              </Button>
            </div>
          )}
          {!ready ? (
            <div className="loading">Getting your workspace ready…</div>
          ) : search && !['inventory', 'sales'].includes(section) ? (
            <section className="card padded">
              <h2>Search results</h2>
              {w.items
                .filter((i) =>
                  `${i.sku} ${i.title} ${i.brand}`.toLowerCase().includes(search.toLowerCase()),
                )
                .map((i) => (
                  <button
                    className="detail-row full-width"
                    key={i.id}
                    onClick={() => edit({ kind: 'item', value: i })}
                  >
                    <Package size={17} />
                    <span>
                      {i.sku} · {i.title}
                    </span>
                  </button>
                ))}
              {w.orders
                .filter((o) =>
                  `${o.externalId} ${o.marketplace}`.toLowerCase().includes(search.toLowerCase()),
                )
                .map((o) => (
                  <button
                    className="detail-row full-width"
                    key={o.id}
                    onClick={() => edit({ kind: 'order', value: o })}
                  >
                    <ShoppingBag size={17} />
                    {o.marketplace} · {o.externalId || o.id.slice(0, 8)}
                  </button>
                ))}
              {w.trips
                .filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
                .map((t) => (
                  <button
                    className="detail-row full-width"
                    key={t.id}
                    onClick={() => edit({ kind: 'trip', value: t })}
                  >
                    <MapPin size={17} />
                    {t.name}
                  </button>
                ))}
              {w.locations
                .filter((l) => l.name.toLowerCase().includes(search.toLowerCase()))
                .map((l) => (
                  <button
                    className="detail-row full-width"
                    key={l.id}
                    onClick={() => edit({ kind: 'location', value: l })}
                  >
                    <MapPin size={17} />
                    {l.name}
                  </button>
                ))}
              {w.shows
                .filter((s) => s.name.toLowerCase().includes(search.toLowerCase()))
                .map((s) => (
                  <button
                    className="detail-row full-width"
                    key={s.id}
                    onClick={() => edit({ kind: 'show', value: s })}
                  >
                    <Radio size={17} />
                    {s.name}
                  </button>
                ))}
            </section>
          ) : (
            <>
              {section === 'home' && <Home range={range} onEdit={edit} />}{' '}
              {section === 'inventory' && (
                <Inventory
                  pipelineStage={inventoryStage}
                  search={search}
                  onEdit={edit}
                  onImport={openImporter}
                />
              )}{' '}
              {section === 'sales' && (
                <Sales
                  key={salesStage || 'all'}
                  pipelineStage={salesStage}
                  search={search}
                  range={range}
                  onEdit={edit}
                  onImport={openImporter}
                />
              )}{' '}
              {section === 'activity' && (
                <Activity
                  range={range}
                  activeSession={active}
                  onControl={control}
                  onEdit={edit}
                  onStart={start}
                />
              )}{' '}
              {section === 'insights' && <Insights range={range} onEdit={edit} />}{' '}
              {section === 'settings' && <Settings onImport={openImporter} />}
            </>
          )}
        </main>
        <nav className="mobile-nav">
          {nav.map((n) => (
            <Link
              href={`${base}${n.href}`}
              key={n.href}
              className={section === n.label.toLowerCase() ? 'active' : ''}
            >
              <n.icon size={20} />
              <span>{n.label}</span>
              <NavigationProgress />
            </Link>
          ))}
        </nav>
      </div>
      {timerMenu && (
        <Dialog
          open
          onClose={() => setTimerMenu(false)}
          title="Start timer"
          description="Choose the work you’re tracking. Manage running timers in Activity."
        >
          <div className="timer-start-options">
            {(['Buying', 'Listing', 'Selling'] as const).map((category) => (
              <Button
                type="button"
                variant="outline"
                key={category}
                onClick={() => void start(category)}
              >
                <Play size={16} />
                {category}
              </Button>
            ))}
          </div>
          <label className="field">
            <span>Link to a show or trip</span>
            <select value={association} onChange={(e) => setAssociation(e.target.value)}>
              <option value="">General business</option>
              {w.shows.map((s) => (
                <option key={s.id} value={`show:${s.id}`}>
                  {s.name}
                </option>
              ))}
              {w.trips.map((t) => (
                <option key={t.id} value={`trip:${t.id}`}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        </Dialog>
      )}
      {editor && (
        <Editor
          key={`${editor.kind}-${editor.value?.id || 'new'}`}
          target={editor}
          onClose={() => setEditor(null)}
          onScanListing={(id) => {
            setEditor(null);
            setScanItemId(id);
            setAssistant(true);
          }}
        />
      )}{' '}
      {importing && <Importer onClose={() => setImporting(false)} />}{' '}
      <Assistant
        open={assistant}
        onOpen={() => setAssistant(true)}
        onClose={() => setAssistant(false)}
        context={scanItemId ? { itemId: scanItemId } : undefined}
        onClearContext={() => setScanItemId(undefined)}
        onView={(kind, id) => {
          const value =
            kind === 'order'
              ? w.orders.find((o) => o.id === id)
              : w.listings.find((l) => l.id === id);
          if (value) {
            setAssistant(false);
            if (kind === 'order')
              edit({ kind: 'order', value: value as import('@/lib/model').Order });
            else edit({ kind: 'listing', value: value as import('@/lib/model').Listing });
          }
        }}
      />
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button aria-label="Dismiss notification" onClick={() => notify('')}>
            <X size={14} />
          </button>
        </div>
      )}
      {notifications && (
        <Dialog
          open
          onClose={() => setNotifications(false)}
          title="A few things to take care of"
          description="The important things, without the noise."
        >
          <div className="notifications-list">
            {!alerts && (
              <Empty title="All caught up" description="Nothing needs your attention right now." />
            )}
            {delist.map((l) => (
              <button
                className="alert-row"
                key={l.id}
                onClick={() => {
                  setNotifications(false);
                  edit({ kind: 'listing', value: l });
                }}
              >
                <Badge tone="amber">Delist</Badge>
                <span>
                  {w.items.find((i) => i.id === l.itemId)?.title} is still listed on {l.marketplace}
                  .
                </span>
              </button>
            ))}
            {!!fulfill.length && (
              <Link
                href={`${base}/sales`}
                className="alert-row"
                onClick={() => setNotifications(false)}
              >
                <Badge tone="amber">Ship</Badge>
                {fulfill.length} orders are awaiting fulfillment.
              </Link>
            )}
            {missing.map((i) => (
              <button
                className="alert-row"
                key={i.id}
                onClick={() => {
                  setNotifications(false);
                  edit({ kind: 'item', value: i });
                }}
              >
                <Badge tone="amber">Review</Badge>
                {i.title} has zero purchase cost.
              </button>
            ))}
            {!!stale.length && (
              <Link
                className="alert-row"
                href={`${base}/inventory`}
                onClick={() => setNotifications(false)}
              >
                {stale.length} active listings are over 90 days old.
              </Link>
            )}
          </div>
        </Dialog>
      )}
      {help && (
        <Dialog
          open
          onClose={() => setHelp(false)}
          title="A simple place to run your business"
          description="Start with a find. Follow it through to profit."
        >
          <div className="padded">
            <p>
              <strong>Inventory</strong> holds each physical item once. Add a listing for each
              marketplace where it appears.
            </p>
            <p>
              <strong>Record a sale</strong> to calculate profit and flag other listings for manual
              delisting. Add direct costs to the order and general expenses in Insights.
            </p>
            <p>
              <strong>Track time</strong> with Buying, Listing, or Selling. Link sessions to trips
              or shows for project earnings.
            </p>
            <p>
              <strong>Sales → Shows & events</strong> is where you plan lineups, track preparation,
              and see show profit.
            </p>
            <p>
              {demo
                ? 'This demo is fictional. Reset it in Settings at any time.'
                : 'Your real records are private and stored in Supabase.'}{' '}
              Live marketplace synchronization is not connected. CSV imports are available through
              Quick add.
            </p>
          </div>
        </Dialog>
      )}
    </div>
  );
}
