'use client';
import { useEffect, useRef } from 'react';

/** Presentation only: never wait for motion, remount content, or replay on data refreshes. */
export function useContentTransition<T extends HTMLElement = HTMLDivElement>(view: string) {
  const surface = useRef<T>(null);
  const previous = useRef(view);
  useEffect(() => {
    if (previous.current === view) return;
    previous.current = view;
    const element = surface.current;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!element?.animate || reduced.matches || document.hidden) return;
    const style = getComputedStyle(element);
    const animation = element.animate([{ opacity: 0.9 }, { opacity: 1 }], {
      duration: Number.parseFloat(style.getPropertyValue('--motion-surface')) || 160,
      easing: style.getPropertyValue('--motion-ease').trim() || 'ease-out',
    });
    animation.id = 'content-transition';
    const cancel = () => animation.cancel();
    const preference = () => {
      if (reduced.matches) cancel();
    };
    reduced.addEventListener('change', preference);
    // Release the effect when complete; there are no persistent compositing hints.
    void animation.finished.then(cancel, () => {});
    return () => {
      cancel();
      reduced.removeEventListener('change', preference);
    };
  }, [view]);
  return surface;
}
