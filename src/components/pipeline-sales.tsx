'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { inventoryPipeline, stageNames, type PipelineStage } from '@/lib/pipeline';
import { useWorkspace } from '@/lib/use-workspace';
import { money } from '@/lib/money';
import { ItemPhoto, Empty } from './shared';
import { Button } from './ui/button';
import type { EditorTarget } from './editor';
export function PipelineSales({
  stage,
  search,
  market,
  onEdit,
  onFulfill,
}: {
  stage: PipelineStage;
  search: string;
  market: string;
  onEdit: (target: EditorTarget) => void;
  onFulfill: (orderId: string) => void;
}) {
  const { w } = useWorkspace(),
    base = usePathname().startsWith('/demo') ? '/demo' : '';
  const snapshot = useMemo(() => inventoryPipeline(w), [w]);
  const entries = snapshot.groups[stage].entries.filter(
    (e) =>
      (market === 'All marketplaces' || e.order!.marketplace === market) &&
      `${e.item.title} ${e.item.sku} ${e.order!.externalId} ${e.order!.marketplace}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <section className="card" aria-label={`${stageNames[stage]} pipeline items`}>
      <div className="pipeline-filter-banner">
        <div>
          <strong>
            {stageNames[stage]} · {entries.length} physical items
          </strong>
          <p>As of now · All sale dates · Current sale cycle per item</p>
        </div>
        <Link className="text-link" href={`${base}/sales`}>
          Clear pipeline filter
        </Link>
      </div>
      {!entries.length ? (
        <Empty
          title="No items in this stage"
          description="This snapshot updates after saved sales, fulfillment and returns."
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Physical item / order</th>
                <th>Marketplace</th>
                <th>Merchandise sales</th>
                <th>Cost basis</th>
                <th>Item profit</th>
                <th>Fulfillment</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.item.id}>
                  <td>
                    <div className="pipeline-sale-item">
                      <ItemPhoto item={e.item} />
                      <button
                        className="cell-button"
                        onClick={() => onEdit({ kind: 'order', value: e.order! })}
                      >
                        <strong>{e.item.title}</strong>
                        <small>
                          {e.item.sku} · {e.order!.externalId || e.order!.id.slice(0, 8)}
                        </small>
                        <small>Sold {new Date(e.order!.date).toLocaleDateString()}</small>
                      </button>
                    </div>
                  </td>
                  <td>{e.order!.marketplace}</td>
                  <td>{e.saleValue === null ? 'Unavailable' : money(e.saleValue)}</td>
                  <td>{e.cost === null ? 'Unknown' : money(e.cost)}</td>
                  <td className={e.profit !== null && e.profit < 0 ? 'negative' : ''}>
                    {e.profit === null ? 'Unavailable' : money(e.profit)}
                    <small className="block muted">
                      {e.provisional || e.cost === null ? 'Provisional Profit' : 'Realized Profit'}
                    </small>
                  </td>
                  <td>
                    <span>
                      {e.fulfillment === 'Unfulfilled' && e.order!.marketplace === 'In person'
                        ? 'Awaiting handover'
                        : e.fulfillment}
                    </span>
                    <small className="block muted">
                      {e.fulfilledAt
                        ? new Date(e.fulfilledAt).toLocaleString()
                        : e.fulfillment === 'Unfulfilled'
                          ? 'Awaiting fulfillment'
                          : 'Completion date not recorded'}
                    </small>
                    <Button variant="ghost" size="sm" onClick={() => onFulfill(e.order!.id)}>
                      Manage fulfillment
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
