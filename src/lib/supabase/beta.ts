import 'server-only';
import type { User } from '@supabase/supabase-js';
import { adminClient } from './server';
import { DatabaseReadinessError } from './config';
/** getUser() verifies the Auth session first. This live lookup deliberately has no cache. */
export async function betaRole(user: User): Promise<'owner' | 'tester'> {
  if (!user.email || !user.email_confirmed_at) throw new Error('Unauthorized');
  const { data, error } = await adminClient().rpc('beta_check_access', { p_user_id: user.id });
  if (error) throw new DatabaseReadinessError();
  if (data !== 'owner' && data !== 'tester') throw new Error('Unauthorized');
  return data;
}
export function betaInviteRedirect() {
  try {
    const url = new URL(process.env.BETA_SITE_URL || '');
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error();
    return `${url.origin}/auth/confirm`;
  } catch {
    throw new Error(
      'Set BETA_SITE_URL to the approved HTTPS app origin before sending invitations.',
    );
  }
}
