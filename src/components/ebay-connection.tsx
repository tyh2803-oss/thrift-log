'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, RefreshCw, Unplug } from 'lucide-react';
import { useWorkspace } from '@/lib/use-workspace';
import { parseMoney } from '@/lib/money';
import {
  orderSourceSchema,
  transactionSourceSchema,
  payoutSourceSchema,
  type ConnectionStatus,
  type StoredRecord,
  type Resolution,
} from '@/lib/integrations/ebay/schema';
import { Button } from './ui/button';
import { Badge } from './shared';
const messages: Record<string, string> = {
  connected: 'eBay connected. Your supported order history will import in resumable batches.',
  cancelled: 'eBay connection was cancelled. Existing records are unchanged.',
  state: 'The connection attempt expired or was already used. Choose Connect eBay again.',
  signin: 'Sign in to the same Thrift Log account, then connect again.',
  permissions:
    'eBay has not enabled the requested API permissions. Try orders-only access or check the developer application.',
  conflict:
    'This seller is already connected or differs from the current connection. Disconnect before switching.',
  setup: 'Complete the administrator setup before connecting.',
  auth: 'eBay authorization could not be verified. Start Connect eBay again.',
  error: 'eBay could not complete the connection. Try again; existing records are unchanged.',
};
export function EbayConnection() {
  const { demo, requestHeaders, refresh } = useWorkspace(),
    [status, setStatus] = useState<(ConnectionStatus & { financeAvailable?: boolean }) | null>(
      null,
    ),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState<StoredRecord[] | null>(null),
    lock = useRef(false),
    [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const load = useCallback(async () => {
    if (demo) return;
    try {
      const r = await fetch('/api/integrations/ebay', {
        cache: 'no-store',
        headers: requestHeaders,
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not read eBay connection status.');
      setStatus(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read eBay connection status.');
    }
  }, [demo, requestHeaders]);
  useEffect(() => {
    if (demo) return;
    const timer = setTimeout(() => {
      void load();
      const url = new URL(window.location.href),
        result = url.searchParams.get('ebay');
      if (result) {
        setNotice(messages[result] || messages.error);
        url.searchParams.delete('ebay');
        window.history.replaceState(null, '', url.pathname + url.search + url.hash);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [demo, load]);
  async function action(data: Record<string, unknown>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await fetch('/api/integrations/ebay', {
          method: 'POST',
          headers: { ...requestHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }),
        d = await r.json();
      if (!r.ok) throw new Error(d.error || 'eBay could not complete this action.');
      if (data.action === 'connect') {
        const url = new URL(d.url);
        if (
          !['auth.ebay.com', 'auth.sandbox.ebay.com'].includes(url.hostname) ||
          url.protocol !== 'https:'
        )
          throw new Error('The eBay authorization address is invalid.');
        window.location.assign(url.href);
        return;
      }
      if (d.status) setStatus(d.status);
      else await load();
      if (d.changed) await refresh();
      setNotice(
        data.action === 'disconnect'
          ? 'Disconnected. Imported records are kept.'
          : d.busy
            ? 'A sync or save is already running. Your progress is preserved.'
            : d.hasMore
              ? 'Current batch saved. Remaining history will continue importing.'
              : 'Refresh completed. Supported records are saved; any remaining exceptions appear below.',
      );
      setConfirmDisconnect(false);
      window.dispatchEvent(new Event('thrift-log.ebay.changed'));
      if (review) await showReview();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'eBay could not complete this action.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function showReview() {
    try {
      const r = await fetch('/api/integrations/ebay?review=1', {
          cache: 'no-store',
          headers: requestHeaders,
        }),
        d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not open eBay review.');
      setReview(d.records || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open eBay review.');
    }
  }
  return (
    <div className="connection ebay-connection" id="ebay-connection" aria-busy={busy}>
      <div className="card-heading">
        <strong>eBay</strong>
        <Badge tone={status?.connected ? 'green' : 'amber'}>
          {demo
            ? 'Demo'
            : !status
              ? 'Checking…'
              : !status.ready || !status.configured
                ? 'Setup needed'
                : status.connected
                  ? status.status === 'auth_error'
                    ? 'Reconnect needed'
                    : 'Connected'
                  : 'Not connected'}
        </Badge>
      </div>
      <p>
        Read-only order history, confirmed shipments and available financial transactions. Thrift
        Log never publishes listings, issues refunds or changes your eBay account.
      </p>
      {demo ? (
        <p className="hint">
          Sign in to connect your own eBay account. Demo records stay separate.
        </p>
      ) : (
        <>
          {!!status?.setup && <p className="hint">{status.setup}</p>}
          {!!status?.environment && status.environment === 'sandbox' && (
            <Badge tone="amber">Sandbox · test data only</Badge>
          )}
          {!!status?.username && status.connected && (
            <p>
              Connected as <strong>{status.username}</strong> ·{' '}
              {status.financials ? 'Orders + financial access' : 'Orders only'}
            </p>
          )}
          {!!status?.last_sync && (
            <p className="hint">Last order sync: {new Date(status.last_sync).toLocaleString()}</p>
          )}
          {status?.financials && (
            <p className="hint">
              Last financial sync:{' '}
              {status.last_financial_sync
                ? new Date(status.last_financial_sync).toLocaleString()
                : 'Awaiting complete financial backfill'}
            </p>
          )}
          {!!status?.hasMore && status.connected && (
            <p role="status">
              Importing {status.progress || 'orders'}… You can keep using the app. Refresh resumes
              saved progress.
            </p>
          )}
          {!!status?.error && (
            <p className="error-box" role="alert">
              {status.error}
            </p>
          )}
          {!!status?.financial_error && (
            <p className="error-box" role="alert">
              {status.financial_error}
            </p>
          )}
          {status?.ready && status.configured && (
            <div className="actions">
              <Button
                disabled={busy}
                variant={status.connected ? 'outline' : 'default'}
                onClick={() => void action({ action: 'connect', financials: false })}
              >
                {busy ? 'Working…' : status.connected ? 'Reconnect eBay (orders)' : 'Connect eBay'}
              </Button>
              {!!status.financeAvailable && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void action({ action: 'connect', financials: true })}
                >
                  {status.financials
                    ? 'Reconnect with financial data'
                    : 'Connect with financial data'}
                </Button>
              )}
              {!!status.connected && (
                <>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void action({ action: 'sync' })}
                  >
                    <RefreshCw size={15} /> Refresh eBay
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setConfirmDisconnect(true)}
                  >
                    <Unplug size={15} /> Disconnect eBay
                  </Button>
                </>
              )}
            </div>
          )}
          {confirmDisconnect && (
            <div className="card padded">
              <p>
                Disconnect this eBay account and remove its stored tokens? Saved inventory and sales
                will remain.
              </p>
              <Button disabled={busy} onClick={() => void action({ action: 'disconnect' })}>
                Confirm disconnect
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setConfirmDisconnect(false)}>
                Keep connected
              </Button>
            </div>
          )}
          {!!status?.pending && (
            <Button variant="outline" disabled={busy} onClick={() => void showReview()}>
              Review {status.pending} eBay updates
            </Button>
          )}
        </>
      )}
      {!!notice && <p role="status">{notice}</p>}
      {!!error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      <details>
        <summary>What sync includes</summary>
        <p>
          Imports up to two years of accessible orders, then checks new and changed records.
          Purchase costs are never guessed. Repeated names and SKUs do not block new physical
          pieces; the same eBay order is updated safely on retries.
        </p>
        <p>
          Optional financial access reads seller fees, postage charges, refunds and bank payouts.
          eBay requires a broader financial permission label even though this app only reads those
          APIs. Some accounts require additional approval or EU/UK signatures. Unsupported
          adjustments and net refunds need financial reconciliation, never an assumed physical
          return.
        </p>
        <p>
          Active listings created outside eBay’s Inventory API are not imported. Older sales remain
          available through CSV. No eBay Live/show API is assumed. Disconnecting stops sync and
          removes this app’s tokens; revoke consent in eBay as well if desired.
        </p>
      </details>
      <a
        href="https://developer.ebay.com/api-docs/sell/fulfillment/overview.html"
        className="text-link"
        target="_blank"
        rel="noopener noreferrer"
      >
        Official eBay API documentation <ExternalLink size={12} />
      </a>
      {review && (
        <section className="stack" aria-label="eBay updates needing review">
          <div className="card-heading">
            <h3>eBay updates needing review</h3>
            <Button variant="ghost" onClick={() => setReview(null)}>
              Close review
            </Button>
          </div>
          {!review.length ? (
            <p>All caught up.</p>
          ) : (
            review.map((r) => (
              <EbayReview
                key={`${r.kind}:${r.external_id}`}
                record={r}
                busy={busy}
                save={(resolution) =>
                  action({ action: 'resolve', kind: r.kind, id: r.external_id, resolution })
                }
              />
            ))
          )}
          <p className="hint">Showing up to 100 updates. Resolved updates leave this queue.</p>
        </section>
      )}
    </div>
  );
}
function EbayReview({
  record,
  busy,
  save,
}: {
  record: StoredRecord;
  busy: boolean;
  save: (resolution: Resolution) => Promise<void>;
}) {
  const { w } = useWorkspace(),
    [costs, setCosts] = useState<Record<string, string>>({}),
    [items, setItems] = useState<Record<string, string>>({}),
    [refund, setRefund] = useState(''),
    [credit, setCredit] = useState(''),
    [allocations, setAllocations] = useState([{ orderId: '', amount: '' }]),
    [error, setError] = useState('');
  const raw = record.payload as { source?: unknown },
    source = orderSourceSchema.safeParse(raw?.source),
    tx = transactionSourceSchema.safeParse(record.payload),
    payout = payoutSourceSchema.safeParse(record.payload);
  async function submit() {
    setError('');
    try {
      let resolution: Resolution;
      if (record.kind === 'order' && source.success) {
        const units: NonNullable<Resolution['units']> = {};
        for (const l of source.data.lineItems)
          for (let i = 0; i < l.quantity; i++) {
            const key = `${l.lineItemId}:${i}`;
            units[key] = {
              itemId: items[key] || 'new',
              cost: costs[key]?.trim() ? parseMoney(costs[key]) : null,
            };
          }
        resolution = { units };
      } else if (
        record.kind === 'transaction' &&
        tx.success &&
        tx.data.transactionType === 'REFUND'
      ) {
        if (!refund.trim() || !credit.trim())
          throw new Error('Enter the seller-funded refund and fee credit ($0 if none).');
        resolution = { refund: { amount: parseMoney(refund), feeCredit: parseMoney(credit) } };
      } else if (record.kind === 'payout' && payout.success) {
        resolution = {
          allocations: allocations.map((a) => ({
            orderId: a.orderId,
            amount: parseMoney(a.amount),
          })),
        };
      } else return;
      await save(resolution);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check the entered values.');
    }
  }
  return (
    <details className="card padded ebay-review">
      <summary>
        {record.kind === 'order' ? 'Order' : record.kind === 'payout' ? 'Payout' : 'Transaction'}{' '}
        {record.external_id}
      </summary>
      <p>{record.issue}</p>
      {record.kind === 'order' &&
        source.success &&
        source.data.lineItems.flatMap((l) =>
          Array.from({ length: l.quantity }, (_, i) => {
            const key = `${l.lineItemId}:${i}`;
            return (
              <div className="card padded" key={key}>
                <strong>
                  {l.title}
                  {l.quantity > 1 ? ` · piece ${i + 1}` : ''}
                </strong>
                <label className="field">
                  Inventory item
                  <select
                    aria-label={`Inventory for ${l.title} piece ${i + 1}`}
                    value={items[key] || 'new'}
                    onChange={(e) => setItems({ ...items, [key]: e.target.value })}
                  >
                    <option value="new">Create new physical item</option>
                    {w.items
                      .filter((item) => item.status !== 'Sold')
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.title} · {item.sku}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="field">
                  Purchase cost · optional
                  <input
                    inputMode="decimal"
                    value={costs[key] || ''}
                    onChange={(e) => setCosts({ ...costs, [key]: e.target.value })}
                    disabled={busy}
                    placeholder="Unknown"
                  />
                </label>
              </div>
            );
          }),
        )}
      {record.kind === 'transaction' && tx.success && tx.data.transactionType === 'REFUND' && (
        <div className="form-grid">
          <label className="field">
            Actual seller-funded refund ($)
            <input
              inputMode="decimal"
              value={refund}
              onChange={(e) => setRefund(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="field">
            Seller fee credit ($)
            <input
              inputMode="decimal"
              value={credit}
              onChange={(e) => setCredit(e.target.value)}
              disabled={busy}
            />
          </label>
        </div>
      )}
      {record.kind === 'payout' && payout.success && (
        <>
          <p>
            Confirmed bank amount: {payout.data.amount.currency} {payout.data.amount.value}.
            Allocations must sum exactly; payouts do not increase revenue.
          </p>
          {allocations.map((a, i) => (
            <div className="form-grid" key={i}>
              <label className="field">
                Saved eBay order
                <select
                  value={a.orderId}
                  onChange={(e) =>
                    setAllocations(
                      allocations.map((v, j) => (j === i ? { ...v, orderId: e.target.value } : v)),
                    )
                  }
                >
                  <option value="">Choose order</option>
                  {w.orders
                    .filter((o) => o.marketplace === 'eBay')
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.externalId || o.id}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                Allocated amount ($)
                <input
                  inputMode="decimal"
                  value={a.amount}
                  onChange={(e) =>
                    setAllocations(
                      allocations.map((v, j) => (i === j ? { ...v, amount: e.target.value } : v)),
                    )
                  }
                />
              </label>
            </div>
          ))}
          <Button
            disabled={busy}
            variant="outline"
            onClick={() => setAllocations([...allocations, { orderId: '', amount: '' }])}
          >
            Add order allocation
          </Button>
          <small>{allocations.length} order allocation rows</small>
        </>
      )}
      {!!error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {(record.kind === 'order' ||
        (record.kind === 'transaction' && tx.success && tx.data.transactionType === 'REFUND') ||
        record.kind === 'payout') && (
        <Button disabled={busy} onClick={() => void submit()}>
          Save reviewed eBay update
        </Button>
      )}
      <p className="hint">
        {record.kind === 'transaction' && tx.success
          ? `Reported ${tx.data.bookingEntry.toLowerCase()}: ${tx.data.amount.currency} ${tx.data.amount.value}. `
          : ''}
        Saved financial entries remain unchanged until validation succeeds.
      </p>
    </details>
  );
}
