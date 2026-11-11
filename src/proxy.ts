import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { configurationStatus, readConfiguration, secureSessionCookie } from '@/lib/supabase/config';
/** Refresh cookies before Server Components render. Route handlers still authorize every operation. */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (!configurationStatus(process.env).ready) return response;
  const config = readConfiguration(process.env);
  const supabase = createServerClient(config.url, config.publicKey, {
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureSessionCookie(request),
      path: '/',
    },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        for (const { name, value } of values) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of values) response.cookies.set(name, value, options);
        response.headers.set('Cache-Control', 'private, no-store');
      },
    },
  });
  try {
    await supabase.auth.getUser();
  } catch {
    /* The page/API will report the unavailable session without exposing credentials. */
  }
  return response;
}
export const config = {
  matcher: [
    '/',
    '/home',
    '/inventory',
    '/sales',
    '/activity',
    '/insights',
    '/settings',
    '/login',
    '/set-password',
    '/auth/confirm',
    '/api/:path*',
  ],
};
