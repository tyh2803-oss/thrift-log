'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowUpRight, ArrowRight, Info } from 'lucide-react';
import {
  inventoryPipeline,
  pipelineValue,
  pipelineStages,
  stageNames,
  type PipelineMetric,
  type PipelineSnapshot,
} from '@/lib/pipeline';
import { useWorkspace } from '@/lib/use-workspace';
import { money } from '@/lib/money';
export function InventoryPipeline({ snapshot: provided }: { snapshot?: PipelineSnapshot }) {
  const { w, demo } = useWorkspace(),
    base = usePathname().startsWith('/demo') ? '/demo' : '';
  const snapshot = useMemo(() => provided ?? inventoryPipeline(w), [w, provided]);
  const [metric, setMetric] = useState<PipelineMetric>('sale');
  const key = `thrift-log.draft.pipeline-metric.${demo ? 'demo' : 'private'}`;
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const v = sessionStorage.getItem(key);
        if (v === 'cost' || v === 'sale' || v === 'profit') setMetric(v);
      } catch {}
    }, 0);
    return () => clearTimeout(timer);
  }, [key]);
  function choose(value: PipelineMetric) {
    setMetric(value);
    try {
      sessionStorage.setItem(key, value);
    } catch {}
  }
  return (
    <section className="card pipeline-widget" aria-label="Inventory Pipeline">
      <div className="pipeline-heading">
        <div>
          <h2>Inventory Pipeline</h2>
          <p>
            As of now{' '}
            <span title="Current physical positions across all dates. Dashboard reporting dates do not change this snapshot.">
              · Current snapshot <Info size={12} />
            </span>
          </p>
        </div>
        <div className="segmented pipeline-toggle" role="group" aria-label="Pipeline metric">
          {(
            [
              ['cost', 'Cost'],
              ['sale', 'Sale Value'],
              ['profit', 'Profit'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              aria-pressed={metric === value}
              className={metric === value ? 'active' : ''}
              onClick={() => choose(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="pipeline-grid">
        {pipelineStages.map((stage) => {
          const g = snapshot.groups[stage],
            v = pipelineValue(g, metric);
          return (
            <Link
              key={stage}
              className={`pipeline-stage pipeline-${stage}`}
              href={`${base}/${stage === 'unlisted' || stage === 'for-sale' ? 'inventory' : 'sales'}?pipeline=${stage}`}
              aria-label={`View ${stageNames[stage]} items`}
            >
              <div className="pipeline-stage-title">
                <span>{stageNames[stage]}</span>
                <ArrowUpRight size={16} />
              </div>
              <strong className="pipeline-count">
                {g.count} <small>{g.count === 1 ? 'item' : 'items'}</small>
              </strong>
              <strong
                className={`pipeline-money ${v.value !== null && v.value < 0 ? 'negative' : ''}`}
              >
                {v.value === null ? '—' : money(v.value)}
              </strong>
              <span
                className="pipeline-value-label"
                title={
                  metric === 'profit' && (stage === 'sold' || stage === 'shipped')
                    ? 'Allocated from the current sale’s dated ledger, including recorded selling costs and adjustments. Unconfirmed amounts stay provisional.'
                    : stage === 'for-sale'
                      ? 'One price per physical item: lowest positive active listing, then the item’s explicitly entered asking price. Asking prices are not earned revenue.'
                      : metric === 'profit'
                        ? 'Expected/asking price minus acquisition cost and the per-item selling expense estimate configured in Settings. Incomplete estimates are excluded.'
                        : undefined
                }
              >
                {v.label}
              </span>
              <div className="pipeline-card-notes">
                {!!v.missing && (
                  <span title="Items with insufficient information are excluded from this monetary subtotal; physical counts remain complete.">
                    {v.missing} incomplete
                  </span>
                )}
                {!!v.provisional && <span>{v.provisional} to confirm</span>}
                {stage === 'for-sale' && <small>{g.activeListings} active listings</small>}
                {(stage === 'sold' || stage === 'shipped') && (
                  <small>
                    {g.orders} {g.orders === 1 ? 'order' : 'orders'}
                    {g.handedOver ? ` · ${g.handedOver} in person / handed over` : ''}
                  </small>
                )}
              </div>
              <ArrowRight className="pipeline-arrow" size={16} />
            </Link>
          );
        })}
      </div>
      <details className="pipeline-details">
        <summary>Marketplace details &amp; valuation</summary>
        <div className="pipeline-breakdowns">
          {pipelineStages.map((stage) => (
            <div key={stage}>
              <strong>{stageNames[stage]}</strong>
              {snapshot.groups[stage].markets.length ? (
                snapshot.groups[stage].markets.map((m) => (
                  <p key={m.name}>
                    {m.name}: {m.count} {stage === 'for-sale' ? 'listings' : 'items'}
                  </p>
                ))
              ) : (
                <p>No marketplace records</p>
              )}
              {snapshot.groups[stage].reserved > 0 && (
                <p>{snapshot.groups[stage].reserved} reserved for a show</p>
              )}
            </div>
          ))}
        </div>
        <p>
          Listing counts overlap across marketplaces. Each physical item and its asking price count
          once. Expected/asking values and potential profit are estimates; sales values reflect the
          current sale after recorded discounts and refunds. There is no combined pipeline dollar
          total.
        </p>
        <p>
          {snapshot.restocking.length} returned items await restocking · {snapshot.review.length}{' '}
          records need lifecycle review · {snapshot.archived} archived items excluded.
        </p>
      </details>
    </section>
  );
}
