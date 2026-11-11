import { Login } from '@/components/login';
import { configured, requireUser } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
export const dynamic = 'force-dynamic';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; verify?: string }>;
}) {
  const params = await searchParams;
  const ready = configured();
  let initialError =
    params.error === 'signin'
      ? 'Unable to sign in. Check your credentials and account configuration.'
      : params.error === 'setup'
        ? 'Private storage is not configured. Complete the Supabase environment settings.'
        : params.error === 'invite'
          ? 'This invitation is expired, invalid, or no longer authorized. Ask the owner for access and a fresh invitation.'
          : '';
  if (ready && params.verify === '1') {
    const user = await requireUser().catch(() => null);
    if (user) redirect('/');
    initialError =
      'Your browser could not keep your sign-in session. Allow cookies for this site and try again.';
  }
  return <Login configured={ready} initialError={initialError} />;
}
