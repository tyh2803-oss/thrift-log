import { WorkspaceRoot } from '@/components/workspace-root';

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceRoot demo>{children}</WorkspaceRoot>;
}
