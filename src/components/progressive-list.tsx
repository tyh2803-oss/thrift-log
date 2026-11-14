'use client';
import { useState } from 'react';
import { Button } from './ui/button';
const batchSize = 50;

/** Limit DOM work, never the records used by totals, search, export or selection. */
export function useProgressiveRows<T>(rows: T[], query: string) {
  const [expanded, setExpanded] = useState({ query, size: batchSize });
  const size = expanded.query === query ? expanded.size : batchSize;
  return {
    rows: rows.slice(0, size),
    shown: Math.min(size, rows.length),
    total: rows.length,
    next: Math.min(batchSize, Math.max(0, rows.length - size)),
    more: () => setExpanded({ query, size: size + batchSize }),
  };
}
export function ListProgress({
  list,
  label,
}: {
  list: Pick<ReturnType<typeof useProgressiveRows>, 'shown' | 'total' | 'next' | 'more'>;
  label: string;
}) {
  if (list.total <= batchSize) return null;
  return (
    <div className="list-progress" role="group" aria-label={`More ${label}`}>
      <p aria-live="polite">
        Showing {list.shown} of {list.total} {label}.
        <small>Filters, totals, exports and bulk actions include all matching records.</small>
      </p>
      {list.next > 0 && (
        <Button
          variant="outline"
          onClick={list.more}
          aria-label={`Show ${list.next} more ${label}`}
        >
          Show {list.next} more
        </Button>
      )}
    </div>
  );
}
