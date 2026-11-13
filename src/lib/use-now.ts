'use client';
import { useEffect, useState } from 'react';

/** A view-local clock. Idle business screens tick by minute; live timers tick by second.
 * Hidden tabs stop rendering and resume from real timestamps, never accumulated ticks.
 */
export function useNow(interval = 60_000, refreshKey?: unknown) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = () => setNow(Date.now());
    const resume = () => {
      clearInterval(timer);
      if (document.visibilityState !== 'hidden') {
        update();
        timer = setInterval(update, interval);
      }
    };
    const initial = setTimeout(resume, 0);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
    };
  }, [interval, refreshKey]);
  return now;
}
