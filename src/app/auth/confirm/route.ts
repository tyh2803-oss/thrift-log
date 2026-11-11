import { NextResponse } from 'next/server';
import { authClient } from '@/lib/supabase/server';
import { betaRole, betaInviteRedirect } from '@/lib/supabase/beta';
export const dynamic = 'force-dynamic';
/** Custom Supabase email template uses TokenHash, never browser-visible access/refresh tokens. */
export async function GET(request: Request) {
  const incoming = new URL(request.url);
  // Next can reconstruct an internal listen hostname. Keep setup-error redirects on the browser host.
  const origin = `${incoming.protocol}//${request.headers.get('host') || incoming.host}`;
  let target = new URL('/login?error=invite', origin);
  try {
    const canonical = new URL(betaInviteRedirect());
    target = new URL('/login?error=invite', canonical);
    const query = new URL(request.url).searchParams;
    const hash = query.get('token_hash'),
      type = query.get('type');
    if (!hash || hash.length > 512 || (type !== 'invite' && type !== 'recovery'))
      throw new Error('Invalid invitation');
    const client = await authClient({ writableCookies: true, request });
    const { data, error } = await client.auth.verifyOtp({ token_hash: hash, type });
    if (error || !data.user) throw new Error('Invalid invitation');
    try {
      await betaRole(data.user);
    } catch (error) {
      await client.auth.signOut({ scope: 'local' });
      throw error;
    }
    target = new URL('/set-password', canonical);
  } catch {
    /* Fail closed without displaying invitation secrets. */
  }
  return NextResponse.redirect(target, {
    status: 303,
    headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
  });
}
