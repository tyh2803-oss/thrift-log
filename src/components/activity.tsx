'use client';
import { useState } from 'react';
import { Plus, MapPin, Clock3, Download, Navigation, Pause, Play, Square } from 'lucide-react';
import { currentLineProfits } from '@/lib/ledger';
import { useWorkspace } from '@/lib/use-workspace';
import { laborMs, duration, money } from '@/lib/finance';
import { downloadCsv } from '@/lib/csv';
import type { Session } from '@/lib/model';
import { Button } from './ui/button';
import { Empty, Badge, Status } from './shared';
import type { EditorTarget } from './editor';
export function Activity({
  range,
  onEdit,
  onStart,
  activeSession,
  onControl,
}: {
  range: [number, number];
  onEdit: (t: EditorTarget) => void;
  onStart: (category: Session['category'], links?: Partial<Session>) => void;
  activeSession?: Session;
  onControl: (action: 'pause' | 'resume' | 'end') => void;
}) {
  const { w, dispatch, notify } = useWorkspace();
  const [tab, setTab] = useState('Time');
  const [nearby, setNearby] = useState<string[]>([]);
  const sessions = w.sessions
    .filter(
      (s) =>
        s.state !== 'Deleted' &&
        s.segments.some(
          (r) =>
            +new Date(r.start) <= range[1] && +(r.end ? new Date(r.end) : new Date()) >= range[0],
        ),
    )
    .sort((a, b) => +new Date(b.segments[0].start) - +new Date(a.segments[0].start));
  function locate() {
    if (!navigator.geolocation) {
      notify('Foreground location is not available in this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const ids = w.locations
          .filter((l) => l.latitude !== null && l.longitude !== null)
          .filter((l) => {
            const lat = (l.latitude! - pos.coords.latitude) * 111000,
              lon =
                (l.longitude! - pos.coords.longitude) *
                111000 *
                Math.cos((pos.coords.latitude * Math.PI) / 180);
            return Math.hypot(lat, lon) < 500;
          })
          .map((l) => l.id);
        setNearby(ids);
        if (!ids.length) notify('No saved locations within approximately 500 meters.');
      },
      () => notify('Location is unavailable or permission was declined.'),
      { maximumAge: 60000, timeout: 10000 },
    );
  }
  return (
    <>
      <div className="page-toolbar">
        <div className="tabs">
          {['Time', 'Sourcing trips', 'Locations'].map((t) => (
            <button className={tab === t ? 'active' : ''} onClick={() => setTab(t)} key={t}>
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
                tab.toLowerCase().replaceAll(' ', '-'),
                tab === 'Time'
                  ? sessions.map((s) => ({
                      id: s.id,
                      category: s.category,
                      subcategory: s.subcategory,
                      start: s.segments[0].start,
                      end: s.segments.at(-1)?.end,
                      hours: laborMs([s]) / 3600000,
                      show_id: s.showId,
                      trip_id: s.tripId,
                      notes: s.notes,
                    }))
                  : tab === 'Locations'
                    ? w.locations
                    : w.trips.map((t) => ({ ...t, totalSpent: t.totalSpent / 100 })),
              )
            }
          >
            <Download size={15} />
            Export
          </Button>
          <Button
            size="sm"
            onClick={() =>
              onEdit({
                kind: tab === 'Time' ? 'session' : tab === 'Locations' ? 'location' : 'trip',
              })
            }
          >
            <Plus size={15} />
            {tab === 'Time' ? 'Log time' : tab === 'Locations' ? 'Save location' : 'Create trip'}
          </Button>
        </div>
      </div>
      {tab === 'Time' ? (
        <>
          {activeSession && (
            <section className="card active-timer" aria-label="Active timer">
              <span className="icon-tile">
                <Clock3 size={22} />
              </span>
              <div className="grow">
                <h2>
                  {activeSession.category}{' '}
                  {activeSession.state === 'Paused' ? '· paused' : '· running'}
                </h2>
                <p>
                  {duration(laborMs([activeSession]))} tracked · Your timer continues when you
                  navigate away.
                </p>
              </div>
              <div className="actions">
                <Button
                  type="button"
                  variant="outline"
                  aria-label={activeSession.state === 'Running' ? 'Pause timer' : 'Resume timer'}
                  onClick={() => onControl(activeSession.state === 'Running' ? 'pause' : 'resume')}
                >
                  {activeSession.state === 'Running' ? <Pause size={16} /> : <Play size={16} />}
                  {activeSession.state === 'Running' ? 'Pause' : 'Resume'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  aria-label="End timer"
                  onClick={() => onControl('end')}
                >
                  <Square size={16} />
                  End timer
                </Button>
              </div>
            </section>
          )}
          <div className="time-categories">
            {(['Buying', 'Listing', 'Selling'] as const).map((category, i) => (
              <section className={`card time-category time-color-${i}`} key={category}>
                <span className="icon-tile">
                  <Clock3 size={21} />
                </span>
                <div>
                  <h3>{category}</h3>
                  <strong>
                    {duration(
                      laborMs(
                        w.sessions.filter((s) => s.category === category),
                        ...range,
                      ),
                    )}
                  </strong>
                </div>
                <Button variant="outline" size="sm" onClick={() => onStart(category)}>
                  Start timer
                </Button>
              </section>
            ))}
          </div>
          <section className="card">
            <div className="card-heading">
              <h2>Time well spent</h2>
              <span className="muted">Overlapping intervals counted once in total hours</span>
            </div>
            {sessions.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Activity</th>
                      <th>Date</th>
                      <th>Linked work</th>
                      <th>Duration in period</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <button
                            className="cell-button"
                            onClick={() => {
                              if (s.state === 'Ended') onEdit({ kind: 'session', value: s });
                            }}
                          >
                            <strong>{s.category}</strong>
                            <small>{s.subcategory || s.notes || 'General work'}</small>
                          </button>
                        </td>
                        <td>{new Date(s.segments[0].start).toLocaleDateString()}</td>
                        <td>
                          {w.shows.find((show) => show.id === s.showId)?.name ||
                            w.trips.find((t) => t.id === s.tripId)?.name ||
                            w.locations.find((l) => l.id === s.locationId)?.name ||
                            '—'}
                        </td>
                        <td className="number">{duration(laborMs([s], ...range))}</td>
                        <td>
                          <Status value={s.state} />
                        </td>
                        <td>
                          {s.state === 'Ended' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                if (
                                  window.confirm(
                                    'Remove this erroneous time session? It will remain recoverable in storage.',
                                  )
                                )
                                  void dispatch({
                                    type: 'session',
                                    value: { ...s, state: 'Deleted' },
                                  });
                              }}
                            >
                              Remove
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                title="Your time matters, too"
                description="Start a timer or add a completed session to understand your hourly earnings."
              />
            )}
          </section>
        </>
      ) : tab === 'Sourcing trips' ? (
        <div className="show-grid">
          {w.trips.map((trip) => {
            const items = w.items.filter((i) => i.tripId === trip.id);
            const profitKnown = w.orders
              .flatMap((o) => currentLineProfits(w, o))
              .filter((l) => items.some((i) => i.id === l.itemId))
              .every((l) => l.profitKnown);
            const profit =
              w.orders
                .flatMap((o) => currentLineProfits(w, o))
                .filter((l) => items.some((i) => i.id === l.itemId))
                .reduce((n, l) => n + l.profit, 0) -
              w.expenses.filter((e) => e.tripId === trip.id).reduce((n, e) => n + e.amount, 0);
            const hours = laborMs(w.sessions.filter((s) => s.tripId === trip.id)) / 3600000;
            return (
              <section className="card trip-card" key={trip.id}>
                <div className="card-heading">
                  <span className="icon-tile">
                    <MapPin size={20} />
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onEdit({ kind: 'trip', value: trip })}
                  >
                    Edit
                  </Button>
                </div>
                <p className="eyebrow">
                  {new Date(trip.date).toLocaleDateString()} ·{' '}
                  {w.locations.find((l) => l.id === trip.locationId)?.name || 'Sourcing'}
                </p>
                <h2>{trip.name}</h2>
                <div className="trip-numbers">
                  <div>
                    <span>Purchase spending</span>
                    <strong>{money(trip.totalSpent)}</strong>
                  </div>
                  <div>
                    <span>Items acquired</span>
                    <strong>{items.length}</strong>
                  </div>
                  <div>
                    <span>Realized profit</span>
                    <strong className={profit >= 0 ? 'positive' : 'negative'}>
                      {profitKnown ? money(profit) : 'Unknown costs'}
                    </strong>
                  </div>
                  <div>
                    <span>Batch profit / labor hour</span>
                    <strong>{hours && profitKnown ? money(profit / hours) : '—'}</strong>
                  </div>
                </div>
                <p className="hint">
                  {money(items.reduce((n, i) => n + i.cost, 0))} assigned to item costs ·{' '}
                  {items.filter((i) => i.status !== 'Sold').length} unsold
                </p>
                <div className="actions">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      onStart('Buying', { tripId: trip.id, locationId: trip.locationId })
                    }
                  >
                    Start Buying timer
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onEdit({ kind: 'expense', tripId: trip.id })}
                  >
                    Add expense
                  </Button>
                </div>
              </section>
            );
          })}
          {!w.trips.length && (
            <section className="card">
              <Empty
                title="Finds worth keeping track of"
                description="Connect your sourcing spend, items, and time in a trip."
                action={
                  <Button onClick={() => onEdit({ kind: 'trip' })}>Create sourcing trip</Button>
                }
              />
            </section>
          )}
        </div>
      ) : (
        <>
          <div className="inline-note">
            <Navigation size={16} />
            <span>Location suggestions run only while you use the app.</span>
            <Button variant="outline" size="sm" onClick={locate}>
              Find nearby
            </Button>
          </div>
          <div className="show-grid">
            {w.locations.map((location) => {
              const active = w.sessions.find(
                (s) => s.locationId === location.id && ['Running', 'Paused'].includes(s.state),
              );
              return (
                <section className="card trip-card" key={location.id}>
                  <div className="card-heading">
                    <span className="icon-tile">
                      <MapPin size={20} />
                    </span>
                    {nearby.includes(location.id) && <Badge tone="green">Nearby</Badge>}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onEdit({ kind: 'location', value: location })}
                    >
                      Edit
                    </Button>
                  </div>
                  <h2>{location.name}</h2>
                  <p>{location.address}</p>
                  <p className="muted">
                    {duration(laborMs(w.sessions.filter((s) => s.locationId === location.id)))}{' '}
                    logged · {w.trips.filter((t) => t.locationId === location.id).length} trips
                  </p>
                  {active ? (
                    <Button
                      variant="outline"
                      onClick={() =>
                        void dispatch({
                          type: 'session',
                          value: {
                            ...active,
                            state: 'Ended',
                            segments: active.segments.map((r) =>
                              r.end ? r : { ...r, end: new Date().toISOString() },
                            ),
                          },
                        })
                      }
                    >
                      End visit
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => onStart('Buying', { locationId: location.id })}
                    >
                      Start visit
                    </Button>
                  )}
                </section>
              );
            })}
            {!w.locations.length && (
              <section className="card">
                <Empty
                  title="Save your favorite stops"
                  description="Start and end a Buying visit with a single tap."
                  action={
                    <Button onClick={() => onEdit({ kind: 'location' })}>Save a location</Button>
                  }
                />
              </section>
            )}
          </div>
        </>
      )}
    </>
  );
}
