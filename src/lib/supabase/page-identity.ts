import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { configured, configurationPresent, requireUser } from './server';
import { readConfiguration } from './config';

// React cache deduplicates layout/page checks within ONE server render only.
// Every new navigation still verifies Auth and the live beta authorization.
// API authorization deliberately continues to call the uncached requireUser().
export const pageIdentity = cache(async () => {
  if (!configured()) {
    if (configurationPresent()) redirect('/login');
    return { demo: true, isOwner: false, userId: undefined, email: undefined };
  }
  const user = await requireUser().catch(() => null);
  if (!user) redirect('/login');
  return {
    demo: false,
    userId: user.id,
    email: user.email,
    isOwner:
      user.betaRole === 'owner' &&
      user.email?.toLowerCase() === readConfiguration(process.env).ownerEmail,
  };
});
