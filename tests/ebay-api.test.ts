import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  origin: vi.fn(),
  rpc: vi.fn(),
  sync: vi.fn(),
  background: vi.fn(),
  after: vi.fn(),
  cookie: vi.fn(),
}));
vi.mock('../src/lib/supabase/server', () => ({
  requireUser: mocks.user,
  checkOrigin: mocks.origin,
  adminClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock('../src/lib/integrations/ebay/sync', () => ({
  runSync: mocks.sync,
  backgroundSync: mocks.background,
}));
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: mocks.after,
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: mocks.cookie }) }));
import { GET, POST } from '../src/app/api/integrations/ebay/route';
import { GET as callback } from '../src/app/api/integrations/ebay/callback/route';
import { GET as cron } from '../src/app/api/integrations/ebay/cron/route';
import { unseal } from '../src/lib/integrations/ebay/crypto';
import { ebayActor } from './helpers/ebay';
const status = {
  ready: true,
  connected: true,
  username: 'synthetic',
  financials: false,
  status: 'synced',
  pending: 0,
  hasMore: false,
};
const request = (data: unknown, origin = 'https://app.test') =>
  new Request(origin + '/api/integrations/ebay', {
    method: 'POST',
    headers: { origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'isolated-api-key');
  vi.stubEnv('EBAY_CLIENT_ID', 'test-client');
  vi.stubEnv('EBAY_CLIENT_SECRET', 'private-app-secret');
  vi.stubEnv('EBAY_REDIRECT_URI_NAME', 'test-runame');
  vi.stubEnv('EBAY_APP_URL', 'https://app.test');
  vi.stubEnv('EBAY_ENABLE_FINANCES', 'true');
  vi.stubEnv('CRON_SECRET', 'c'.repeat(40));
  mocks.user.mockResolvedValue({ id: ebayActor });
  mocks.origin.mockImplementation(() => {});
  mocks.rpc.mockImplementation(async (_name, args) => ({
    data:
      args.p_action === 'status'
        ? status
        : args.p_action === 'read'
          ? []
          : args.p_action === 'consume_oauth'
            ? { environment: 'production', financials: false }
            : args.p_action === 'due'
              ? []
              : { saved: true },
    error: null,
  }));
  mocks.sync.mockResolvedValue({ changed: false, hasMore: false });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) =>
      Response.json(
        String(input).endsWith('/token')
          ? {
              access_token: 'access-secret',
              refresh_token: 'refresh-secret',
              expires_in: 7200,
              token_type: 'Bearer',
            }
          : {
              userId: 'immutable-seller',
              username: 'Seller',
              status: 'CONFIRMED',
              privateEmail: 'DO_NOT_STORE',
            },
      ),
    ),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it('starts OAuth with an expiring httpOnly secure cookie, server-chosen scopes, hashed state and verified actor only', async () => {
  const r = await POST(request({ action: 'connect' }));
  expect(r.status).toBe(200);
  const data = await r.json(),
    url = new URL(data.url);
  expect(url.origin).toBe('https://auth.ebay.com');
  expect(url.searchParams.get('redirect_uri')).toBe('test-runame');
  expect(url.searchParams.get('scope')).toContain('sell.fulfillment.readonly');
  expect(url.searchParams.get('scope')).not.toContain('sell.finances');
  const cookie = r.headers.get('set-cookie')!;
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('Secure');
  expect(cookie).toContain('SameSite=lax');
  expect(cookie).toContain('Max-Age=600');
  const [, args] = mocks.rpc.mock.calls[0];
  expect(args.p_user_id).toBe(ebayActor);
  expect(args.p_data.state_hash).toMatch(/^[a-f0-9]{64}$/);
  expect(args.p_data.state_hash).not.toBe(url.searchParams.get('state'));
  expect(fetch).not.toHaveBeenCalled();
});
it('completes the same-user grant once, encrypts renewable credentials, strips identity PII and redirects without tokens or provider messages', async () => {
  const start = await POST(request({ action: 'connect' })),
    url = new URL((await start.json()).url),
    state = url.searchParams.get('state')!;
  mocks.cookie.mockReturnValue({ value: state });
  const r = await callback(
    new Request(
      'https://app.test/api/integrations/ebay/callback?' +
        new URLSearchParams({ state, code: 'private-code' }),
    ),
  );
  expect(r.status).toBe(303);
  expect(r.headers.get('location')).toBe('https://app.test/settings?ebay=connected');
  expect(r.headers.get('referrer-policy')).toBe('no-referrer');
  const [, args] = mocks.rpc.mock.calls.find(([, a]) => a.p_action === 'connect')!;
  expect(args.p_user_id).toBe(ebayActor);
  expect(args.p_data.seller_id).toBe('immutable-seller');
  expect(JSON.parse(unseal(ebayActor, args.p_data.token_ciphertext))).toMatchObject({
    accessToken: 'access-secret',
    refreshToken: 'refresh-secret',
  });
  expect(JSON.stringify(args.p_data)).not.toMatch(
    /privateEmail|DO_NOT_STORE|refresh-secret|access-secret/,
  );
  expect(mocks.after).toHaveBeenCalledOnce();
});
it('rejects bad cookies, replayed/expired state, other-user callbacks, denied consent and revoked accounts before connecting', async () => {
  const state = 's'.repeat(43);
  mocks.cookie.mockReturnValue({ value: 'wrong' });
  expect(
    (
      await callback(
        new Request(`https://app.test/api/integrations/ebay/callback?state=${state}&code=code`),
      )
    ).headers.get('location'),
  ).toContain('ebay=state');
  expect(fetch).not.toHaveBeenCalled();
  mocks.cookie.mockReturnValue({ value: state });
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'invalid_oauth_state' } });
  expect(
    (
      await callback(
        new Request(`https://app.test/api/integrations/ebay/callback?state=${state}&code=code`),
      )
    ).headers.get('location'),
  ).toContain('ebay=state');
  expect(fetch).not.toHaveBeenCalled();
  expect(
    (
      await callback(
        new Request(
          `https://app.test/api/integrations/ebay/callback?state=${state}&error=access_denied&error_description=PRIVATE`,
        ),
      )
    ).headers.get('location'),
  ).toContain('ebay=cancelled');
  expect(fetch).not.toHaveBeenCalled();
  mocks.user.mockRejectedValueOnce(new Error('Unauthorized'));
  expect(
    (
      await callback(
        new Request(`https://app.test/api/integrations/ebay/callback?state=${state}&code=code`),
      )
    ).headers.get('location'),
  ).toContain('ebay=signin');
  expect(fetch).not.toHaveBeenCalled();
});
it('rejects unauthenticated, cross-origin and malformed writes before reading credentials or changing another workspace', async () => {
  mocks.user.mockRejectedValueOnce(new Error('Unauthorized'));
  expect((await POST(request({ action: 'sync' }))).status).toBe(401);
  mocks.origin.mockImplementationOnce(() => {
    throw new Error('Invalid request origin');
  });
  expect((await POST(request({ action: 'disconnect' }))).status).toBe(403);
  expect((await POST(request({ action: 'disconnect', userId: crypto.randomUUID() }))).status).toBe(
    400,
  );
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
it('keeps migrations and app credentials optional while returning accurate setup status and safe errors', async () => {
  mocks.rpc.mockResolvedValueOnce({
    data: null,
    error: { code: 'PGRST202', message: 'RAW_DATABASE_SECRET' },
  });
  const r = await GET(new Request('https://app.test/api/integrations/ebay'));
  expect(await r.json()).toMatchObject({ ready: false, connected: false });
  vi.stubEnv('EBAY_CLIENT_SECRET', '');
  const next = await GET(new Request('https://app.test/api/integrations/ebay'));
  expect(await next.json()).toMatchObject({ configured: false });
});
it('requests optional finances only when enabled, respects sync due times and disconnects only the verified actor', async () => {
  vi.stubEnv('EBAY_ENABLE_FINANCES', 'false');
  expect((await POST(request({ action: 'connect', financials: true }))).status).toBe(503);
  expect(mocks.rpc).not.toHaveBeenCalled();
  await POST(request({ action: 'sync', automatic: true }));
  expect(mocks.sync).toHaveBeenCalledWith(ebayActor, false);
  await POST(request({ action: 'sync' }));
  expect(mocks.sync).toHaveBeenCalledWith(ebayActor, true);
  await POST(request({ action: 'disconnect' }));
  expect(
    mocks.rpc.mock.calls.some(([, a]) => a.p_action === 'disconnect' && a.p_user_id === ebayActor),
  ).toBe(true);
});
it('exposes private review only to its session owner and accepts structured corrections rather than source payloads', async () => {
  await GET(new Request('https://app.test/api/integrations/ebay?review=1&userId=foreign'));
  expect(mocks.rpc.mock.calls.find(([, a]) => a.p_action === 'read')?.[1].p_user_id).toBe(
    ebayActor,
  );
  expect(
    (
      await POST(
        request({
          action: 'resolve',
          kind: 'transaction',
          id: 'REFUND:one',
          resolution: { refund: { amount: 1000, feeCredit: 100 } },
        }),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await POST(
        request({
          action: 'resolve',
          kind: 'transaction',
          id: 'REFUND:one',
          resolution: { source: { amount: 0 } },
        }),
      )
    ).status,
  ).toBe(400);
});
it('requires a secret for scheduled sync and uses only server-selected authorized tenants', async () => {
  expect((await cron(new Request('https://app.test/api/integrations/ebay/cron'))).status).toBe(401);
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(
    (
      await cron(
        new Request('https://app.test/api/integrations/ebay/cron', {
          headers: { authorization: 'Bearer ' + 'c'.repeat(40) },
        }),
      )
    ).status,
  ).toBe(200);
  expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_action: 'due', p_user_id: null });
});
