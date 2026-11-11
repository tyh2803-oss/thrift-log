/** Shared only by server modules and verification scripts. Never serialize this configuration. */
export const supabaseVariables = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OWNER_EMAIL',
] as const;
export type SupabaseEnvironment = Record<string, string | undefined>;
export class ConfigurationError extends Error {
  constructor() {
    super('Private storage is not configured. Complete the Supabase environment settings.');
  }
}
export function configurationStatus(env: SupabaseEnvironment) {
  const missing = supabaseVariables.filter((name) => !env[name]?.trim());
  const problems: string[] = [];
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (url) {
    try {
      const parsed = new URL(url);
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
      if (
        (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash ||
        parsed.pathname !== '/'
      )
        problems.push('Use the Supabase HTTPS project URL, not the MCP URL.');
    } catch {
      problems.push('Use a valid Supabase project URL.');
    }
  }
  if (env.OWNER_EMAIL && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.OWNER_EMAIL.trim()))
    problems.push('OWNER_EMAIL must be a valid email address.');
  return {
    ready: missing.length === 0 && problems.length === 0,
    present: supabaseVariables.some((name) => !!env[name]),
    missing,
    problems,
  };
}
export function readConfiguration(env: SupabaseEnvironment) {
  if (!configurationStatus(env).ready) throw new ConfigurationError();
  return {
    url: env.NEXT_PUBLIC_SUPABASE_URL!.trim().replace(/\/$/, ''),
    publicKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY!.trim(),
    ownerEmail: env.OWNER_EMAIL!.trim().toLowerCase(),
  };
}

/** Allow HTTP on loopback, or private IPv4 hosts only in local development. */
export function secureSessionCookie(request: Request) {
  const url = new URL(request.url);
  // Next may use an internal hostname in request.url; use the browser's Host.
  const destination = new URL(`${url.protocol}//${request.headers.get('host') || url.host}`);
  const host = destination.hostname;
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(host);
  const octets = host.split('.').map(Number);
  const privateIPv4 =
    /^\d+\.\d+\.\d+\.\d+$/.test(host) &&
    octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
    (octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168));
  return !(
    url.protocol === 'http:' &&
    (loopback || (process.env.NODE_ENV === 'development' && privateIPv4))
  );
}

export class DatabaseReadinessError extends Error {
  constructor() {
    super(
      'The private database needs all repository migrations through 202611110001, the verified owner bootstrap, and verified RLS/storage policies. Apply and verify them with approval before saving records.',
    );
  }
}
