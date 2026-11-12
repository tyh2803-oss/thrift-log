'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { clearPrivateBrowserState } from '@/lib/browser-scope';
export function TesterSetup() {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    const receiveLink = () => {
      if (!active) return;
      if (!window.location.hash) {
        setToken((current) => (current === null ? '' : current));
        return;
      }
      const value = new URLSearchParams(window.location.hash.slice(1)).get('token_hash') || '';
      window.history.replaceState(null, '', '/setup-tester');
      setToken(/^[a-z0-9_-]{32,512}$/i.test(value) ? value : '');
      setError('');
    };
    window.addEventListener('hashchange', receiveLink);
    // Read the initial browser-only value; later links in the same tab use the subscription.
    queueMicrotask(receiveLink);
    return () => {
      active = false;
      window.removeEventListener('hashchange', receiveLink);
    };
  }, []);
  async function continueSetup() {
    if (lock.current || !token) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/tester-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token_hash: token }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      clearPrivateBrowserState();
      setToken('');
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Load the same tester's authenticated password form.
      window.location.assign('/set-password');
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Setup could not be confirmed. Ask the owner for a new link.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const message =
    error ||
    (token === ''
      ? 'The private setup link is missing or invalid. Ask the owner to create a new one.'
      : '');
  return (
    <main className="login-page">
      <section className="login-card">
        <h1>Set up your account</h1>
        <p>
          This private, one-use link opens your existing Thrift Log account. You’ll choose your own
          password next. Your workspace and records stay with the same account.
        </p>
        <p>Only continue if the owner shared this link with you. Keep it private.</p>
        {message && (
          <p role="alert" className="error-text">
            {message}
          </p>
        )}
        <div className="editor-form">
          <Button type="button" disabled={!token || busy} onClick={() => void continueSetup()}>
            {busy ? 'Opening your account…' : 'Continue to set password'}
          </Button>
        </div>
      </section>
    </main>
  );
}
