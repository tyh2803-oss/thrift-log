'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Unplug, Radio, ExternalLink } from 'lucide-react';
import { useWorkspace } from '@/lib/use-workspace';
import {
  WHATNOT_SCOPES,
  type ConnectionStatus,
  type StoredRecord,
  type OrderSource,
  type Resolution,
} from '@/lib/integrations/whatnot/schema';
import { money, parseMoney } from '@/lib/money';
import type { LedgerTransaction } from '@/lib/integrations/whatnot/reports';
import { Button } from './ui/button';
import { Badge } from './shared';
export function WhatnotConnection() {
  const { demo, requestHeaders, refresh, notify } = useWorkspace();
  const [status, setStatus] = useState<ConnectionStatus | null>(null),
    [records, setRecords] = useState<StoredRecord[]>([]),
    [token, setToken] = useState(''),
    [secret, setSecret] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [review, setReview] = useState(false);
  const lock = useRef(false);
  const load = useCallback(
    async (withReview = false) => {
      if (demo) return;
      const r = await fetch(`/api/integrations/whatnot${withReview ? '?review=1' : ''}`, {
          headers: requestHeaders,
          cache: 'no-store',
        }),
        data = await r.json();
      if (!r.ok) {
        if (r.status === 401) {
          setStatus(null);
          setRecords([]);
        }
        throw new Error(data.error || 'Unable to read Whatnot connection.');
      }
      setStatus(data);
      if (withReview) setRecords(data.records || []);
    },
    [demo, requestHeaders],
  );
  useEffect(() => {
    const update = () => {
      if (document.visibilityState !== 'hidden')
        void load(review).catch((e) => setError(e.message));
    };
    const timer = setTimeout(update, 0);
    const poll = status?.connected ? setInterval(update, 15000) : undefined;
    document.addEventListener('visibilitychange', update);
    return () => {
      clearTimeout(timer);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', update);
    };
  }, [load, status?.connected, review]);
  async function act(payload: unknown) {
    if (lock.current || demo) return;
    lock.current = true;
    setBusy(true);
    setError('');
    if ((payload as { action: string }).action === 'disconnect') {
      setToken('');
      setSecret('');
      setRecords([]);
      setReview(false);
    }
    try {
      const r = await fetch('/api/integrations/whatnot', {
          method: 'POST',
          headers: { ...requestHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
        data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Whatnot did not confirm this action.');
      if (data.status && typeof data.status === 'object') setStatus(data.status);
      else if (data.ready !== undefined) setStatus(data);
      if (data.changed) await refresh();
      await load(review);
      notify(
        data.busy
          ? 'Whatnot sync is already running.'
          : data.hasMore
            ? 'Whatnot sync is continuing from saved progress.'
            : 'Whatnot connection updated.',
      );
      window.dispatchEvent(new Event('thrift-log.whatnot.changed'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Whatnot could not complete this action.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (demo)
    return (
      <div className="connection">
        <div className="card-heading">
          <strong>Whatnot</strong>
          <Badge>Private account required</Badge>
        </div>
        <p>
          Connect your own seller account from private Settings. Demo data and credentials stay
          separate.
        </p>
      </div>
    );
  const date = (value: string | null | undefined) =>
    value ? new Date(value).toLocaleString() : 'Not yet';
  return (
    <section className="connection whatnot-connection" aria-label="Whatnot connection">
      <div className="card-heading">
        <strong>
          <Radio size={16} /> Whatnot
        </strong>
        <Badge tone={status?.connected ? 'green' : 'amber'}>
          {status?.connected
            ? `@${status.username}`
            : status?.ready === false
              ? 'Setup needed'
              : 'Not connected'}
        </Badge>
      </div>
      <p>
        Read-only sales, shipping, shows and available financial reports. Thrift Log never changes
        your Whatnot listings, orders or inventory.
      </p>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {status?.error && (
        <p role="status" className="error-box">
          {status.error}
        </p>
      )}
      {status?.ready === false ? (
        <p className="hint">
          One-time administrator setup is needed before connecting. Existing inventory and financial
          records are unaffected. Apply the saved Whatnot integration migration; see the
          repository’s Whatnot setup guide.
        </p>
      ) : (
        <>
          {status?.connected && (
            <>
              <dl className="whatnot-sync-status">
                <div>
                  <dt>Last completed sync</dt>
                  <dd>{date(status.last_sync)}</dd>
                </div>
                <div>
                  <dt>Current state</dt>
                  <dd>
                    {status.status === 'syncing'
                      ? 'Syncing…'
                      : status.hasMore
                        ? `Importing ${status.progress}…`
                        : status.status}
                  </dd>
                </div>
              </dl>
              <div className="actions">
                <Button
                  variant="outline"
                  disabled={busy || status.status === 'auth_error'}
                  onClick={() => void act({ action: 'sync' })}
                >
                  <RefreshCw size={15} />
                  {busy ? 'Working…' : 'Refresh Whatnot'}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void act({ action: 'disconnect' })}
                >
                  <Unplug size={15} />
                  Disconnect
                </Button>
              </div>
              <p className="hint">
                Disconnect removes the stored token and stops sync. Imported records remain. Revoke
                the token in Whatnot’s developer dashboard to invalidate it there too.
              </p>
              {!!status.pending && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setReview(true);
                    void load(true).catch((e) => setError(e.message));
                  }}
                >
                  Review {status.pending} Whatnot updates
                </Button>
              )}
            </>
          )}
          <details open={status?.connected ? undefined : true}>
            <summary>
              {status?.connected ? 'Replace personal token' : 'Connect your Whatnot account'}
            </summary>
            <p>
              Create a personal token with these read permissions only: {WHATNOT_SCOPES.join(', ')}.
            </p>
            <a
              className="text-link"
              href="https://www.whatnot.com/dashboard/developer?tab=tokens"
              target="_blank"
              rel="noopener noreferrer"
            >
              Create token in Whatnot <ExternalLink size={12} />
            </a>
            <form
              className="editor-form"
              onSubmit={(e) => {
                e.preventDefault();
                const value = token;
                setToken('');
                void act({ action: 'connect', token: value });
              }}
            >
              <label className="field">
                <span>Whatnot personal access token</span>
                <input
                  aria-label="Whatnot personal access token"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={token}
                  disabled={busy || !status?.ready}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="wn_pat_tk_…"
                  required
                />
              </label>
              <small>
                The token is sent securely and encrypted on the server. It is never saved in browser
                storage or displayed again. Connecting authorizes importing your seller records into
                this workspace.
              </small>
              <Button type="submit" disabled={busy || !status?.ready || !token}>
                {busy
                  ? 'Connecting…'
                  : status?.connected
                    ? 'Replace token securely'
                    : 'Connect & import read-only'}
              </Button>
            </form>
          </details>
          {status?.connected && (
            <details>
              <summary>Optional: near-real-time webhooks</summary>
              <p>
                If your Whatnot developer app supports subscriptions, register this endpoint for
                order, shipment and show topics. Add its signing secret below. Polling works without
                webhooks.
              </p>
              <label className="field">
                <span>Whatnot webhook URL</span>
                <input
                  readOnly
                  value={
                    typeof window === 'undefined'
                      ? ''
                      : `${window.location.origin}/api/integrations/whatnot/webhook/${status.webhook_id}`
                  }
                  onFocus={(e) => e.target.select()}
                />
              </label>
              <p className="hint">
                Signing secret: {status.has_webhook ? 'Configured securely' : 'Not configured'}.
                Subscription creation is performed in Whatnot; the API does not expose a
                subscription-creation endpoint.
              </p>
              <form
                className="editor-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const value = secret;
                  setSecret('');
                  void act({ action: 'webhook', secret: value });
                }}
              >
                <label className="field">
                  <span>Whatnot webhook signing secret</span>
                  <input
                    type="password"
                    autoComplete="off"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    disabled={busy}
                    placeholder="wn_wh_…"
                    required
                  />
                </label>
                <Button type="submit" variant="outline" disabled={busy || !secret}>
                  Save signing secret
                </Button>
              </form>
            </details>
          )}
        </>
      )}
      <details>
        <summary>Sync coverage and financial limits</summary>
        <p>
          Full history imports in resumable batches. While this app is open, new records are checked
          periodically. Signed webhooks can trigger faster updates; a configured Vercel cron
          provides reconciliation while the app is closed.
        </p>
        <p>
          Seller fees require completed financial reports created in Whatnot. Thrift Log reads
          existing reports and never requests the write permission needed to generate them. Missing
          fees and purchase costs keep profit incomplete. Buyer tax and platform shipping are
          excluded from seller income.
        </p>
        <p>
          The documented API has no payout-transfer endpoint. Bank payouts remain manual. Net refund
          activity is imported for reconciliation; it never implies a physical return. Show earnings
          are labeled estimates and never replace business profit.
        </p>
        <a
          className="text-link"
          href="https://developers.whatnot.com/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Official Seller API documentation <ExternalLink size={12} />
        </a>
      </details>
      {review && records.length > 0 && (
        <div className="whatnot-review">
          <h3>Updates needing review</h3>
          <small>
            Showing up to 50 updates. Resolved updates leave this queue; other drafts and records
            remain.
          </small>
          {records.map((row) => (
            <WhatnotReview
              key={`${row.kind}:${row.external_id}:${row.hash}`}
              row={row}
              busy={busy}
              onResolve={(resolution) =>
                void act({ action: 'resolve', kind: row.kind, id: row.external_id, resolution })
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}
function WhatnotReview({
  row,
  busy,
  onResolve,
}: {
  row: StoredRecord;
  busy: boolean;
  onResolve: (resolution: Resolution) => void;
}) {
  const { w } = useWorkspace();
  const [selections, setSelections] = useState<Record<string, string>>({}),
    [costs, setCosts] = useState<Record<string, string>>({}),
    [fees, setFees] = useState(''),
    [processing, setProcessing] = useState('0'),
    [sellerShipping, setSellerShipping] = useState('0'),
    [refund, setRefund] = useState(''),
    [credit, setCredit] = useState('0'),
    [shipping, setShipping] = useState('0'),
    [error, setError] = useState('');
  const source =
    row.kind === 'order'
      ? (row.payload as { source?: OrderSource; adopted?: boolean }).source
      : null;
  const adopted = row.kind === 'order' && (row.payload as { adopted?: boolean }).adopted;
  const units =
    source?.items.flatMap((item) =>
      Array.from({ length: Math.min(31, item.quantity) }, (_, n) => ({
        key: `${item.id}:${n}`,
        title: item.purchased_item?.title || 'Missing source title',
        sku: item.purchased_item?.sku,
      })),
    ) || [];
  const tx = row.kind === 'transaction' ? (row.payload as LedgerTransaction) : null;
  const canRefund = tx?.type === 'ORDER_REFUND' && row.local_id;
  return (
    <details className="whatnot-review-card">
      <summary>
        {row.kind === 'order'
          ? `Order ${row.external_id}`
          : row.kind === 'transaction'
            ? `${tx?.type} · ${row.external_id}`
            : `${row.kind} ${row.external_id}`}
      </summary>
      <p className="warning-text">{row.issue}</p>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {source && units.length <= 30 && (
        <form
          className="editor-form"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              const decisions: NonNullable<Resolution['units']> = {};
              for (const unit of units) {
                const itemId = selections[unit.key];
                if (!itemId) throw new Error('Choose the physical item for every source unit.');
                const raw = costs[unit.key] || '';
                const cost = raw.trim() ? parseMoney(raw) : null;
                if (cost !== null && cost < 0)
                  throw new Error('Purchase cost must be non-negative.');
                decisions[unit.key] = { itemId, cost };
              }
              setError('');
              onResolve({ units: decisions });
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Review the selected inventory.');
            }
          }}
        >
          {units.map((unit) => (
            <div className="whatnot-review-unit" key={unit.key}>
              <strong>{unit.title}</strong>
              <small>{unit.sku || 'No source SKU'}</small>
              <label className="field">
                <span>Physical item · {unit.key}</span>
                <select
                  required
                  value={selections[unit.key] || ''}
                  onChange={(e) => setSelections({ ...selections, [unit.key]: e.target.value })}
                  disabled={busy}
                >
                  <option value="">Choose inventory</option>
                  {!adopted && <option value="new">Create a distinct physical item</option>}
                  {w.items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.sku} · {i.title}
                    </option>
                  ))}
                </select>
              </label>
              {!adopted && (
                <label className="field">
                  <span>Purchase cost · optional</span>
                  <input
                    inputMode="decimal"
                    value={costs[unit.key] || ''}
                    onChange={(e) => setCosts({ ...costs, [unit.key]: e.target.value })}
                    disabled={busy}
                    placeholder="Unknown"
                  />
                </label>
              )}
            </div>
          ))}
          <Button disabled={busy}>Resolve item matches</Button>
        </form>
      )}
      {tx?.type === 'ORDER_EARNINGS' && row.local_id && !tx.revisionConflict && (
        <form
          className="editor-form"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              onResolve({
                earnings: {
                  fees: parseMoney(fees),
                  processing: parseMoney(processing),
                  shipping: parseMoney(sellerShipping),
                },
              });
              setError('');
            } catch {
              setError('Enter the actual seller charges, including any tax on fees.');
            }
          }}
        >
          <p>
            Reported net earnings: {money(tx.amount)}. Enter actual seller charges from Whatnot;
            they must reconcile exactly to this order’s merchandise proceeds.
          </p>
          <label className="field">
            <span>Commission and tax ($)</span>
            <input
              inputMode="decimal"
              value={fees}
              onChange={(e) => setFees(e.target.value)}
              disabled={busy}
              required
            />
          </label>
          <label className="field">
            <span>Processing and tax ($)</span>
            <input
              inputMode="decimal"
              value={processing}
              onChange={(e) => setProcessing(e.target.value)}
              disabled={busy}
              required
            />
          </label>
          <label className="field">
            <span>Seller shipping cost ($)</span>
            <input
              inputMode="decimal"
              value={sellerShipping}
              onChange={(e) => setSellerShipping(e.target.value)}
              disabled={busy}
              required
            />
          </label>
          <Button disabled={busy}>Reconcile seller charges</Button>
        </form>
      )}
      {canRefund && (
        <form
          className="editor-form"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              onResolve({
                refund: {
                  amount: parseMoney(refund),
                  feeCredit: parseMoney(credit),
                  shippingAdjustment: parseMoney(shipping),
                },
              });
              setError('');
            } catch {
              setError('Enter the actual refund and cost amounts.');
            }
          }}
        >
          <p>
            Reported seller ledger change: {money(tx!.amount)}. Enter the actual refund breakdown
            from Whatnot; no inventory return will be assumed.
          </p>
          <label className="field">
            <span>Customer refund ($)</span>
            <input
              inputMode="decimal"
              required
              value={refund}
              onChange={(e) => setRefund(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="field">
            <span>Seller fee credit ($)</span>
            <input
              inputMode="decimal"
              required
              value={credit}
              onChange={(e) => setCredit(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="field">
            <span>Shipping cost adjustment ($; negative for credit)</span>
            <input
              inputMode="decimal"
              required
              value={shipping}
              onChange={(e) => setShipping(e.target.value)}
              disabled={busy}
            />
          </label>
          <Button disabled={busy}>Reconcile refund</Button>
        </form>
      )}
      <Link className="text-link" href="/sales">
        Open saved sales and show records
      </Link>
    </details>
  );
}
