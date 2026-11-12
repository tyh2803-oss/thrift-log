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
  const [setup, setSetup] = useState<{ email: string; link: string } | null>(null);
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
  async function action(action: 'authorize' | 'revoke' | 'invite' | 'setup', target: string) {
    if (lock.current) return;
    if (
      action === 'revoke' &&
      !window.confirm(`Revoke ${target}’s access? Their records will be retained.`)
    )
      return;
    if (
      action === 'setup' &&
      !window.confirm(
        `Create a private setup link for ${target}? It lets this tester choose a password for their existing account. Share it only with that person.`,
      )
    )
      return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    setSetup(null);
    try {
      const r = await fetch('/api/beta', {
        method: 'POST',
        headers: { ...requestHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, email: target }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      setTesters(body.testers);
      if (body.setup) setSetup(body.setup);
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
  async function copySetupLink() {
    if (!setup) return;
    try {
      await navigator.clipboard.writeText(setup.link);
      setNotice(
        `Private setup link copied for ${setup.email}. Share it directly with that friend; do not post it publicly.`,
      );
    } catch {
      setError('The link could not be copied. Allow clipboard access for this site and try again.');
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
      {setup && (
        <div className="setup-note" role="group" aria-label="Private tester setup link">
          <strong>Ready for {setup.email}</strong>
          <p>
            No password is displayed or changed. Copy the private, one-use link and send it directly
            to this tester. They open it and choose their own password. It expires according to your
            Auth settings; creating a new link replaces the old one.
          </p>
          <div className="actions">
            <Button type="button" onClick={() => void copySetupLink()}>
              Copy private setup link
            </Button>
            <Button type="button" variant="ghost" onClick={() => setSetup(null)}>
              Dismiss link
            </Button>
          </div>
        </div>
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
                  onClick={() => void action('setup', t.email)}
                >
                  Set up tester account
                </Button>
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
