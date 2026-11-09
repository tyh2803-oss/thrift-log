'use client';
import { previewBatch } from '@/lib/assistant/planner';
import type { DraftBatch } from '@/lib/assistant/drafts';
import { useWorkspace } from '@/lib/use-workspace';
import { money } from '@/lib/money';
import { Badge, ItemPhoto } from './shared';
export function AssistantReview({ batch }: { batch: DraftBatch }) {
  const { w } = useWorkspace();
  const previews = previewBatch(w, batch);
  const ready = previews.filter((p) => p.row.included && p.ready);
  return (
    <section aria-label="Import batch review" className="assistant-review">
      <h3>{batch.rows.length} records found</h3>
      {previews.map((p, index) => (
        <article key={p.row.id} className="assistant-extraction">
          <div className="actions">
            <strong>
              {index + 1}. {p.row.facts.lines.map((l) => l.title || 'Untitled item').join(', ')}
            </strong>
            <Badge tone={p.ready ? 'green' : 'amber'}>{p.ready ? 'Ready' : 'Needs review'}</Badge>
          </div>
          <p>
            {p.row.facts.marketplace || 'Marketplace unknown'} · {p.row.facts.kind} ·{' '}
            {p.row.facts.date || 'Date unknown'}
          </p>
          {p.row.matches.map((m, i) => {
            const item = w.items.find((v) => v.id === m.itemId);
            return (
              <div className="detail-row" key={i}>
                {item && <ItemPhoto item={item} />}
                <span>
                  {item
                    ? `Matched inventory: ${item.title} · ${item.sku}`
                    : 'Choose an inventory match'}
                  <small>
                    Purchase cost (inventory): {p.costs[i] === null ? 'Unknown' : money(p.costs[i])}
                  </small>
                </span>
              </div>
            );
          })}
          <p>
            Sale price:{' '}
            {p.row.facts.lines.some((l) => l.price === null)
              ? 'Unknown'
              : money(p.row.facts.lines.reduce((n, l) => n + l.price!, 0))}
          </p>
          <strong>
            {p.totals
              ? `${p.ready ? 'Net profit' : 'Provisional profit'}: ${money(p.totals.profit)}`
              : 'Profit pending missing information'}
          </strong>
          {p.issues.map((issue, i) => (
            <p className="hint" key={i}>
              {issue}
            </p>
          ))}
        </article>
      ))}
      <p>
        {ready.length} ready · {previews.length - ready.length} unresolved
      </p>
      <p>Confirmed revenue: {money(ready.reduce((n, p) => n + (p.totals?.revenue || 0), 0))}</p>
      <small>Preview only. Approval and editing are the next implementation checkpoint.</small>
    </section>
  );
}
