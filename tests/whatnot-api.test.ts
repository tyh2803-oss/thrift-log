import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  origin: vi.fn(),
  rpc: vi.fn(),
  sync: vi.fn(),
  background: vi.fn(),
  after: vi.fn(),
}));
vi.mock('../src/lib/supabase/server', () => ({
  requireUser: mocks.user,
  checkOrigin: mocks.origin,
  adminClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock('../src/lib/integrations/whatnot/sync', () => ({
  runSync: mocks.sync,
  backgroundSync: mocks.background,
}));
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: mocks.after,
}));
import { GET, POST } from '../src/app/api/integrations/whatnot/route';
import { GET as cron } from '../src/app/api/integrations/whatnot/cron/route';
import { POST as webhook } from '../src/app/api/integrations/whatnot/webhook/[endpoint]/route';
import { seal, unseal } from '../src/lib/integrations/whatnot/crypto';
import { actor, sellerId } from './helpers/whatnot';
const token = 'wn_pat_tk_test_credential_not_real';
const status = {
  ready: true,
  connected: true,
  username: 'synthetic-seller',
  status: 'synced',
  pending: 0,
  hasMore: false,
};
function request(data: unknown) {
  return new Request('https://app.test/api/integrations/whatnot', {
    method: 'POST',
    headers: { origin: 'https://app.test', 'x-thrift-user': actor },
    body: JSON.stringify(data),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fake-whatnot-api-test-server-key');
  vi.stubEnv('CRON_SECRET', 'c'.repeat(40));
  mocks.user.mockResolvedValue({ id: actor });
  mocks.origin.mockReturnValue(undefined);
  mocks.sync.mockResolvedValue({ changed: false, hasMore: false });
  mocks.rpc.mockImplementation(async (_name, args) => ({
    data: args.p_action === 'status' ? status : args.p_action === 'read' ? [] : { saved: true },
    error: null,
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) => {
      const url = new URL(input as string);
      return Response.json(
        url.pathname.endsWith('/users/me')
          ? { id: sellerId, username: 'synthetic-seller', seller_currency: 'USD', buyer: 'PRIVATE' }
          : { data: [], next_cursor: null },
      );
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it('connects only the verified actor, probes four read capabilities, encrypts the PAT, and never returns credentials or asks Whatnot to mutate anything', async () => {
  const response = await POST(request({ action: 'connect', token, userId: crypto.randomUUID() }));
  expect(response.status).toBe(200);
  const call = mocks.rpc.mock.calls.find(([, args]) => args.p_action === 'connect')![1];
  expect(call.p_user_id).toBe(actor);
  expect(call.p_data.token_ciphertext).not.toContain(token);
  expect(unseal(actor, call.p_data.token_ciphertext)).toBe(token);
  expect(JSON.stringify(await response.json())).not.toMatch(/ciphertext|wn_pat_tk/);
  expect(mocks.after).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(5);
  for (const [, options] of vi.mocked(fetch).mock.calls) expect(options?.method).toBe('GET');
});
it('rejects unauthenticated and cross-origin actions before reading credentials or calling Whatnot', async () => {
  mocks.user.mockRejectedValueOnce(new Error('Unauthorized'));
  expect((await POST(request({ action: 'connect', token }))).status).toBe(401);
  mocks.origin.mockImplementationOnce(() => {
    throw new Error('Invalid request origin');
  });
  expect((await POST(request({ action: 'connect', token }))).status).toBe(403);
  expect(fetch).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('handles invalid, expired, foreign-currency and insufficient-scope credentials without storing a failed connection', async () => {
  expect((await POST(request({ action: 'connect', token: 'wrong-prefix' }))).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
  for (const code of [401, 403]) {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ private: token }, { status: code }));
    const response = await POST(request({ action: 'connect', token }));
    expect(response.status).toBe(code);
    expect(JSON.stringify(await response.json())).not.toContain(token);
  }
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ id: sellerId, username: 'seller', seller_currency: 'GBP' }),
  );
  expect((await POST(request({ action: 'connect', token }))).status).toBe(400);
  expect(mocks.rpc.mock.calls.some(([, args]) => args.p_action === 'connect')).toBe(false);
});
it('keeps setup optional on an unmigrated production database and returns no misleading connected state', async () => {
  mocks.rpc.mockResolvedValueOnce({
    data: null,
    error: { code: 'PGRST202', message: 'Function not found' },
  });
  const response = await GET(new Request('https://app.test/api/integrations/whatnot'));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ready: false, connected: false });
});
it('disconnects only the actor, and automatic polling respects due times instead of forcing another full scan', async () => {
  expect((await POST(request({ action: 'disconnect', userId: crypto.randomUUID() }))).status).toBe(
    200,
  );
  expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_action: 'disconnect', p_user_id: actor });
  expect(fetch).not.toHaveBeenCalled();
  expect((await POST(request({ action: 'sync', automatic: true }))).status).toBe(200);
  expect(mocks.sync).toHaveBeenLastCalledWith(actor, false);
  await POST(request({ action: 'sync' }));
  expect(mocks.sync).toHaveBeenLastCalledWith(actor, true);
});
it('permits only secret-authenticated scheduling and processes only the database-selected active tenants', async () => {
  expect((await cron(new Request('https://app.test/api/integrations/whatnot/cron'))).status).toBe(
    401,
  );
  expect(mocks.rpc).not.toHaveBeenCalled();
  vi.stubEnv('CRON_SECRET', '');
  expect((await cron(new Request('https://app.test/api/integrations/whatnot/cron'))).status).toBe(
    503,
  );
  vi.stubEnv('CRON_SECRET', 'c'.repeat(40));
  mocks.rpc.mockResolvedValueOnce({ data: [actor], error: null });
  const response = await cron(
    new Request('https://app.test/api/integrations/whatnot/cron?userId=foreign', {
      headers: { authorization: 'Bearer ' + 'c'.repeat(40) },
    }),
  );
  expect(response.status).toBe(200);
  expect(mocks.sync).toHaveBeenCalledWith(actor);
  expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_action: 'due', p_user_id: null });
});
it('accepts only a signed raw-body webhook for its own seller and deduplicates before scheduling processing', async () => {
  const endpoint = crypto.randomUUID(),
    secret = 'wn_wh_' + Buffer.alloc(32, 7).toString('base64'),
    version = crypto.randomUUID(),
    timestamp = String(Math.floor(Date.now() / 1000)),
    id = 'event-test';
  const payload = JSON.stringify({
    type: 'orders.created',
    timestamp: new Date().toISOString(),
    seller_id: sellerId,
    version: 'v2',
    data: { order_id: '123456' },
  });
  const signed = (body: string, seller = sellerId) => {
    const actual = seller === sellerId ? body : body.replace(sellerId, seller);
    return new Request(`https://app.test/api/integrations/whatnot/webhook/${endpoint}`, {
      method: 'POST',
      body: actual,
      headers: {
        'webhook-id': id,
        'webhook-timestamp': timestamp,
        'webhook-signature':
          'v1,' +
          createHmac('sha256', Buffer.alloc(32, 7))
            .update(`${id}.${timestamp}.${actual}`)
            .digest('base64'),
      },
    });
  };
  mocks.rpc.mockImplementation(async (_name, args) => ({
    data:
      args.p_action === 'webhook_connection'
        ? {
            user_id: actor,
            seller_id: sellerId,
            webhook_ciphertext: seal(actor, secret, 'webhook'),
            version,
          }
        : args.p_action === 'enqueue'
          ? { accepted: true }
          : status,
    error: null,
  }));
  expect((await webhook(signed(payload), { params: Promise.resolve({ endpoint }) })).status).toBe(
    200,
  );
  expect(mocks.after).toHaveBeenCalledTimes(1);
  expect(mocks.rpc.mock.calls.find(([, a]) => a.p_action === 'enqueue')![1].p_user_id).toBe(actor);
  const calls = mocks.rpc.mock.calls.length;
  expect(
    (await webhook(signed(payload, '9876543'), { params: Promise.resolve({ endpoint }) })).status,
  ).toBe(400);
  expect(mocks.rpc.mock.calls.slice(calls).some(([, a]) => a.p_action === 'enqueue')).toBe(false);
  mocks.rpc.mockImplementation(async (_name, args) => ({
    data:
      args.p_action === 'webhook_connection'
        ? {
            user_id: actor,
            seller_id: sellerId,
            webhook_ciphertext: seal(actor, secret, 'webhook'),
            version,
          }
        : { accepted: false },
    error: null,
  }));
  await webhook(signed(payload), { params: Promise.resolve({ endpoint }) });
  expect(mocks.after).toHaveBeenCalledTimes(1);
  const altered = signed(payload);
  const headers = new Headers(altered.headers);
  expect(
    (
      await webhook(new Request(altered.url, { method: 'POST', headers, body: payload + ' ' }), {
        params: Promise.resolve({ endpoint }),
      })
    ).status,
  ).toBe(400);
});
