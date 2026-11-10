import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { configurationStatus, readConfiguration, secureSessionCookie } from './config';
export function configured() {
  return configurationStatus(process.env).ready;
}
export function configurationPresent() {
  return configurationStatus(process.env).present;
}
export async function authClient({
  writableCookies = false,
  request,
}: { writableCookies?: boolean; request?: Request } = {}) {
  const config = readConfiguration(process.env);
  const store = await cookies();
  return createServerClient(config.url, config.publicKey, {
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: request ? secureSessionCookie(request) : process.env.NODE_ENV === 'production',
      path: '/',
    },
    cookies: {
      getAll: () => store.getAll(),
      // Server Components cannot mutate cookies. src/proxy.ts refreshes sessions first.
      ...(writableCookies
        ? {
            setAll: (
              values: {
                name: string;
                value: string;
                options: import('@supabase/ssr').CookieOptions;
              }[],
            ) => {
              values.forEach(({ name, value, options }) => store.set(name, value, options));
            },
          }
        : {}),
    },
  });
}
export function adminClient() {
  const config = readConfiguration(process.env);
  return createClient(config.url, config.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function requireUser() {
  const client = await authClient();
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user || user.email?.toLowerCase() !== readConfiguration(process.env).ownerEmail)
    throw new Error('Unauthorized');
  return user;
}
export function checkOrigin(request: Request) {
  const url = new URL(request.url);
  // Next.js may reconstruct request.url with its internal listen hostname.
  // Host is the browser's destination; do not trust arbitrary forwarded hosts.
  const host = request.headers.get('host');
  const expectedOrigin = host ? new URL(`${url.protocol}//${host}`).origin : url.origin;
  if (request.headers.get('origin') !== expectedOrigin) throw new Error('Invalid request origin');
}
