import { requireUser } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { SetPassword } from '@/components/set-password';
export const dynamic = 'force-dynamic';
export default async function Page() {
  const user = await requireUser().catch(() => null);
  if (!user) redirect('/login');
  return <SetPassword userId={user.id} />;
}
