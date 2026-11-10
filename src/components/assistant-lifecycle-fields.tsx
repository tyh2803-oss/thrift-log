'use client';
import { money } from '@/lib/money';
import { listingAmount } from '@/lib/assistant/listing-review';
import { Button } from './ui/button';
import { correctedMarketplace } from '@/lib/assistant/vision';
import { isLifecycle, orderCandidates } from '@/lib/assistant/lifecycle';
import { returnedItemIds } from '@/lib/ledger';
import type { DraftRow } from '@/lib/assistant/drafts';
import type { Workspace } from '@/lib/model';
import { eventNames, changeEvent } from '@/lib/assistant/events';
export { eventNames } from '@/lib/assistant/events';
export function LifecycleFields({
  row,
  w,
  busy,
  onChange,
  relatedOrder,
}: {
  relatedOrder?: Workspace['orders'][number];
  row: DraftRow;
  w: Workspace;
  busy: boolean;
  onChange: (row: DraftRow) => void;
}) {
  const r = row.facts;
  const type =
    r.event?.type ||
    (r.kind === 'listing' ? 'active_listing' : r.kind === 'sale' ? 'completed_sale' : 'ambiguous');
  const candidates = orderCandidates(w, row),
    order = relatedOrder || (candidates.length === 1 ? candidates[0] : undefined);
  const orders = [
    ...w.orders,
    ...(relatedOrder && !w.orders.some((o) => o.id === relatedOrder.id) ? [relatedOrder] : []),
  ].filter((o) => !r.marketplace || r.marketplace === o.marketplace);
  const selected =
    row.targetItemIds ??
    (order &&
    r.event?.scope === 'order' &&
    !!r.externalOrderId &&
    r.externalOrderId === order.externalId
      ? order.lines.filter((l) => !returnedItemIds(w, order.id).has(l.itemId)).map((l) => l.itemId)
      : order?.lines.length === 1
        ? [order.lines[0].itemId]
        : row.matches.map((m) => m.itemId).filter((id): id is string => !!id));
  return (
    <fieldset disabled={busy} className="assistant-lifecycle-fields">
      <label className="field">
        <span>What happened?</span>
        <select
          aria-label="What happened?"
          value={type}
          onChange={(e) => onChange(changeEvent(row, e.target.value as keyof typeof eventNames))}
        >
          {Object.entries(eventNames).map(([v, title]) => (
            <option value={v} key={v}>
              {title}
            </option>
          ))}
        </select>
      </label>
      {r.event && (
        <small>
          {r.event.confirmedByUser
            ? 'Event confirmed by you'
            : `Event identification: ${r.event.confidence}`}{' '}
          · {r.event.evidence.join(' · ')}
        </small>
      )}
      {r.event &&
        r.event.confidence !== 'clear' &&
        !r.event.confirmedByUser &&
        type !== 'ambiguous' && (
          <Button variant="outline" size="sm" onClick={() => onChange(changeEvent(row, type))}>
            Confirm this event
          </Button>
        )}
      {(isLifecycle(r.kind) || r.kind === 'other') && (
        <label className="field">
          <span>Marketplace</span>
          <select
            aria-label="Marketplace"
            value={r.marketplace || ''}
            onChange={(e) => {
              const marketplace = (e.target.value || null) as typeof r.marketplace;
              onChange({
                ...row,
                facts: {
                  ...r,
                  marketplace,
                  marketplaceIdentification: correctedMarketplace(
                    r.marketplaceIdentification,
                    marketplace,
                  ),
                },
              });
            }}
          >
            <option value="">Choose marketplace</option>
            {['Vinted', 'Depop', 'eBay', 'Whatnot', 'In person'].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
      )}
      {isLifecycle(r.kind) && (
        <>
          <label className="field">
            <span>Existing order</span>
            <select
              aria-label="Existing order"
              value={order?.id || row.orderId || ''}
              onChange={(e) =>
                onChange({ ...row, orderId: e.target.value || null, targetItemIds: undefined })
              }
            >
              <option value="">Choose existing sale</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {!w.orders.some((existing) => existing.id === o.id)
                    ? 'Proposed sale in this batch · '
                    : ''}
                  {o.marketplace} · {o.externalId || o.id.slice(0, 8)} ·{' '}
                  {o.lines
                    .map((l) => w.items.find((i) => i.id === l.itemId)?.title || 'Item')
                    .join(', ')}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Event date (workspace timezone)</span>
            <input
              value={r.date || ''}
              placeholder="YYYY-MM-DD or timestamp"
              onChange={(e) => onChange({ ...row, facts: { ...r, date: e.target.value || null } })}
            />
          </label>
          {order && order.lines.length > 1 && (
            <div>
              <strong>Affected physical items</strong>
              {order.lines.map((l) => (
                <label className="check-row" key={l.itemId}>
                  <input
                    type="checkbox"
                    checked={selected.includes(l.itemId)}
                    disabled={returnedItemIds(w, order.id).has(l.itemId)}
                    onChange={(e) =>
                      onChange({
                        ...row,
                        targetItemIds: e.target.checked
                          ? [...selected, l.itemId]
                          : selected.filter((id) => id !== l.itemId),
                      })
                    }
                  />
                  {w.items.find((i) => i.id === l.itemId)?.title || l.itemId}
                </label>
              ))}
            </div>
          )}
          {order &&
            w.shipments.some((s) => s.orderIds.includes(order.id) && s.orderIds.length > 1) && (
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={!!row.confirmPackage}
                  onChange={(e) => onChange({ ...row, confirmPackage: e.target.checked })}
                />
                Update the entire linked package, including its other orders.
              </label>
            )}
          {r.kind === 'fulfillment' && (
            <>
              {(['carrier', 'tracking'] as const).map((key) => (
                <label className="field" key={key}>
                  <span>{key === 'carrier' ? 'Carrier' : 'Tracking'}</span>
                  <input
                    maxLength={500}
                    value={r.event?.[key] || ''}
                    onChange={(e) => {
                      const next = changeEvent(row, type);
                      next.facts.event![key] = e.target.value || null;
                      onChange(next);
                    }}
                  />
                </label>
              ))}
              <small>
                No shipping expense is assumed. When label cost is unknown, tracking stays in
                private import evidence and fulfillment dates are saved on the order.
              </small>
            </>
          )}
          {r.kind === 'return' && (
            <label className="check-row">
              <input
                type="checkbox"
                checked={!!row.confirmPhysicalReturn}
                onChange={(e) => onChange({ ...row, confirmPhysicalReturn: e.target.checked })}
              />
              I received these physical items back. A refund alone does not restock them.
            </label>
          )}
          {r.kind === 'return' && (
            <>
              <small>
                Physical receipt is recorded separately from a refund. Existing refund entries are
                preserved.
              </small>
              {r.refund !== null && r.refund > 0 && (
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={!!row.applyRefund}
                    onChange={(e) => onChange({ ...row, applyRefund: e.target.checked })}
                  />
                  Also record the verified refund {money(r.refund)}. Leave unchecked if already
                  recorded.
                </label>
              )}
            </>
          )}
          {(r.kind === 'refund' || (r.kind === 'return' && row.applyRefund)) && (
            <label className="field">
              <span>Refund currency</span>
              <select
                aria-label="Refund currency"
                value={r.currency || ''}
                onChange={(e) =>
                  onChange({ ...row, facts: { ...r, currency: e.target.value || null } })
                }
              >
                <option value="">Confirm currency</option>
                {r.currency && r.currency !== 'USD' && <option>{r.currency}</option>}
                <option>USD</option>
              </select>
            </label>
          )}
          {r.kind === 'fulfillment' && (
            <small>Fulfillment only — no new sale or shipping expense is created.</small>
          )}
          {r.kind === 'refund' && (
            <label className="field">
              <span>Verified refund ($)</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={r.refund === null ? '' : r.refund / 100}
                onChange={(e) => {
                  const raw = e.target.value;
                  onChange({ ...row, facts: { ...r, refund: listingAmount(raw).value } });
                }}
              />
            </label>
          )}
        </>
      )}
    </fieldset>
  );
}
