import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authClient, checkOrigin } from '@/lib/supabase/server';
import { betaRole } from '@/lib/supabase/beta';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
const invalid =
  'This setup link is invalid, expired, already used, or no longer authorized. Ask the owner for a new private setup link.';
/** A recovery secret proves account possession; user IDs/emails/roles are never accepted. */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    if (Number(request.headers.get('content-length')) > 2000) throw new Error();
    const text = await request.text();
    if (text.length > 2000) throw new Error();
    const { token_hash } = z
      .object({ token_hash: z.string().regex(/^[a-z0-9_-]{32,512}$/i) })
      .strict()
      .parse(JSON.parse(text));
    const client = await authClient({ writableCookies: true, request });
    const { data, error } = await client.auth.verifyOtp({ token_hash, type: 'recovery' });
    if (error || !data.user) {
      if (error?.status === 429)
        return NextResponse.json(
          { error: 'Too many setup attempts. Wait a few minutes before trying again.' },
          { status: 429, headers },
        );
      throw new Error();
    }
    try {
      if ((await betaRole(data.user)) !== 'tester') throw new Error();
    } catch {
      await client.auth.signOut({ scope: 'local' });
      throw new Error();
    }
    return NextResponse.json({ ok: true }, { headers });
  } catch {
    return NextResponse.json({ error: invalid }, { status: 400, headers });
  }
}
