'use client';
import { useRef, useState } from 'react';
import { Leaf, ArrowRight, LockKeyhole } from 'lucide-react';
import Link from 'next/link';
import { Button } from './ui/button';
import { clearPrivateBrowserState } from '@/lib/browser-scope';
export function Login({
  configured,
  initialError = '',
  registration = 'disabled',
}: {
  configured: boolean;
  initialError?: string;
  registration?: 'disabled' | 'preauthorized' | 'email';
}) {
  const [error, setError] = useState(initialError);
  const [pending, setPending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState('');
  const submitting = useRef(false);
  return (
    <div className="login-page">
      <div className="login-card">
        <div className="brand">
          <span className="brand-mark">
            <Leaf size={25} />
          </span>
          <span>
            thrift<span className="brand-light">log</span>
          </span>
        </div>
        <span className="eyebrow">GOOD FINDS. CLEAR NUMBERS.</span>
        <h1>
          Your business.
          <br />A little more together.
        </h1>
        <p>One quiet place for your inventory, earnings, and the work behind every sale.</p>
        {configured ? (
          <form
            className="editor-form"
            action={creating ? '/api/register' : '/api/auth'}
            method="post"
            onInvalidCapture={(e) => {
              const field = e.target as HTMLInputElement;
              setError(field.validationMessage || 'Please enter your email and password.');
            }}
            onSubmit={async (e) => {
              e.preventDefault();
              if (submitting.current) return;
              submitting.current = true;
              setPending(true);
              setError('');
              setNotice('');
              clearPrivateBrowserState();
              const f = new FormData(e.currentTarget);
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 20000);
              try {
                const r = await fetch(creating ? '/api/register' : '/api/auth', {
                  method: 'POST',
                  credentials: 'same-origin',
                  signal: controller.signal,
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    ...(creating ? {} : { action: 'signin' }),
                    email: f.get('email'),
                    password: f.get('password'),
                  }),
                });
                const data = await r.json();
                if (!r.ok) throw new Error(data.error);
                if (data.confirmationRequired) {
                  setNotice(data.message);
                  return;
                }
                const session = await fetch('/api/workspace', {
                  cache: 'no-store',
                  credentials: 'same-origin',
                  signal: controller.signal,
                });
                if (!session.ok)
                  throw new Error(
                    session.status === 401
                      ? 'Your browser could not keep your sign-in session. Allow cookies for this site and try again.'
                      : 'You signed in, but your workspace could not load. Please try again.',
                  );
                // Load a fresh authenticated document instead of reusing a cached login route.
                // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Authentication must load a fresh document after cookies are confirmed.
                window.location.assign('/');
              } catch (e) {
                setError(
                  controller.signal.aborted
                    ? creating
                      ? 'Account setup timed out. Try signing in with the same password before creating another account.'
                      : 'Sign-in timed out. Check your connection and try again.'
                    : e instanceof TypeError
                      ? 'Could not connect to sign in. Check your connection and try again.'
                      : e instanceof Error
                        ? e.message
                        : 'Sign-in failed.',
                );
              } finally {
                clearTimeout(timeout);
                submitting.current = false;
                setPending(false);
              }
            }}
          >
            <div className="actions" aria-label="Account access">
              <Button
                type="button"
                variant={creating ? 'ghost' : 'outline'}
                aria-pressed={!creating}
                disabled={pending}
                onClick={() => {
                  setCreating(false);
                  setError('');
                  setNotice('');
                }}
              >
                Sign in
              </Button>
              <Button
                type="button"
                variant={creating ? 'outline' : 'ghost'}
                aria-pressed={creating}
                disabled={pending}
                onClick={() => {
                  setCreating(true);
                  setError('');
                  setNotice('');
                }}
              >
                Create Account
              </Button>
            </div>
            <input type="hidden" name="action" value="signin" />
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                name="email"
                required
                autoComplete="username"
                disabled={pending}
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                name="password"
                required
                minLength={creating ? 12 : undefined}
                maxLength={creating ? 72 : 500}
                autoComplete={creating ? 'new-password' : 'current-password'}
                disabled={pending}
              />
            </label>
            {creating && (
              <p className="hint">
                Use your owner-approved email and a password of at least 12 characters. Existing
                accounts keep their current password; choose Sign in if you already have one.
              </p>
            )}
            {creating && registration === 'disabled' && (
              <p className="hint">
                Account creation is not enabled yet. Ask the owner for setup help.
              </p>
            )}
            {creating && registration === 'preauthorized' && (
              <p className="hint">
                No confirmation email is sent during this beta. Double-check your approved email.
                Password recovery requires help from the owner unless email delivery is configured.
              </p>
            )}
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="hint">
                {notice}
              </p>
            )}
            <Button
              type="submit"
              disabled={pending || (creating && registration === 'disabled')}
              aria-busy={pending}
            >
              {pending
                ? creating
                  ? 'Creating account…'
                  : 'Signing in…'
                : creating
                  ? 'Create my account'
                  : 'Sign in securely'}
              <ArrowRight size={16} />
            </Button>
            <p className="hint">
              <LockKeyhole size={13} /> Approved testers only. Each account has its own private
              workspace.
            </p>
          </form>
        ) : (
          <div className="setup-note">
            <h3>Your private workspace needs Supabase</h3>
            <p>
              Configure the project URL, public key, server key, and owner email; apply the database
              migration, then create your account. See README.md for the exact steps.
            </p>
            <Link href="/demo" className="btn btn-primary">
              Explore the separate demo <ArrowRight size={16} />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
