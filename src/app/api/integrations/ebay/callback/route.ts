import { NextResponse, after } from 'next/server';
import { cookies } from 'next/headers';
import { createHash } from 'node:crypto';
import { requireUser } from '@/lib/supabase/server';
import { config, EbayError } from '@/lib/integrations/ebay/config';
import { exchangeToken, EbayClient } from '@/lib/integrations/ebay/client';
import { identitySchema } from '@/lib/integrations/ebay/schema';
import { seal, equalSecret } from '@/lib/integrations/ebay/crypto';
import { ebayRpc } from '@/lib/integrations/ebay/store';
import { backgroundSync } from '@/lib/integrations/ebay/sync';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export async function GET(request: Request) {
  let origin: string;
  try {
    origin = config().origin;
  } catch {
    return new Response('eBay connection setup is incomplete. Return to Thrift Log settings.', {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  const finish = (code: string) => {
    const r = NextResponse.redirect(new URL('/settings?ebay=' + code, origin), 303);
    r.headers.set('Cache-Control', 'private, no-store');
    r.headers.set('Referrer-Policy', 'no-referrer');
    r.cookies.set('__Host-thrift-ebay-state', '', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
    return r;
  };
  try {
    if (new URL(request.url).origin !== origin) return finish('state');
    const user = await requireUser(request),
      url = new URL(request.url),
      state = url.searchParams.get('state') || '',
      stored = (await cookies()).get('__Host-thrift-ebay-state')?.value || '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !stored || !equalSecret(state, stored))
      return finish('state');
    const hash = createHash('sha256').update(state).digest('hex'),
      authorization = await ebayRpc<{ financials: boolean; environment: string }>(
        'consume_oauth',
        user.id,
        { state_hash: hash },
      );
    if (url.searchParams.has('error')) return finish('cancelled');
    const code = url.searchParams.get('code');
    if (!code || code.length > 12000) return finish('state');
    if (authorization.environment !== config().environment) return finish('setup');
    const credentials = await exchangeToken({ code }, authorization.financials),
      seller = await new EbayClient(credentials.accessToken, authorization.environment).get(
        '/commerce/identity/v1/user/',
        identitySchema,
      );
    if (seller.status && seller.status !== 'CONFIRMED')
      throw new EbayError('auth', 'Confirm your eBay account before connecting.', 401);
    await ebayRpc('connect', user.id, {
      state_hash: hash,
      seller_id: seller.userId,
      username: seller.username,
      token_ciphertext: seal(user.id, JSON.stringify(credentials)),
    });
    after(() => backgroundSync(user.id));
    return finish('connected');
  } catch (e) {
    return finish(
      e instanceof EbayError
        ? ['auth', 'state', 'setup', 'permissions', 'conflict'].includes(e.code)
          ? e.code
          : 'error'
        : e instanceof Error && e.message === 'Unauthorized'
          ? 'signin'
          : 'error',
    );
  }
}
