import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authClient, checkOrigin, requireUser } from '@/lib/supabase/server';
import { betaRole } from '@/lib/supabase/beta';
import { ConfigurationError } from '@/lib/supabase/config';
import { MIN_PASSWORD_LENGTH } from '@/lib/password-policy';
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
        action: z.enum(['signin', 'signout', 'password']),
        email: z.string().trim().pipe(z.email()).optional(),
        password: z.string().min(1).max(500).optional(),
      })
      .parse(formRequest ? Object.fromEntries(await request.formData()) : await request.json());
    const client = await authClient({ writableCookies: true, request });
    if (body.action === 'signout') {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    } else if (body.action === 'password') {
      await requireUser(request);
      const parsed = z.string().min(MIN_PASSWORD_LENGTH).max(128).safeParse(body.password);
      if (!parsed.success)
        return NextResponse.json(
          { error: `Use a password between ${MIN_PASSWORD_LENGTH} and 128 characters.` },
          { status: 400, headers: { 'Cache-Control': 'no-store' } },
        );
      const password = parsed.data;
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
    } else {
      if (!body.email || !body.password) throw new Error('Missing credentials');
      const { data, error } = await client.auth.signInWithPassword({
        email: body.email,
        password: body.password,
      });
      if (error) throw error;
      try {
        if (!data.user) throw new Error('Unauthorized');
        await betaRole(data.user);
      } catch (error) {
        await client.auth.signOut({ scope: 'local' });
        throw error;
      }
    }
    if (formRequest)
      return redirect(
        body.action === 'signin' ? '/login?verify=1' : body.action === 'password' ? '/' : '/login',
      );
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
