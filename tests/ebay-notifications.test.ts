import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../src/lib/supabase/server', () => ({ adminClient: () => ({ rpc: mocks.rpc }) }));
import { GET, POST } from '../src/app/api/integrations/ebay/notifications/route';
import { deletionChallenge } from '../src/lib/integrations/ebay/notifications';
const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }),
  payload = {
    metadata: { topic: 'MARKETPLACE_ACCOUNT_DELETION' },
    notification: {
      notificationId: 'deletion-1',
      eventDate: '2026-11-10T12:00:00Z',
      data: { userId: 'ebay-account-to-disconnect', username: 'PRIVATE_USERNAME' },
    },
  };
let kid: string;
function signedRequest(data: unknown = payload) {
  const signature = sign('SHA1', Buffer.from(JSON.stringify(payload)), keys.privateKey).toString(
      'base64',
    ),
    header = Buffer.from(JSON.stringify({ kid, signature })).toString('base64');
  return new Request('https://app.test/api/integrations/ebay/notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-ebay-signature': header },
    body: JSON.stringify(data),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  kid = crypto.randomUUID();
  vi.stubEnv('EBAY_CLIENT_ID', 'notifications-test-client');
  vi.stubEnv('EBAY_CLIENT_SECRET', 'private-app-secret');
  vi.stubEnv('EBAY_REDIRECT_URI_NAME', 'runame');
  vi.stubEnv('EBAY_APP_URL', 'https://app.test');
  vi.stubEnv('EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN', 'verification-'.repeat(4));
  mocks.rpc.mockResolvedValue({ data: { accepted: true }, error: null });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) =>
      Response.json(
        String(input).endsWith('/token')
          ? { access_token: 'private-app-token', expires_in: 7200 }
          : {
              key: keys.publicKey.export({ format: 'pem', type: 'spki' }),
              algorithm: 'ECDSA',
              digest: 'SHA1',
            },
      ),
    ),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it('answers the official challenge using the exact configured endpoint and private verification token', async () => {
  vi.stubEnv('EBAY_REDIRECT_URI_NAME', '');
  vi.stubEnv('EBAY_CLIENT_SECRET', '');
  const r = await GET(
    new Request('https://app.test/api/integrations/ebay/notifications?challenge_code=123'),
  );
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({
    challengeResponse: createHash('sha256')
      .update(
        '123' + 'verification-'.repeat(4) + 'https://app.test/api/integrations/ebay/notifications',
      )
      .digest('hex'),
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('verifies the official ECC signature and queues only the immutable eBay ID and event hash for server-side cleanup', async () => {
  const r = await POST(signedRequest());
  expect(r.status).toBe(200);
  expect(mocks.rpc.mock.calls[0]).toEqual([
    'ebay_admin',
    {
      p_action: 'account_deletion',
      p_user_id: null,
      p_data: {
        environment: 'production',
        seller_id: 'ebay-account-to-disconnect',
        event_hash: createHash('sha256').update('deletion-1').digest('hex'),
      },
    },
  ]);
  expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain('PRIVATE_USERNAME');
  await POST(signedRequest());
  expect(
    vi.mocked(fetch).mock.calls.filter(([u]) => String(u).includes('/public_key/')),
  ).toHaveLength(1);
});
it('does not acknowledge or change records for unsigned or tampered payloads', async () => {
  expect(
    (
      await POST(
        new Request('https://app.test/api/integrations/ebay/notifications', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      )
    ).status,
  ).toBe(412);
  expect(fetch).not.toHaveBeenCalled();
  const r = await POST(
    signedRequest({
      ...payload,
      notification: { ...payload.notification, data: { userId: 'victim' } },
    }),
  );
  expect(r.status).toBe(412);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('fails safely when verification cannot be completed and never treats an unknown signature algorithm as verified', async () => {
  vi.mocked(fetch).mockImplementation(async (input) =>
    String(input).endsWith('/token')
      ? Response.json({ access_token: 'token', expires_in: 7200 })
      : Response.json({ key: 'invalid', algorithm: 'RSA', digest: 'SHA256' }),
  );
  expect((await POST(signedRequest())).status).toBe(412);
  expect(mocks.rpc).not.toHaveBeenCalled();
  vi.stubEnv('EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN', '');
  expect(() => deletionChallenge('123')).toThrow('verification token');
});
