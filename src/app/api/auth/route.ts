import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authClient, checkOrigin } from '@/lib/supabase/server';
import { ConfigurationError, readConfiguration } from '@/lib/supabase/config';
export async function POST(request: Request) {
  const formRequest =
    request.headers.get('content-type')?.split(';')[0].trim() ===
    'application/x-www-form-urlencoded';
  let origin: string | null = null;
  const redirect = (path: string) => {
    const response = NextResponse.redirect(new URL(path, origin!), 303);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  };
  try {
    checkOrigin(request);
    origin = request.headers.get('origin')!;
    const body = z
      .object({
        action: z.enum(['signin', 'signout']),
        email: z.string().trim().pipe(z.email()).optional(),
        password: z.string().min(1).max(500).optional(),
      })
      .parse(formRequest ? Object.fromEntries(await request.formData()) : await request.json());
    const client = await authClient({ writableCookies: true, request });
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
    if (formRequest) return redirect(body.action === 'signin' ? '/login?verify=1' : '/login');
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (formRequest && origin)
      return redirect(
        error instanceof ConfigurationError ? '/login?error=setup' : '/login?error=signin',
      );
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
