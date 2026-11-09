'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
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
  Pause,
  Square,
  Leaf,
  LogOut,
  WifiOff,
  RefreshCw,
  X,
  CircleHelp,
} from 'lucide-react';
import { WorkspaceProvider, useWorkspace } from '@/lib/use-workspace';
import { returnedItemIds } from '@/lib/ledger';
import { periodRange, periods, type Period } from '@/lib/dates';
import { duration, laborMs } from '@/lib/finance';
import type { Session } from '@/lib/model';
import { Home } from './home';
import { Inventory } from './inventory';
import { Sales } from './sales';
import { Activity } from './activity';
import { Insights } from './insights';
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
}: {
  section: string;
  demo: boolean;
  email?: string;
}) {
  return (
    <WorkspaceProvider demo={demo}>
      <Shell section={section} email={email} />
    </WorkspaceProvider>
  );
}
function Shell({ section, email }: { section: string; email?: string }) {
  const { now, w, ready, demo, saving, error, notice, dispatch, refresh, notify } = useWorkspace();
  const router = useRouter();
  const base = usePathname().startsWith('/demo') ? '/demo' : '';
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<Period>('Last 30 days');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [importing, setImporting] = useState(false);
  const [assistant, setAssistant] = useState(false);
  const [quick, setQuick] = useState(false);
  const [timerMenu, setTimerMenu] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [help, setHelp] = useState(false);
  const [online, setOnline] = useState(true);
  const [, tick] = useState(0);
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
  const range = periodRange(period, w.settings.timezone, customStart, customEnd);
  const active = w.sessions.find((s) => ['Running', 'Paused'].includes(s.state));
  useEffect(() => {
    const interval = setInterval(() => tick((n) => n + 1), 1000);
    const connection = () => setOnline(navigator.onLine);
    const initial = setTimeout(connection, 0);
    window.addEventListener('online', connection);
    window.addEventListener('offline', connection);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    return () => {
      clearInterval(interval);
      clearTimeout(initial);
      window.removeEventListener('online', connection);
      window.removeEventListener('offline', connection);
    };
  }, []);
  async function start(category: Session['category'], links: Partial<Session> = {}) {
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
  }
  async function control(action: 'pause' | 'resume' | 'end') {
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
  }
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
      o.fulfillment === 'Unfulfilled' &&
      o.lines.some((l) => !returnedItemIds(w, o.id).has(l.itemId)),
  );
  const missing = w.items.filter((i) => i.cost === 0 && i.status !== 'Archived');
  const stale = w.listings.filter(
    (l) => l.status === 'Active' && now - +new Date(l.listedAt) > 90 * 86400000,
  );
  const alerts = delist.length + fulfill.length + missing.length + stale.length;
  function edit(t: EditorTarget) {
    setEditor(t);
    setQuick(false);
  }
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
                  await fetch('/api/auth', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'signout' }),
                  });
                  for (const key of Object.keys(sessionStorage)) {
                    if (key.startsWith('thrift-log.draft.')) sessionStorage.removeItem(key);
                  }
                  router.refresh();
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
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {section === 'home' ? 'YOUR BUSINESS, AT A GLANCE' : section.toUpperCase()}
              </div>
              <h1>{title}</h1>
              <p>{subtitles[section]}</p>
            </div>
            <div className="heading-actions">
              {['home', 'sales', 'activity', 'insights'].includes(section) && (
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
          {period === 'Custom' && (
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
                <Inventory search={search} onEdit={edit} onImport={() => setImporting(true)} />
              )}{' '}
              {section === 'sales' && (
                <Sales
                  search={search}
                  range={range}
                  onEdit={edit}
                  onImport={() => setImporting(true)}
                />
              )}{' '}
              {section === 'activity' && (
                <Activity
                  range={range}
                  onEdit={edit}
                  onStart={(category, links) => void start(category, links)}
                />
              )}{' '}
              {section === 'insights' && <Insights range={range} onEdit={edit} />}{' '}
              {section === 'settings' && <Settings onImport={() => setImporting(true)} />}
            </>
          )}
        </main>
        <div className={`timer-dock ${active ? 'has-active' : ''}`}>
          <span className="timer-icon">
            <Clock3 size={19} />
          </span>
          {active ? (
            <>
              <div>
                <strong>
                  {active.category} {active.state === 'Paused' ? '· paused' : ''}
                </strong>
                <span>
                  {duration(laborMs([active]))}{' '}
                  <span className="timer-seconds">
                    {String(Math.floor(laborMs([active]) / 1000) % 60).padStart(2, '0')}s
                  </span>
                </span>
              </div>
              <button
                aria-label={active.state === 'Running' ? 'Pause timer' : 'Resume timer'}
                onClick={() => void control(active.state === 'Running' ? 'pause' : 'resume')}
              >
                {active.state === 'Running' ? <Pause size={17} /> : <Play size={17} />}
              </button>
              <button aria-label="End timer" onClick={() => void control('end')}>
                <Square size={16} />
              </button>
            </>
          ) : (
            <>
              <div>
                <strong>A little time, well tracked.</strong>
                <span>Know what your work is worth.</span>
              </div>
              <Button variant="outline" size="sm" onClick={() => setTimerMenu(!timerMenu)}>
                <Play size={13} />
                Start timer
              </Button>
            </>
          )}
          {timerMenu && (
            <div className="popover timer-menu">
              <strong>What are you working on?</strong>
              {(['Buying', 'Listing', 'Selling'] as const).map((c) => (
                <button key={c} onClick={() => void start(c)}>
                  <Play size={15} />
                  {c}
                </button>
              ))}
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
            </div>
          )}
        </div>
        <nav className="mobile-nav">
          {nav.map((n) => (
            <Link
              href={`${base}${n.href}`}
              key={n.href}
              className={section === n.label.toLowerCase() ? 'active' : ''}
            >
              <n.icon size={20} />
              <span>{n.label}</span>
            </Link>
          ))}
        </nav>
      </div>
      {editor && (
        <Editor
          key={`${editor.kind}-${editor.value?.id || 'new'}`}
          target={editor}
          onClose={() => setEditor(null)}
        />
      )}{' '}
      {importing && <Importer onClose={() => setImporting(false)} />}{' '}
      <Assistant
        open={assistant}
        onOpen={() => setAssistant(true)}
        onClose={() => setAssistant(false)}
        scope={demo ? 'demo' : email || 'private'}
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
