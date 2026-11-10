export type BrowserSupport = 'ready' | 'https-required' | 'browser-update-required';
/** Native cryptography is required; never substitute weaker identifiers or hashes. */
export function browserSupport(environment: {
  isSecureContext: boolean;
  crypto?: { randomUUID?: unknown; subtle?: { digest?: unknown } };
}): BrowserSupport {
  if (!environment.isSecureContext) return 'https-required';
  if (
    typeof environment.crypto?.randomUUID !== 'function' ||
    typeof environment.crypto?.subtle?.digest !== 'function'
  )
    return 'browser-update-required';
  return 'ready';
}
