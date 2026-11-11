import { notFound } from 'next/navigation';
import { ThriftApp } from '@/components/app-shell';
import { configured, configurationPresent, requireUser } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { readConfiguration } from '@/lib/supabase/config';
export const dynamic = 'force-dynamic';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ section?: string[] }>;
  searchParams: Promise<{ pipeline?: string }>;
}) {
  const pipeline = (await searchParams).pipeline;
  const { section: segments } = await params;
  const section = segments?.[0] || 'home';
  if (
    (segments?.length || 0) > 1 ||
    !['home', 'inventory', 'sales', 'activity', 'insights', 'settings'].includes(section)
  )
    notFound();
  if (!configured()) {
    if (configurationPresent()) redirect('/login');
    return <ThriftApp section={section} demo pipeline={pipeline} />;
  }
  const user = await requireUser().catch(() => null);
  if (!user) redirect('/login');
  return (
    <ThriftApp
      section={section}
      demo={false}
      email={user.email}
      userId={user.id}
      isOwner={
        user.betaRole === 'owner' &&
        user.email?.toLowerCase() === readConfiguration(process.env).ownerEmail
      }
      pipeline={pipeline}
    />
  );
}
