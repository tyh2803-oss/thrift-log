'use client';
import { useState, type FormEvent } from 'react';
import { useWorkspace } from '@/lib/use-workspace';
import { financialEventSchema, financialKinds, type FinancialEvent } from '@/lib/model';
import { currentOrderTotals, returnedItemIds, paidForOrder } from '@/lib/ledger';
import { money, parseMoney } from '@/lib/finance';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';
import { Field } from './editor';
import { Metric, Badge } from './shared';
const localDate = () => {
  const d = new Date();
  return new Date(+d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
export function OrderLedger({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const { w, dispatch, saving, error: workspaceError, notify } = useWorkspace();
  const order = w.orders.find((o) => o.id === orderId)!;
  const [initialDate] = useState(localDate);
  const [kind, setKind] = useState<FinancialEvent['kind']>('Refund');
  const [returns, setReturns] = useState<string[]>([]);
  const [error, setError] = useState('');
  const total = currentOrderTotals(w, order);
  const restored = returnedItemIds(w, order.id);
  const events = w.financialEvents
    .filter((e) => e.orderId === order.id)
    .sort((a, b) => +new Date(b.date) - +new Date(a.date));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      const form = new FormData(event.currentTarget);
      const value = financialEventSchema.parse({
        id: crypto.randomUUID(),
        orderId,
        kind,
        date:
          String(form.get('date')) === initialDate
            ? new Date().toISOString()
            : new Date(String(form.get('date'))).toISOString(),
        amount: ['Return', 'Reversal'].includes(kind)
          ? 0
          : parseMoney(String(form.get('amount') || '0')),
        reason: String(form.get('reason')),
        itemIds: ['Refund', 'Return'].includes(kind) ? returns : [],
        reversesId: kind === 'Reversal' ? String(form.get('reversesId')) : null,
        category: String(form.get('category') || 'Other'),
        externalId: String(form.get('externalId') || ''),
      });
      if (await dispatch({ type: 'financialEvent', value })) {
        notify('Dated event recorded. Earlier reporting periods retain their original sale.');
        setReturns([]);
        (event.target as HTMLFormElement).reset();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check the financial event.');
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title="Order adjustments & returns"
      description={`${order.marketplace} · ${order.externalId || order.id.slice(0, 8)} · Every correction keeps its date and audit trail.`}
      wide
    >
      <div className="padded">
        <div className="metric-grid compact">
          <Metric
            label="Lifetime revenue"
            value={money(total.revenue)}
            note="Including dated adjustments"
          />
          <Metric
            label="Lifetime profit"
            value={total.profitKnown ? money(total.profit) : '—'}
            note={total.profitKnown ? 'After actual costs' : 'Purchase cost unknown · incomplete'}
            positive={total.profitKnown && total.profit > 0}
          />
          <Metric
            label="Inventory returned"
            value={`${restored.size} / ${order.lines.length}`}
            note="Physical pieces restored"
          />
          <Metric
            label="Payout cash allocated"
            value={money(paidForOrder(w, order.id))}
            note="Actual recorded receipts"
          />
        </div>
        <form className="editor-form ledger-form" onSubmit={submit}>
          {(error || workspaceError) && (
            <div role="alert" className="error-box">
              {error || workspaceError}
            </div>
          )}
          <div className="form-grid">
            <label className="field">
              <span>Event type</span>
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as FinancialEvent['kind']);
                  setReturns([]);
                }}
              >
                {financialKinds.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <Field
              label="Event date"
              name="date"
              type="datetime-local"
              value={initialDate}
              required
            />
            {!['Return', 'Reversal'].includes(kind) && (
              <Field
                label={kind === 'Refund' ? 'Refund paid ($)' : 'Adjustment ($, signed)'}
                name="amount"
                type="number"
                value="0.00"
                step="0.01"
                min={kind === 'Refund' ? '0' : undefined}
                required
              />
            )}
            {kind === 'Direct cost adjustment' && (
              <label className="field">
                <span>Cost category</span>
                <select name="category">
                  <option>Other</option>
                  <option>Shipping</option>
                  <option>Packaging</option>
                </select>
              </label>
            )}
            {kind === 'Reversal' && (
              <label className="field">
                <span>Original event to reverse</span>
                <select name="reversesId" required>
                  <option value="">Select a posted event</option>
                  {events
                    .filter(
                      (e) => e.kind !== 'Reversal' && !events.some((r) => r.reversesId === e.id),
                    )
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.kind} · {money(e.amount)} · {e.reason}
                      </option>
                    ))}
                </select>
              </label>
            )}
          </div>
          {['Refund', 'Return'].includes(kind) && order.status === 'Completed' && (
            <div className="line-items">
              <h4>Physical pieces returned (optional with a refund)</h4>
              {order.lines.map((line) => {
                const item = w.items.find((i) => i.id === line.itemId)!;
                return (
                  <label className="check-row" key={item.id}>
                    <input
                      type="checkbox"
                      disabled={restored.has(item.id)}
                      checked={returns.includes(item.id)}
                      onChange={(e) =>
                        setReturns(
                          e.target.checked
                            ? [...returns, item.id]
                            : returns.filter((id) => id !== item.id),
                        )
                      }
                    />
                    <span>
                      {item.sku} · {item.title}
                      {restored.has(item.id) ? ' · already returned' : ''}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          <Field label="Reason" name="reason" required />
          <Field label="External adjustment ID (optional)" name="externalId" />
          <p className="hint">
            Refunds reduce revenue. A fee adjustment is positive for a charge and negative for a
            credit. Physical returns restore original cost basis only for the checked pieces. A
            reversal posts the opposite effect today; it does not erase history. Legacy cumulative
            adjustments remain on the original sale date.
          </p>
          <div className="form-footer">
            <Button disabled={saving} type="submit">
              {saving ? 'Recording…' : 'Record dated event'}
            </Button>
          </div>
        </form>
        <h3>Dated history</h3>
        {events.length ? (
          events.map((e) => (
            <div className="detail-row" key={e.id}>
              <div className="grow">
                <strong>
                  {e.kind} · {e.reason}
                </strong>
                <small>
                  {new Date(e.date).toLocaleString()} · {e.itemIds.length} physical returns
                </small>
              </div>
              <strong>{money(e.amount)}</strong>
              <Badge>
                {e.reversesId
                  ? 'Reversal'
                  : events.some((r) => r.reversesId === e.id)
                    ? 'Reversed'
                    : 'Posted'}
              </Badge>
            </div>
          ))
        ) : (
          <p className="hint">
            No dated adjustments yet. Original refunds, credits, and status changes remain visible
            in the original order.
          </p>
        )}
      </div>
    </Dialog>
  );
}
