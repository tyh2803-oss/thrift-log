import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authClient, checkOrigin } from '@/lib/supabase/server';
import { ConfigurationError, readConfiguration } from '@/lib/supabase/config';
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const body = z
      .object({
        action: z.enum(['signin', 'signout']),
        email: z.email().optional(),
        password: z.string().min(8).max(500).optional(),
      })
      .parse(await request.json());
    const client = await authClient({ writableCookies: true });
    if (body.action === 'signout') {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    } else {
      if (!body.email || !body.password) throw new Error('Missing credentials');
      if (body.email.toLowerCase() !== readConfiguration(process.env).ownerEmail)
        throw new Error('Access denied');
      const { error } = await client.auth.signInWithPassword({
        email: body.email,
        password: body.password,
      });
      if (error) throw error;
    }
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof ConfigurationError
            ? error.message
            : 'Unable to sign in. Check your credentials and account configuration.',
      },
      {
        status: error instanceof ConfigurationError ? 503 : 400,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
}
