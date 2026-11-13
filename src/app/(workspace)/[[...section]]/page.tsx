import { notFound } from 'next/navigation';
import { ThriftApp } from '@/components/app-shell';
import { pageIdentity } from '@/lib/supabase/page-identity';
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
  const identity = await pageIdentity();
  return <ThriftApp section={section} pipeline={pipeline} {...identity} />;
}
