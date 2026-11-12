'use client';
import { useEffect, useRef, useState } from 'react';
import { useWorkspace } from '@/lib/use-workspace';
import { Button } from './ui/button';
type Tester = { email: string; active: boolean; linked: boolean };
export function BetaAccess() {
  const { isOwner, requestHeaders } = useWorkspace();
  const [testers, setTesters] = useState<Tester[]>([]),
    [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    if (!isOwner) return;
    const controller = new AbortController();
    void fetch('/api/beta', {
      cache: 'no-store',
      headers: requestHeaders,
      signal: controller.signal,
    })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error);
        setTesters(body.testers);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message || 'Access list could not load.');
      });
    return () => controller.abort();
  }, [isOwner, requestHeaders]);
  async function action(action: 'authorize' | 'revoke' | 'invite', target: string) {
    if (lock.current) return;
    if (
      action === 'revoke' &&
      !window.confirm(`Revoke ${target}’s access? Their records will be retained.`)
    )
      return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await fetch('/api/beta', {
        method: 'POST',
        headers: { ...requestHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, email: target }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      setTesters(body.testers);
      setNotice(body.message);
      if (action === 'authorize') setEmail('');
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Access change was not confirmed. Refresh before retrying.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (!isOwner) return null;
  return (
    <section className="card padded beta-access">
      <h2>Beta testers</h2>
      <p>
        Authorize an email, then ask your friend to choose Create Account on the login page when
        registration is enabled. Invitations remain optional. Existing approved accounts can sign in
        normally. Every account has a separate workspace.
      </p>
      <form
        className="editor-form"
        onSubmit={(e) => {
          e.preventDefault();
          void action('authorize', email);
        }}
      >
        <label className="field">
          <span>Tester email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={320}
            autoComplete="off"
            required
            disabled={busy}
          />
        </label>
        <Button disabled={busy}>{busy ? 'Saving…' : 'Authorize email'}</Button>
      </form>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="hint">
          {notice}
        </p>
      )}
      {!testers.length && <p className="hint">No testers authorized yet.</p>}
      {testers.map((t) => (
        <div className="detail-row" key={t.email}>
          <div className="grow">
            <strong>{t.email}</strong>
            <p>
              {t.active ? 'Authorized' : 'Revoked'} ·{' '}
              {t.linked ? 'Account linked' : 'Account links after verified sign-in'}
            </p>
          </div>
          <div className="actions">
            {t.active ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void action('invite', t.email)}
                >
                  Send invitation
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void action('revoke', t.email)}
                >
                  Revoke access
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void action('authorize', t.email)}
              >
                Restore access
              </Button>
            )}
          </div>
        </div>
      ))}
      <p className="hint">
        Revocation blocks future app/database/photo requests without deleting records. Public signup
        stays disabled. Invitations require the approved app URL and Supabase email template
        described in the beta setup guide.
      </p>
    </section>
  );
}
