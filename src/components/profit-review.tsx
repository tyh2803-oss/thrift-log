'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useWorkspace } from '@/lib/use-workspace';
import { profitReview } from '@/lib/profit-review';
import { metrics, money } from '@/lib/finance';
import type { EditorTarget } from './editor';
import { BulkPurchaseCosts } from './bulk-purchase-costs';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';

export function ProfitReview({
  range,
  onClose,
  onEdit,
}: {
  range: [number, number];
  onClose: () => void;
  onEdit: (target: EditorTarget) => void;
}) {
  const { w } = useWorkspace(),
    base = usePathname().startsWith('/demo') ? '/demo' : '',
    [editingCosts, setEditingCosts] = useState(false),
    review = profitReview(w, range),
    m = metrics(w, ...range);
  if (editingCosts)
    return (
      <BulkPurchaseCosts
        itemIds={review.itemIds}
        onClose={() => setEditingCosts(false)}
        onSaved={() => setEditingCosts(false)}
      />
    );
  return (
    <Dialog
      open
      onClose={onClose}
      title="Review profit"
      description="Missing information for the selected dashboard dates. Purchase costs and seller fees are separate."
      wide
    >
      <div className="padded profit-review">
        <p role="status">
          {m.profitKnown
            ? `Profit is complete: ${money(m.profit)}.`
            : 'Complete the missing information below to calculate profit accurately.'}
        </p>
        {!!review.itemIds.length && (
          <section className="card padded">
            <h3>Missing purchase costs</h3>
            <p>
              {review.itemIds.length} physical items need a confirmed purchase cost. Enter $0 only
              if an item was free.
            </p>
            <Button onClick={() => setEditingCosts(true)}>
              Edit purchase costs ({review.itemIds.length})
            </Button>
            <p className="hint">
              If an item already has a recorded inventory cost, use the correction option to confirm
              it for its saved sale.
            </p>
          </section>
        )}
        {!!review.feeOrderIds.length && (
          <section className="card padded">
            <h3>Missing Whatnot seller fees</h3>
            <p>
              {review.feeOrderIds.length} orders are waiting for verified seller charges. Generate
              the seller financial report in Whatnot, then refresh the connection. Adding purchase
              costs alone will not complete these orders’ profit.
            </p>
            <Link className="btn btn-outline" href={`${base}/settings`} onClick={onClose}>
              Open Whatnot settings
            </Link>
            <details>
              <summary>View affected sales ({review.feeOrderIds.length})</summary>
              {review.feeOrderIds.map((id) => {
                const order = w.orders.find((o) => o.id === id)!;
                return (
                  <Button
                    key={id}
                    variant="ghost"
                    onClick={() => {
                      onClose();
                      onEdit({ kind: 'order', value: order });
                    }}
                  >
                    {order.marketplace} ·{' '}
                    {order.externalId ||
                      w.items.find((i) => i.id === order.lines[0]?.itemId)?.title ||
                      'Sale'}
                  </Button>
                );
              })}
            </details>
          </section>
        )}
        {m.profitKnown && (
          <p>
            All purchase costs and required seller fees for this period are confirmed. Other periods
            may have different missing information.
          </p>
        )}
        <Button variant="outline" onClick={onClose}>
          Done
        </Button>
      </div>
    </Dialog>
  );
}
