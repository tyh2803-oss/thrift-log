'use client';
import { useState } from 'react';
import { Leaf, ArrowRight, LockKeyhole } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from './ui/button';
export function Login({ configured }: { configured: boolean }) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const router = useRouter();
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
            onSubmit={async (e) => {
              e.preventDefault();
              setPending(true);
              setError('');
              const f = new FormData(e.currentTarget);
              try {
                const r = await fetch('/api/auth', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    action: 'signin',
                    email: f.get('email'),
                    password: f.get('password'),
                  }),
                });
                const data = await r.json();
                if (!r.ok) throw new Error(data.error);
                router.push('/');
                router.refresh();
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Sign-in failed.');
              } finally {
                setPending(false);
              }
            }}
          >
            <label className="field">
              <span>Email</span>
              <input type="email" name="email" required autoComplete="username" />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                name="password"
                required
                minLength={8}
                autoComplete="current-password"
              />
            </label>
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
            <Button disabled={pending}>
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
