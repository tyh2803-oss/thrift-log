'use client';
import { useLinkStatus } from 'next/link';

export function NavigationProgress() {
  const { pending } = useLinkStatus();
  return (
    <span aria-hidden="true" className={`navigation-progress${pending ? ' is-pending' : ''}`} />
  );
}
