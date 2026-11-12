'use client';
import { useState } from 'react';
import { Button } from './ui/button';
import { clearPrivateBrowserState } from '@/lib/browser-scope';
import { MIN_PASSWORD_LENGTH } from '@/lib/password-policy';
export function SetPassword({ userId }: { userId: string }) {
  const [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  return (
    <main className="login-page">
      <section className="login-card">
        <h1>Choose your password</h1>
        <p>Your account has its own private Thrift Log workspace.</p>
        <form
          className="editor-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (saving) return;
            const form = new FormData(e.currentTarget);
            if (form.get('password') !== form.get('confirm')) {
              setError('Passwords must match.');
              return;
            }
            setSaving(true);
            setError('');
            try {
              const response = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-thrift-user': userId },
                body: JSON.stringify({ action: 'password', password: form.get('password') }),
              });
              if (!response.ok)
                throw new Error(
                  `Password was not saved. Use at least ${MIN_PASSWORD_LENGTH} characters or request a fresh invitation.`,
                );
              clearPrivateBrowserState();
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Fresh authenticated document.
              window.location.assign('/');
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Password was not saved.');
            } finally {
              setSaving(false);
            }
          }}
        >
          <label className="field">
            <span>New password</span>
            <input
              name="password"
              type="password"
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={128}
              autoComplete="new-password"
              required
            />
          </label>
          <label className="field">
            <span>Confirm password</span>
            <input
              name="confirm"
              type="password"
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={128}
              autoComplete="new-password"
              required
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <Button disabled={saving}>{saving ? 'Saving…' : 'Save password'}</Button>
        </form>
      </section>
    </main>
  );
}
