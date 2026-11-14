'use client';
/* Private photo bytes use the existing authenticated proxy, never a public URL. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { Camera, LogOut, Settings2, Trash2 } from 'lucide-react';
import { useWorkspace } from '@/lib/use-workspace';
import { clearPrivateBrowserState } from '@/lib/browser-scope';
import { prepareProfileImage } from '@/lib/profile-image';
import { DEMO_PROFILE_KEY } from '@/lib/profile';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';

export function ProfileAvatar({
  path,
  email,
  large = false,
}: {
  path: string | null;
  email?: string;
  large?: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const src = path?.startsWith('data:')
    ? path
    : path
      ? `/api/photos?path=${encodeURIComponent(path)}`
      : null;
  return (
    <span className={`avatar profile-avatar${large ? ' profile-avatar-large' : ''}`}>
      {src && failed !== src ? (
        <img src={src} alt="" onError={() => setFailed(src)} />
      ) : (
        email?.[0]?.toUpperCase() || 'T'
      )}
    </span>
  );
}

export function ProfileMenu({
  email,
  path,
  base,
  onPhotoChange,
}: {
  email?: string;
  path: string | null;
  base: string;
  onPhotoChange: (path: string | null) => void;
}) {
  const { demo, requestHeaders } = useWorkspace(),
    [open, setOpen] = useState(false),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    file = useRef<HTMLInputElement>(null),
    lock = useRef(false),
    edge = useRef<'first' | 'last'>('first');
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const timer = requestAnimationFrame(() => {
      const items = root.current?.querySelectorAll<HTMLElement>('[role=menuitem]');
      items?.[edge.current === 'last' ? items.length - 1 : 0]?.focus();
    });
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => {
      cancelAnimationFrame(timer);
      document.removeEventListener('pointerdown', outside);
    };
  }, [open]);
  function changePhoto(next: string | null) {
    if (demo) {
      if (next) localStorage.setItem(DEMO_PROFILE_KEY, next);
      else localStorage.removeItem(DEMO_PROFILE_KEY);
      window.dispatchEvent(new Event('thrift-log.demo-profile'));
    }
    onPhotoChange(next);
  }
  async function upload(original: File) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const image = await prepareProfileImage(original);
      if (demo) {
        const result = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('Unable to read this photo.'));
          reader.readAsDataURL(image);
        });
        changePhoto(result);
      } else {
        const form = new FormData();
        form.append('file', image);
        const response = await fetch('/api/profile', {
          method: 'POST',
          headers: requestHeaders,
          body: form,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Photo save was not confirmed.');
        changePhoto(result.path);
      }
      setMessage(demo ? 'Profile photo saved in this demo browser.' : 'Profile photo saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save this photo.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function remove() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (!demo) {
        const response = await fetch('/api/profile', { method: 'DELETE', headers: requestHeaders });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Photo removal was not confirmed.');
      }
      changePhoto(null);
      setMessage('Profile photo removed.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to remove this photo.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function signOut() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'signout' }),
      });
      if (!response.ok) throw new Error('Sign-out was not confirmed. Try again.');
      clearPrivateBrowserState();
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Drop private in-memory records after sign-out.
      window.location.assign('/login');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to sign out.');
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <div
        className="profile-menu-root"
        ref={root}
        onBlur={(event) => {
          if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node))
            setOpen(false);
        }}
      >
        <button
          ref={trigger}
          type="button"
          className="profile-menu-trigger"
          aria-label="Open profile menu"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={() => {
            edge.current = 'first';
            setOpen(!open);
          }}
          onKeyDown={(event) => {
            if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
              event.preventDefault();
              edge.current = event.key === 'ArrowUp' ? 'last' : 'first';
              setOpen(true);
            }
          }}
        >
          <ProfileAvatar path={path} email={email} />
        </button>
        {open && (
          <div
            className="profile-dropdown card"
            id={id}
            role="menu"
            aria-label="Your account"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setOpen(false);
                trigger.current?.focus();
                return;
              }
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const items = [
                  ...event.currentTarget.querySelectorAll<HTMLElement>('[role=menuitem]'),
                ],
                index = items.indexOf(document.activeElement as HTMLElement);
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? items.length - 1
                    : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
              items[next]?.focus();
            }}
          >
            <div className="profile-menu-heading">
              <strong>{demo ? 'Demo profile' : 'Your account'}</strong>
              <small>{email || 'Saved only in this browser'}</small>
            </div>
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                setOpen(false);
                setEditing(true);
                setError('');
                setMessage('');
              }}
            >
              <Camera size={17} />
              {path ? 'Change profile photo' : 'Add profile photo'}
            </button>
            <Link
              role="menuitem"
              tabIndex={-1}
              href={`${base}/settings`}
              aria-label="Open settings"
              onClick={() => setOpen(false)}
            >
              <Settings2 size={17} />
              Settings
            </Link>
            {demo ? (
              <Link role="menuitem" tabIndex={-1} href="/login">
                <LogOut size={17} />
                Sign in
              </Link>
            ) : (
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={busy}
                onClick={() => void signOut()}
              >
                <LogOut size={17} />
                {busy ? 'Signing out…' : 'Sign out'}
              </button>
            )}
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
          </div>
        )}
      </div>
      {editing && (
        <Dialog
          open
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
          onClose={() => {
            if (!busy) {
              setEditing(false);
              trigger.current?.focus();
            }
          }}
          title="Your profile"
          description={
            demo
              ? 'Demo photos stay in this browser. Sign in for a private profile across devices.'
              : 'Your photo is private to your Thrift Log account.'
          }
        >
          <div className="padded profile-photo-editor">
            <ProfileAvatar path={path} email={email} large />
            {email && <p className="profile-email">{email}</p>}
            <p>Choose a JPEG, PNG or WebP photo. It will be cropped to a square.</p>
            <input
              ref={file}
              type="file"
              className="sr-only"
              accept="image/jpeg,image/png,image/webp"
              aria-label="Choose profile photo"
              disabled={busy}
              onChange={(event) => {
                const selected = event.target.files?.[0];
                event.target.value = '';
                if (selected) void upload(selected);
              }}
            />
            <div className="actions">
              <Button disabled={busy} onClick={() => file.current?.click()}>
                <Camera size={17} />
                {busy ? 'Saving…' : path ? 'Change photo' : 'Add photo'}
              </Button>
              {path && (
                <Button variant="outline" disabled={busy} onClick={() => void remove()}>
                  <Trash2 size={17} />
                  Remove photo
                </Button>
              )}
            </div>
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
            {message && <p role="status">{message}</p>}
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                trigger.current?.focus();
              }}
            >
              Done
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
