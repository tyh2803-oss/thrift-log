'use client';
import { useEffect, useState } from 'react';
import { browserSupport, type BrowserSupport } from '@/lib/browser-support';
export function SecureWorkspace({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<BrowserSupport | 'checking'>('checking');
  const [httpsAddress, setHttpsAddress] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setStatus(browserSupport(window));
      const address = new URL(window.location.href);
      address.protocol = 'https:';
      setHttpsAddress(address.href);
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  if (status === 'checking')
    return (
      <p className="loading" role="status">
        Checking browser support…
      </p>
    );
  if (status === 'ready') return children;
  return (
    <main className="login-page">
      <section className="login-card" role="alert">
        <h1>
          {status === 'https-required' ? 'Open Thrift Log over HTTPS' : 'Update your browser'}
        </h1>
        <p>
          {status === 'https-required'
            ? 'Adding items, running timers and reading screenshots need a trusted secure connection. For local iPhone testing, install and trust the development certificate first.'
            : 'This browser is missing the security features Thrift Log needs. Update Safari or use a current browser, then try again.'}
        </p>
        {status === 'https-required' && (
          <a className="btn btn-primary" href={httpsAddress}>
            Open HTTPS address
          </a>
        )}
      </section>
    </main>
  );
}
