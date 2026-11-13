'use client';
import { useEffect, useState } from 'react';
import { useWorkspace } from '@/lib/use-workspace';
import { money, parseMoney } from '@/lib/money';
import type { ShowAnalytics } from '@/lib/integrations/whatnot/schema';
export function WhatnotShowAnalytics({ showId }: { showId: string }) {
  const { demo, requestHeaders } = useWorkspace();
  const [analytics, setAnalytics] = useState<ShowAnalytics | null>(null);
  const [sourceStatus, setSourceStatus] = useState<string | null>(null);
  useEffect(() => {
    if (demo) return;
    let stopped = false;
    void fetch(`/api/integrations/whatnot/shows/${showId}`, {
      headers: requestHeaders,
      cache: 'no-store',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!stopped) {
          setAnalytics(data?.analytics || null);
          setSourceStatus(data?.sourceStatus || null);
        }
      })
      .catch(() => {});
    return () => {
      stopped = true;
    };
  }, [demo, requestHeaders, showId]);
  if (!analytics)
    return sourceStatus === 'cancelled' ? (
      <p className="whatnot-notice">
        Cancelled on Whatnot. No show activity or financial earnings are inferred.
      </p>
    ) : null;
  return (
    <section className="card padded">
      <h3>Whatnot show analytics</h3>
      {sourceStatus === 'stopped' && <p>Stopped on Whatnot; this show can resume.</p>}
      <p className="hint">
        Source: Whatnot. Earnings are platform estimates before your purchase costs, sourcing
        expenses and labor; they are not business profit.
      </p>
      {analytics.calculation_status !== 'GENERATED' ? (
        <p>
          Metrics:{' '}
          {analytics.calculation_status?.toLowerCase().replaceAll('_', ' ') || 'not available'}.
        </p>
      ) : (
        <dl className="whatnot-sync-status">
          <div>
            <dt>Whatnot estimated earnings</dt>
            <dd>
              {analytics.estimated_earnings?.currency === 'USD'
                ? amount(analytics.estimated_earnings.amount)
                : 'Unavailable'}
            </dd>
          </div>
          <div>
            <dt>Orders</dt>
            <dd>{analytics.orders_count ?? 'Unknown'}</dd>
          </div>
          <div>
            <dt>Unique viewers</dt>
            <dd>{analytics.distinct_viewers_count ?? 'Unknown'}</dd>
          </div>
          <div>
            <dt>Minutes live</dt>
            <dd>{analytics.stream_minutes ?? 'Unknown'}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}

function amount(value: string) {
  try {
    return money(parseMoney(value));
  } catch {
    return 'Unavailable';
  }
}
