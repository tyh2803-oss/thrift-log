'use client';
import { useState } from 'react';
import { useWorkspace } from '@/lib/use-workspace';
import { lineFulfillment } from '@/lib/fulfillment-state';
import { returnedItemIds } from '@/lib/ledger';
import { fulfillmentCommands } from '@/lib/assistant/lifecycle';
import { Button } from './ui/button';
export function AssistantFulfillmentActions({ orderIds }: { orderIds: string[] }) {
  const { w, dispatch, saving } = useWorkspace();
  const [error, setError] = useState('');
  const [selection, setSelection] = useState<Record<string, string[]>>({});
  return (
    <section aria-label="Saved sales fulfillment">
      {orderIds.map((id) => {
        const order = w.orders.find((o) => o.id === id);
        if (!order || order.status !== 'Completed') return null;
        const pending = order.lines
          .filter(
            (l) =>
              lineFulfillment(order, l.itemId).status === 'Unfulfilled' &&
              !returnedItemIds(w, id).has(l.itemId),
          )
          .map((l) => l.itemId);
        const selected = selection[id] ?? pending;
        if (!pending.length)
          return <p key={id}>Fulfillment saved · {order.externalId || order.marketplace}</p>;
        return (
          <div key={id} className="assistant-saved-sale">
            <strong>
              Saved sale · {order.marketplace} ·{' '}
              {order.lines.map((l) => w.items.find((i) => i.id === l.itemId)?.title).join(', ')}
            </strong>
            {pending.length > 1 &&
              pending.map((itemId) => (
                <label className="check-row" key={itemId}>
                  <input
                    type="checkbox"
                    checked={selected.includes(itemId)}
                    disabled={saving}
                    onChange={(e) =>
                      setSelection({
                        ...selection,
                        [id]: e.target.checked
                          ? [...selected, itemId]
                          : selected.filter((i) => i !== itemId),
                      })
                    }
                  />
                  {w.items.find((i) => i.id === itemId)?.title}
                </label>
              ))}
            <Button
              disabled={saving || !selected.length}
              onClick={async () => {
                setError('');
                try {
                  const parcel = w.shipments.find((p) => p.orderIds.includes(id));
                  let confirmPackage = false;
                  if (parcel && parcel.orderIds.length > 1) {
                    confirmPackage = window.confirm(
                      `This package contains ${parcel.orderIds.length} orders. Mark the whole package shipped?`,
                    );
                    if (!confirmPackage) return;
                  }
                  const commands = fulfillmentCommands(w, {
                    id: crypto.randomUUID(),
                    orderId: id,
                    itemIds: selected,
                    status: order.marketplace === 'In person' ? 'Handed over' : 'Shipped',
                    date: new Date().toISOString(),
                    confirmPackage,
                  });
                  if (!(await dispatch(commands)))
                    setError(
                      'Fulfillment was not confirmed. Review the workspace message and retry.',
                    );
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Could not save fulfillment.');
                }
              }}
            >
              {order.marketplace === 'In person' ? 'Mark Fulfilled' : 'Mark Shipped'}
            </Button>
          </div>
        );
      })}
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
