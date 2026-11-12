import 'server-only';
import { adminClient } from './server';

/** Owner-only caller: issue a private setup link without creating users or changing passwords. */
export async function testerSetupLink(
  owner: { id: string; email?: string },
  email: string,
  origin: string,
) {
  const admin = adminClient();
  async function authorized() {
    const { data, error } = await admin.rpc('beta_manage_access', {
      p_actor_id: owner.id,
      p_email: null,
      p_active: null,
    });
    return (
      !error &&
      Array.isArray(data) &&
      data.some((t: { email: string; active: boolean }) => t.email === email && t.active)
    );
  }
  if (email === owner.email?.toLowerCase() || !(await authorized()))
    throw new Error(
      'Authorize this tester before setting up their account. Owner access is protected.',
    );
  const url = new URL('/setup-tester', origin);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new Error('Open Thrift Log using HTTPS before creating a private setup link.');
  let target: { id: string; email?: string; email_confirmed_at?: string } | undefined;
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error('Existing accounts could not be checked. No password was changed.');
    target = data.users.find((u) => u.email?.toLowerCase() === email);
    if (target || data.users.length < 100) break;
  }
  if (!target)
    throw new Error(
      'No existing account was found. Your friend can use Create Account with their approved email.',
    );
  if (target.id === owner.id) throw new Error('The owner’s account is protected.');
  if (target.email_confirmed_at) {
    const { data, error } = await admin.rpc('beta_check_access', { p_user_id: target.id });
    if (error || data !== 'tester')
      throw new Error('This account does not match an active tester authorization.');
  }
  // Recovery supports existing invitations too. Only token issuance occurs here, never a password reset.
  const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email });
  if (
    error ||
    data.user?.id !== target.id ||
    data.user.email?.toLowerCase() !== email ||
    data.properties?.verification_type !== 'recovery' ||
    !/^[a-z0-9_-]{32,512}$/i.test(data.properties.hashed_token || '')
  )
    throw new Error('A setup link could not be confirmed. No password was changed. Try again.');
  if (!(await authorized())) throw new Error('Tester access changed. No setup link was shared.');
  // Keep the proof out of request URLs/referrers; redemption uses a same-origin POST body.
  // Never return action_link, email_otp, service keys, access tokens or the full provider response.
  url.hash = new URLSearchParams({ token_hash: data.properties.hashed_token }).toString();
  return url.toString();
}
