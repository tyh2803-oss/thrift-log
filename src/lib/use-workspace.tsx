'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { applyCommand } from './commands';
import { demoWorkspace } from './demo';
import { emptyWorkspace, workspaceSchema, type Command, type Workspace } from './model';
const KEY = 'thrift-log.demo.v1';
type Value = {
  now: number;
  w: Workspace;
  ready: boolean;
  demo: boolean;
  saving: boolean;
  error: string;
  notice: string;
  dispatch: (c: Command | Command[]) => Promise<boolean>;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
  resetDemo: () => void;
};
const Context = createContext<Value | null>(null);
export function WorkspaceProvider({
  demo,
  children,
}: {
  demo: boolean;
  children: React.ReactNode;
}) {
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
        const r = await fetch('/api/workspace', { cache: 'no-store' });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        install(workspaceSchema.parse(data));
      }
      setReady(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load your workspace.');
      setReady(true);
    }
  }, [demo, install]);
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    const listener = (e: StorageEvent) => {
      if (demo && e.key === KEY) void refresh();
    };
    window.addEventListener('storage', listener);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('storage', listener);
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
            headers: { 'Content-Type': 'application/json' },
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
    [demo, install],
  );
  const resetDemo = () => {
    localStorage.removeItem(KEY);
    void refresh();
  };
  return (
    <Context.Provider
      value={{
        now,
        w,
        ready,
        demo,
        saving,
        error,
        notice,
        dispatch,
        refresh,
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
