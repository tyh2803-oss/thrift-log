'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useWorkspace } from '@/lib/use-workspace';
import type { ConnectionStatus } from '@/lib/integrations/whatnot/schema';
export function WhatnotAutoSync() {
  const { demo, ready, requestHeaders, refresh } = useWorkspace(),
    [status, setStatus] = useState<ConnectionStatus | null>(null);
  useEffect(() => {
    if (demo || !ready) return;
    let stopped = false,
      running = false,
      timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (stopped || running || document.visibilityState === 'hidden') return;
      running = true;
      let delay = 60000;
      try {
        const response = await fetch('/api/integrations/whatnot', {
          cache: 'no-store',
          headers: requestHeaders,
        });
        if (!response.ok) {
          if (!stopped) setStatus(null);
          return;
        }
        const data: ConnectionStatus = await response.json();
        if (stopped) return;
        setStatus(data);
        if (data.ready && data.connected && data.status !== 'auth_error') {
          const result = await fetch('/api/integrations/whatnot', {
            method: 'POST',
            headers: { ...requestHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'sync', automatic: true }),
          });
          if (result.ok) {
            const synced = await result.json();
            if (!stopped && synced.changed) await refresh();
            if (synced.hasMore || synced.status?.hasMore) delay = 2500;
            if (!stopped && synced.status) setStatus(synced.status);
          }
        }
      } catch {
        /* Connection status and manual refresh remain available in Settings. */
      } finally {
        running = false;
        if (!stopped) timer = setTimeout(() => void tick(), delay);
      }
    };
    const wake = () => {
      clearTimeout(timer);
      void tick();
    };
    timer = setTimeout(() => void tick(), 0);
    window.addEventListener('thrift-log.whatnot.changed', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener('thrift-log.whatnot.changed', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [demo, ready, requestHeaders, refresh]);
  if (demo || !status?.connected) return null;
  if (status.status === 'auth_error' || status.error)
    return (
      <p className="whatnot-notice">
        <Link href="/settings">Whatnot needs attention. Open connection settings.</Link>
      </p>
    );
  if (status.pending)
    return (
      <p className="whatnot-notice">
        <Link href="/settings">{status.pending} Whatnot updates need review.</Link> Totals reflect
        recorded transactions.
      </p>
    );
  return null;
}
