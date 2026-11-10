'use client';
import { useState } from 'react';
import { Leaf, ArrowRight, LockKeyhole } from 'lucide-react';
import Link from 'next/link';
import { Button } from './ui/button';
export function Login({
  configured,
  initialError = '',
}: {
  configured: boolean;
  initialError?: string;
}) {
  const [error, setError] = useState(initialError);
  const [pending, setPending] = useState(false);
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
            action="/api/auth"
            method="post"
            onInvalidCapture={(e) => {
              const field = e.target as HTMLInputElement;
              setError(field.validationMessage || 'Please enter your email and password.');
            }}
            onSubmit={async (e) => {
              e.preventDefault();
              setPending(true);
              setError('');
              const f = new FormData(e.currentTarget);
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 20000);
              try {
                const r = await fetch('/api/auth', {
                  method: 'POST',
                  credentials: 'same-origin',
                  signal: controller.signal,
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    action: 'signin',
                    email: f.get('email'),
                    password: f.get('password'),
                  }),
                });
                const data = await r.json();
                if (!r.ok) throw new Error(data.error);
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
                    ? 'Sign-in timed out. Check your connection and try again.'
                    : e instanceof TypeError
                      ? 'Could not connect to sign in. Check your connection and try again.'
                      : e instanceof Error
                        ? e.message
                        : 'Sign-in failed.',
                );
              } finally {
                clearTimeout(timeout);
                setPending(false);
              }
            }}
          >
            <input type="hidden" name="action" value="signin" />
            <label className="field">
              <span>Email</span>
              <input type="email" name="email" required autoComplete="username" />
            </label>
            <label className="field">
              <span>Password</span>
              <input type="password" name="password" required autoComplete="current-password" />
            </label>
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {pending ? 'Signing in…' : 'Sign in securely'}
              <ArrowRight size={16} />
            </Button>
            <p className="hint">
              <LockKeyhole size={13} /> Private access. Accounts are created by the owner in
              Supabase.
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
