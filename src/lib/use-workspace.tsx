'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { browserScope, clearPrivateBrowserState } from './browser-scope';
import { applyCommand } from './commands';
import { applyPipelineMove, type PipelineMove, type MoveResult } from './pipeline-moves';
import { demoWorkspace } from './demo';
import type { DraftBatch } from './assistant/drafts';
import { approvalCommands, alreadyApproved } from './assistant/planner';
import { emptyWorkspace, workspaceSchema, type Command, type Workspace } from './model';
const KEY = 'thrift-log.demo.v1';
type Value = {
  scope: string;
  isOwner: boolean;
  requestHeaders: Record<string, string>;
  now: number;
  w: Workspace;
  ready: boolean;
  demo: boolean;
  saving: boolean;
  error: string;
  notice: string;
  dispatch: (c: Command | Command[]) => Promise<boolean>;
  refresh: () => Promise<void>;
  movePipeline: (input: PipelineMove) => Promise<MoveResult | false>;
  approveAssistant: (batch: DraftBatch, rowIds: string[]) => Promise<Workspace | false>;
  notify: (s: string) => void;
  resetDemo: () => void;
};
const Context = createContext<Value | null>(null);
export function WorkspaceProvider({
  demo,
  children,
  userId,
  isOwner = false,
}: {
  userId?: string;
  isOwner?: boolean;
  demo: boolean;
  children: React.ReactNode;
}) {
  const scope = browserScope(demo, userId);
  const requestHeaders = useMemo(
    (): Record<string, string> => (userId ? { 'x-thrift-user': userId } : {}),
    [userId],
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const [w, setW] = useState(emptyWorkspace);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const ref = useRef(w);
  const busy = useRef(false);
  const install = useCallback((next: Workspace) => {
    ref.current = next;
    setW(next);
  }, []);
  const refresh = useCallback(async () => {
    try {
      setError('');
      if (demo) {
        const raw = localStorage.getItem(KEY);
        const next = raw ? workspaceSchema.parse(JSON.parse(raw)) : demoWorkspace();
        install(next);
        if (!raw) localStorage.setItem(KEY, JSON.stringify(next));
      } else {
        const r = await fetch('/api/workspace', {
          cache: 'no-store',
          headers: { 'x-thrift-user': userId || '' },
        });
        const data = await r.json();
        if (r.status === 401) {
          install(emptyWorkspace());
          clearPrivateBrowserState();
        }
        if (!r.ok) throw new Error(data.error);
        install(workspaceSchema.parse(data));
      }
      setReady(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load your workspace.');
      setReady(true);
    }
  }, [demo, install, userId]);
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    const listener = (e: StorageEvent) => {
      if (demo && e.key === KEY) void refresh();
    };
    window.addEventListener('storage', listener);
    const focus = () => {
      if (!demo) void refresh();
    };
    window.addEventListener('focus', focus);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('storage', listener);
      window.removeEventListener('focus', focus);
    };
  }, [demo, refresh]);
  useEffect(() => {
    document.documentElement.dataset.theme = w.settings.theme;
  }, [w.settings.theme]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  const dispatch = useCallback(
    async (input: Command | Command[]) => {
      if (busy.current) return false;
      busy.current = true;
      setSaving(true);
      setError('');
      try {
        const commands = Array.isArray(input) ? input : [input];
        if (demo) {
          const commit = () => {
            const raw = localStorage.getItem(KEY);
            const latest = raw ? workspaceSchema.parse(JSON.parse(raw)) : ref.current;
            const next = commands.reduce(applyCommand, latest);
            localStorage.setItem(KEY, JSON.stringify(next));
            install(next);
          };
          if (navigator.locks) await navigator.locks.request(KEY, commit);
          else commit();
        } else {
          const response = await fetch('/api/workspace', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-thrift-user': userId || '' },
            body: JSON.stringify({ revision: ref.current.revision, commands }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error);
          install(workspaceSchema.parse(data));
        }
        return true;
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : 'Unable to save. Check your connection; your change has not been committed.',
        );
        return false;
      } finally {
        busy.current = false;
        setSaving(false);
      }
    },
    [demo, install, userId],
  );
  const approveAssistant = useCallback(
    async (batch: DraftBatch, rowIds: string[]) => {
      if (busy.current) return false;
      busy.current = true;
      setSaving(true);
      setError('');
      try {
        if (demo) {
          const commit = () => {
            const raw = localStorage.getItem(KEY);
            const current = raw ? workspaceSchema.parse(JSON.parse(raw)) : ref.current;
            if (alreadyApproved(current, batch, rowIds)) {
              install(current);
              return;
            }
            if (current.revision !== batch.revision)
              throw new Error('Demo workspace changed. Refresh and review before approving.');
            const next = approvalCommands(current, batch, rowIds).reduce(applyCommand, current);
            localStorage.setItem(KEY, JSON.stringify(next));
            install(next);
          };
          if (navigator.locks) await navigator.locks.request(KEY, commit);
          else commit();
        } else {
          const response = await fetch('/api/assistant/approve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-thrift-user': userId || '' },
            body: JSON.stringify({ batch, rowIds }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error);
          install(workspaceSchema.parse(data.workspace));
        }
        return ref.current;
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : 'Approval failed. Refresh to check saved records; your draft is preserved.',
        );
        return false;
      } finally {
        busy.current = false;
        setSaving(false);
      }
    },
    [demo, install, userId],
  );
  const movePipeline = useCallback(
    async (input: PipelineMove): Promise<MoveResult | false> => {
      if (busy.current) return false;
      busy.current = true;
      setSaving(true);
      setError('');
      try {
        let result: MoveResult;
        if (demo) {
          const commit = async () => {
            const raw = localStorage.getItem(KEY);
            const current = raw ? workspaceSchema.parse(JSON.parse(raw)) : ref.current;
            result = await applyPipelineMove(current, input);
            localStorage.setItem(KEY, JSON.stringify(result.workspace));
            install(result.workspace);
          };
          if (navigator.locks) await navigator.locks.request(KEY, commit);
          else await commit();
          return result!;
        }
        const response = await fetch('/api/pipeline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-thrift-user': userId || '' },
          body: JSON.stringify(input),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        result = { ...data, workspace: workspaceSchema.parse(data.workspace) };
        install(result.workspace);
        return result;
      } catch (e) {
        setError(
          e instanceof Error ? e.message : 'Move was not confirmed. Refresh before retrying.',
        );
        return false;
      } finally {
        busy.current = false;
        setSaving(false);
      }
    },
    [demo, install, userId],
  );
  const resetDemo = () => {
    localStorage.removeItem(KEY);
    void refresh();
  };
  return (
    <Context.Provider
      value={{
        scope,
        isOwner,
        requestHeaders,
        now,
        w,
        ready,
        demo,
        saving,
        error,
        notice,
        dispatch,
        approveAssistant,
        refresh,
        movePipeline,
        notify: setNotice,
        resetDemo,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useWorkspace() {
  const value = useContext(Context);
  if (!value) throw new Error('Workspace provider required');
  return value;
}
