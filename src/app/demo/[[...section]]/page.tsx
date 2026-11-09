import { notFound } from 'next/navigation';
import { ThriftApp } from '@/components/app-shell';
export default async function Page({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section: segments } = await params;
  const section = segments?.[0] || 'home';
  if (
    (segments?.length || 0) > 1 ||
    !['home', 'inventory', 'sales', 'activity', 'insights', 'settings'].includes(section)
  )
    notFound();
  return <ThriftApp section={section} demo />;
}
