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
import { historyCommands } from './assistant/history';
import { emptyWorkspace, workspaceSchema, type Command, type Workspace } from './model';
const KEY = 'thrift-log.demo.v1';
type Value = {
  scope: string;
  isOwner: boolean;
  requestHeaders: Record<string, string>;
  w: Workspace;
  ready: boolean;
  demo: boolean;
  saving: boolean;
  error: string;
  notice: string;
  dispatch: (c: Command | Command[]) => Promise<boolean>;
  refresh: (onlyIfChanged?: boolean) => Promise<void>;
  movePipeline: (input: PipelineMove) => Promise<MoveResult | false>;
  approveAssistant: (
    batch: DraftBatch,
    rowIds: string[],
    mode?: 'history',
  ) => Promise<Workspace | false>;
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
  const [w, setW] = useState(emptyWorkspace);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const ref = useRef(w);
  const busy = useRef(false);
  const alive = useRef(true);
  const loaded = useRef(false);
  const permitted = useRef(true);
  const refreshTask = useRef<Promise<void> | null>(null);
  const readController = useRef<AbortController | null>(null);
  const refreshAfterSave = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      readController.current?.abort();
    };
  }, []);
  const install = useCallback(
    (next: Workspace) => {
      if (!alive.current) return;
      if (!demo && !permitted.current)
        throw new Error(
          'Your session changed. Sign in and refresh to check the result before retrying.',
        );
      if (!demo && next.revision < ref.current.revision) return;
      ref.current = next;
      setW(next);
    },
    [demo],
  );
  const forget = useCallback(() => {
    if (!alive.current) return;
    permitted.current = false;
    loaded.current = false;
    const empty = emptyWorkspace();
    ref.current = empty;
    setW(empty);
    clearPrivateBrowserState();
  }, []);
  const refresh = useCallback(
    async (onlyIfChanged = false) => {
      if (busy.current) {
        refreshAfterSave.current = true;
        return;
      }
      if (refreshTask.current) return refreshTask.current;
      const controller = new AbortController();
      readController.current = controller;
      const task = (async () => {
        try {
          // A routine background check must not erase an unconfirmed-save error.
          if (!onlyIfChanged) setError('');
          if (demo) {
            const raw = localStorage.getItem(KEY);
            const next = raw ? workspaceSchema.parse(JSON.parse(raw)) : demoWorkspace();
            if (JSON.stringify(next) !== JSON.stringify(ref.current)) install(next);
            if (!raw) localStorage.setItem(KEY, JSON.stringify(next));
          } else {
            const query =
              onlyIfChanged && loaded.current ? `?revision=${ref.current.revision}` : '';
            const r = await fetch(`/api/workspace${query}`, {
              cache: 'no-store',
              headers: { 'x-thrift-user': userId || '' },
              signal: controller.signal,
            });
            if (!alive.current || controller.signal.aborted) return;
            if (r.status === 304) return;
            const data = await r.json();
            if (!alive.current || controller.signal.aborted) return;
            if (r.status === 401) {
              forget();
            }
            if (!r.ok) throw new Error(data.error);
            const next = workspaceSchema.parse(data);
            if (busy.current) {
              refreshAfterSave.current = true;
              return;
            }
            permitted.current = true;
            // A slow GET must never overwrite the newer, confirmed result of a save.
            if (
              next.revision >= ref.current.revision &&
              JSON.stringify(next) !== JSON.stringify(ref.current)
            )
              install(next);
          }
          loaded.current = true;
          setReady(true);
        } catch (e) {
          if (!alive.current || controller.signal.aborted) return;
          const message = e instanceof Error ? e.message : 'Unable to load your workspace.';
          setError((previous) =>
            onlyIfChanged && permitted.current && previous ? previous : message,
          );
          setReady(true);
        }
      })();
      refreshTask.current = task;
      try {
        await task;
      } finally {
        if (readController.current === controller) {
          readController.current = null;
          refreshTask.current = null;
        }
      }
    },
    [demo, install, userId, forget],
  );
  const finishSave = useCallback(() => {
    busy.current = false;
    if (!alive.current) return;
    setSaving(false);
    if (refreshAfterSave.current) {
      refreshAfterSave.current = false;
      void refresh(true);
    }
  }, [refresh]);
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    const listener = (e: StorageEvent) => {
      if (demo && e.key === KEY) void refresh();
    };
    window.addEventListener('storage', listener);
    const focus = () => {
      if (!demo && document.visibilityState !== 'hidden') void refresh(true);
    };
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    window.addEventListener('online', focus);
    const poll = !demo ? setInterval(focus, 60_000) : undefined;
    return () => {
      clearTimeout(timer);
      window.removeEventListener('storage', listener);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', focus);
      window.removeEventListener('online', focus);
      clearInterval(poll);
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
          if (response.status === 401) forget();
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
        finishSave();
      }
    },
    [demo, install, userId, finishSave, forget],
  );
  const approveAssistant = useCallback(
    async (batch: DraftBatch, rowIds: string[], mode?: 'history') => {
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
            const next = (
              mode === 'history'
                ? historyCommands(current, batch, rowIds)
                : approvalCommands(current, batch, rowIds)
            ).reduce(applyCommand, current);
            localStorage.setItem(KEY, JSON.stringify(next));
            install(next);
          };
          if (navigator.locks) await navigator.locks.request(KEY, commit);
          else commit();
        } else {
          const response = await fetch('/api/assistant/approve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-thrift-user': userId || '' },
            body: JSON.stringify({ batch, rowIds, mode }),
          });
          const data = await response.json();
          if (response.status === 401) forget();
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
        finishSave();
      }
    },
    [demo, install, userId, finishSave, forget],
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
        if (response.status === 401) forget();
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
        finishSave();
      }
    },
    [demo, install, userId, finishSave, forget],
  );
  const resetDemo = useCallback(() => {
    localStorage.removeItem(KEY);
    void refresh();
  }, [refresh]);
  const value = useMemo<Value>(
    () => ({
      scope,
      isOwner,
      requestHeaders,
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
    }),
    [
      scope,
      isOwner,
      requestHeaders,
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
      resetDemo,
    ],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useWorkspace() {
  const value = useContext(Context);
  if (!value) throw new Error('Workspace provider required');
  return value;
}
