'use client';
import { SecureWorkspace } from './secure-workspace';
import { WorkspaceProvider } from '@/lib/use-workspace';
import { WhatnotSyncProvider } from './whatnot-auto-sync';

export function WorkspaceRoot({
  demo,
  userId,
  isOwner = false,
  children,
}: {
  demo: boolean;
  userId?: string;
  isOwner?: boolean;
  children: React.ReactNode;
}) {
  return (
    <SecureWorkspace>
      <WorkspaceProvider key={userId || 'demo'} demo={demo} userId={userId} isOwner={isOwner}>
        <WhatnotSyncProvider>{children}</WhatnotSyncProvider>
      </WorkspaceProvider>
    </SecureWorkspace>
  );
}
