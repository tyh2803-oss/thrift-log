import { it, expect } from 'vitest';
import { browserSupport } from '../src/lib/browser-support';
it('requires a secure connection before mounting UUID or screenshot workflows', () => {
  expect(browserSupport({ isSecureContext: false })).toBe('https-required');
});
it('requires the real UUID and SHA-256 APIs even on HTTPS', () => {
  expect(browserSupport({ isSecureContext: true, crypto: {} })).toBe('browser-update-required');
  expect(browserSupport({ isSecureContext: true, crypto: { randomUUID: () => '' } })).toBe(
    'browser-update-required',
  );
  expect(
    browserSupport({
      isSecureContext: true,
      crypto: { randomUUID: () => '', subtle: { digest: true } },
    }),
  ).toBe('browser-update-required');
  expect(browserSupport({ isSecureContext: true, crypto })).toBe('ready');
});
