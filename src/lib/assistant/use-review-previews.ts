'use client';
import { useEffect, useMemo, useState } from 'react';
import type { Workspace } from '../model';
import type { DraftBatch } from './drafts';
import { previewBatch, previewBatchAsync, type Preview } from './planner';
export function useReviewPreviews(w: Workspace, batch: DraftBatch) {
  const fallback = useMemo(() => previewBatch(w, batch), [w, batch]);
  const [resolved, setResolved] = useState<{
    w: Workspace;
    batch: DraftBatch;
    previews: Preview[];
  } | null>(null);
  const asynchronous = batch.rows.some((r) => r.inventoryChange);
  useEffect(() => {
    if (!asynchronous) return;
    let active = true;
    void previewBatchAsync(w, batch).then(
      (previews) => {
        if (active) setResolved({ w, batch, previews });
      },
      () => {
        if (active)
          setResolved({
            w,
            batch,
            previews: fallback.map((p) =>
              p.row.inventoryChange
                ? {
                    ...p,
                    ready: false,
                    commands: [],
                    issues: [
                      'This change could not be validated. Refresh the review and try again.',
                    ],
                  }
                : p,
            ),
          });
      },
    );
    return () => {
      active = false;
    };
  }, [w, batch, asynchronous, fallback]);
  return asynchronous && resolved?.w === w && resolved.batch === batch
    ? resolved.previews
    : fallback;
}
