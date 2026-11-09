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

export class DatabaseReadinessError extends Error {
  constructor() {
    super(
      'The private database needs all repository migrations through 202611090003 and verified RLS/storage policies. Apply and verify them locally before saving records.',
    );
  }
}
