'use client';
import { useState } from 'react';
import { useWorkspace } from '@/lib/use-workspace';
import { lineFulfillment, setItemFulfillment } from '@/lib/fulfillment-state';
import { returnedItemIds } from '@/lib/ledger';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';
export function OrderFulfillment({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const { w, dispatch, saving, error, notify } = useWorkspace();
  const [localError, setLocalError] = useState('');
  const order = w.orders.find((o) => o.id === orderId);
  if (!order) return null;
  const returned = returnedItemIds(w, order.id),
    packageRecord = w.shipments.find((s) => s.orderIds.includes(order.id));
  async function update(
    itemId: string,
    status: 'Unfulfilled' | 'Shipped' | 'Delivered' | 'Handed over',
  ) {
    if (!order) return;
    setLocalError('');
    try {
      if (
        await dispatch({
          type: 'order',
          value: setItemFulfillment(order, itemId, status, new Date().toISOString()),
        })
      )
        notify('Item fulfillment saved.');
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Could not update fulfillment.');
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title="Item fulfillment"
      description={`${order.marketplace} · ${order.externalId || order.id.slice(0, 8)}`}
    >
      <div className="editor-form">
        {(error || localError) && (
          <p className="error-box" role="alert">
            {localError || error}
          </p>
        )}
        {packageRecord && (
          <p className="hint">
            This order belongs to a whole-order package. Update its status in Sales → Shipments;
            item overrides are disabled.
          </p>
        )}
        {order.status !== 'Completed' && (
          <p className="hint">Only a completed order can be fulfilled.</p>
        )}
        {order.lines.map((line) => {
          const item = w.items.find((i) => i.id === line.itemId),
            f = lineFulfillment(order, line.itemId);
          return (
            <div className="fulfillment-item" key={line.itemId}>
              <strong>{item?.title || 'Inventory item'}</strong>
              <small>
                {item?.sku}
                {returned.has(line.itemId)
                  ? ' · Returned'
                  : f.date
                    ? ` · Recorded ${new Date(f.date).toLocaleString()}`
                    : f.status === 'Unfulfilled'
                      ? ''
                      : ' · Completion date not recorded'}
              </small>
              <label className="field">
                <span>Fulfillment for {item?.sku || line.itemId}</span>
                <select
                  disabled={
                    saving ||
                    !!packageRecord ||
                    order.status !== 'Completed' ||
                    returned.has(line.itemId)
                  }
                  value={f.status === 'Fulfilled in person' ? 'Handed over' : f.status}
                  onChange={(e) =>
                    void update(
                      line.itemId,
                      e.target.value as 'Unfulfilled' | 'Shipped' | 'Delivered' | 'Handed over',
                    )
                  }
                >
                  <option>Unfulfilled</option>
                  {order.marketplace !== 'In person' && (
                    <>
                      <option>Shipped</option>
                      <option>Delivered</option>
                    </>
                  )}
                  <option>Handed over</option>
                </select>
              </label>
            </div>
          );
        })}
        <label className="check-row">
          <input
            type="checkbox"
            checked={order.amountsConfirmed ?? false}
            disabled={saving}
            onChange={async (e) => {
              if (
                await dispatch({
                  type: 'order',
                  value: { ...order, amountsConfirmed: e.target.checked },
                })
              )
                notify('Financial completeness saved.');
            }}
          />
          I confirm the purchase costs and all selling amounts, including zeros, are known.
        </label>
        <p className="hint">
          Fulfillment changes never add shipping expenses. Record label costs through the existing
          order or package workflow. Only confirmed business changes are saved.
        </p>
        <div className="form-footer">
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
