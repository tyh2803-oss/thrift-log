import 'server-only';
export const EBAY_DOCS = 'https://developer.ebay.com/api-docs/sell/fulfillment/overview.html';
export const EBAY_SCOPES = [
  'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
];
export const EBAY_FINANCE_SCOPE = 'https://api.ebay.com/oauth/api_scope/sell.finances';
export class EbayError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}
export const errors: Record<string, string> = {
  auth: 'eBay authorization expired or was revoked. Reconnect your account.',
  permissions:
    'eBay has not enabled this API permission for the app or account. Orders remain available; check eBay developer access.',
  finance:
    'Financial data is unavailable. Check eBay Finances API access and any required EU/UK request signing. Orders still sync.',
  rate: 'eBay is limiting requests. Progress is saved; synchronization will retry later.',
  provider: 'eBay could not complete the request. Saved records and progress are preserved.',
  response:
    'eBay returned unsupported data. Saved records are preserved; retry or contact support.',
  conflict: 'Another save, sync or disconnect changed this connection. Refresh and retry.',
};
export function appOrigin() {
  try {
    const url = new URL(process.env.EBAY_APP_URL || '');
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new EbayError(
      'setup',
      'eBay needs its saved migration, application keys, RuName and HTTPS EBAY_APP_URL. See docs/EBAY_INTEGRATION.md.',
      503,
    );
  }
}
export function config(requireRedirect = true) {
  const environment = process.env.EBAY_ENVIRONMENT || 'production';
  if (!['production', 'sandbox'].includes(environment))
    throw new EbayError('setup', 'Set EBAY_ENVIRONMENT to production or sandbox.', 503);
  const clientId = process.env.EBAY_CLIENT_ID || '',
    secret = process.env.EBAY_CLIENT_SECRET || '',
    redirect = process.env.EBAY_REDIRECT_URI_NAME || '';
  const origin = appOrigin();
  if (!clientId || !secret || (requireRedirect && !redirect))
    throw new EbayError(
      'setup',
      'Add the eBay Production application keys and RuName in server environment settings.',
      503,
    );
  return {
    clientId,
    secret,
    redirect,
    origin,
    environment,
    financeEnabled: process.env.EBAY_ENABLE_FINANCES === 'true',
    api: environment === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com',
    auth: environment === 'sandbox' ? 'https://auth.sandbox.ebay.com' : 'https://auth.ebay.com',
  };
}
