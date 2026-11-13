import { WorkspaceRoot } from '@/components/workspace-root';
import { pageIdentity } from '@/lib/supabase/page-identity';

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const identity = await pageIdentity();
  return <WorkspaceRoot {...identity}>{children}</WorkspaceRoot>;
}
