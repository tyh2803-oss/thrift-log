import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  configurationStatus,
  readConfiguration,
  secureSessionCookie,
} from '../src/lib/supabase/config';
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  createServer: vi.fn(),
  createAdmin: vi.fn(),
  getAll: vi.fn(),
  set: vi.fn(),
  upload: vi.fn(),
  signedUrl: vi.fn(),
  download: vi.fn(),
  rpc: vi.fn(),
  invite: vi.fn(),
  verifyOtp: vi.fn(),
  updateUser: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: mocks.getAll, set: mocks.set }),
}));
vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.createServer }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createAdmin }));
import { authClient, checkOrigin, requireUser } from '../src/lib/supabase/server';
import { POST as authenticate } from '../src/app/api/auth/route';
import { GET as workspaceGet } from '../src/app/api/workspace/route';
import { POST as saveWorkspace } from '../src/app/api/workspace/route';
import { GET as listBeta, POST as manageBeta } from '../src/app/api/beta/route';
import { GET as confirmInvite } from '../src/app/auth/confirm/route';
import {
  GET as assistantConfig,
  POST as extractAssistant,
} from '../src/app/api/assistant/extract/route';
import { POST as approveAssistant } from '../src/app/api/assistant/approve/route';
import { emptyWorkspace, itemSchema } from '../src/lib/model';
import { browserScope, clearPrivateBrowserState } from '../src/lib/browser-scope';
import { GET as photo, POST as uploadPhoto } from '../src/app/api/photos/route';
import { proxy } from '../src/proxy';
const owner = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'owner@example.test',
  email_confirmed_at: '2026-11-01T12:00:00Z',
};
const workspace = () => workspaceGet(new Request('https://thrift.example/api/workspace'));
const env = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-public-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-server-key',
  OWNER_EMAIL: owner.email,
};
beforeEach(() => {
  vi.clearAllMocks();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  mocks.getAll.mockReturnValue([]);
  mocks.getUser.mockResolvedValue({ data: { user: owner }, error: null });
  mocks.signIn.mockResolvedValue({ data: { user: owner }, error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.createServer.mockReturnValue({
    auth: {
      getUser: mocks.getUser,
      signInWithPassword: mocks.signIn,
      signOut: mocks.signOut,
      verifyOtp: mocks.verifyOtp,
      updateUser: mocks.updateUser,
    },
  });
  mocks.createAdmin.mockReturnValue({
    rpc: mocks.rpc,
    auth: { admin: { inviteUserByEmail: mocks.invite } },
    storage: {
      from: () => ({
        upload: mocks.upload,
        createSignedUrl: mocks.signedUrl,
        download: mocks.download,
      }),
    },
  });
  mocks.rpc.mockImplementation(async (name: string) => ({
    data:
      name === 'beta_check_access'
        ? 'owner'
        : name === 'verify_thrift_log'
          ? {
              schemaVersion: 6,
              inviteOnlyBeta: true,
              itemFulfillment: true,
              tablesPresent: true,
              rlsEnabled: true,
              clientWritesBlocked: true,
              privatePhotosBucket: true,
              serverRpcRestricted: true,
              privatePhotoReadPolicy: true,
              financialLedger: true,
              shipmentStorage: true,
            }
          : null,
    error: null,
  }));
  mocks.upload.mockResolvedValue({ error: null });
  mocks.invite.mockResolvedValue({ data: {}, error: null });
  mocks.verifyOtp.mockResolvedValue({ data: { user: owner }, error: null });
  mocks.updateUser.mockResolvedValue({ error: null });
  mocks.download.mockResolvedValue({
    data: new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }),
    error: null,
  });
  mocks.signedUrl.mockResolvedValue({
    data: {
      signedUrl:
        'https://project.supabase.co/storage/v1/object/sign/inventory-photos/example?token=test',
    },
    error: null,
  });
});
afterEach(() => vi.unstubAllEnvs());
describe('Supabase configuration', () => {
  it('validates browser origin against Host when Next reconstructs an internal URL', () => {
    const request = (origin: string, forwarded = '') =>
      new Request('http://localhost:3100/api/photos', {
        method: 'POST',
        headers: { Host: '127.0.0.1:3100', Origin: origin, 'X-Forwarded-Host': forwarded },
      });
    expect(() => checkOrigin(request('http://127.0.0.1:3100'))).not.toThrow();
    expect(() => checkOrigin(request('http://localhost:3100'))).toThrow('Invalid request origin');
    expect(() => checkOrigin(request('https://evil.example', 'evil.example'))).toThrow(
      'Invalid request origin',
    );
    expect(() =>
      checkOrigin(
        new Request('https://thrift.example/api/photos', { headers: { Host: 'thrift.example' } }),
      ),
    ).toThrow('Invalid request origin');
  });
  it('requires an owner as well as runtime credentials', () => {
    expect(configurationStatus({ ...env, OWNER_EMAIL: '' }).ready).toBe(false);
    expect(configurationStatus(env).ready).toBe(true);
    expect(configurationStatus({}).present).toBe(false);
  });
  it('rejects MCP URLs, insecure external HTTP, and embedded credentials', () => {
    for (const url of [
      'https://mcp.supabase.com/mcp?project_ref=example',
      'http://project.supabase.co',
      'https://user:password@project.supabase.co',
    ])
      expect(configurationStatus({ ...env, NEXT_PUBLIC_SUPABASE_URL: url }).ready).toBe(false);
    expect(
      readConfiguration({ ...env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' }).url,
    ).toBe('http://127.0.0.1:54321');
  });
});
describe('private authentication and session lifecycle', () => {
  it('lets Supabase validate existing account passwords without a new length policy', async () => {
    const request = new Request('https://thrift.example/api/auth', {
      method: 'POST',
      headers: { Origin: 'https://thrift.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'signin', email: owner.email, password: 'sixchr' }),
    });
    expect((await authenticate(request)).status).toBe(200);
    expect(mocks.signIn).toHaveBeenCalledWith({ email: owner.email, password: 'sixchr' });
  });
  it('uses local HTTP cookies on loopback and secure cookies for HTTPS and remote hosts', async () => {
    for (const host of ['localhost:3100', '127.0.0.1:3100', '[::1]:3100']) {
      const request = new Request('http://localhost:3100/api/auth', { headers: { Host: host } });
      expect(secureSessionCookie(request)).toBe(false);
      await authClient({ writableCookies: true, request });
      expect(mocks.createServer.mock.calls.at(-1)![2].cookieOptions).toMatchObject({
        secure: false,
        httpOnly: true,
        sameSite: 'lax',
      });
      await proxy(
        new NextRequest('http://localhost:3100/api/workspace', { headers: { Host: host } }),
      );
      expect(mocks.createServer.mock.calls.at(-1)![2].cookieOptions.secure).toBe(false);
    }
    for (const [url, host] of [
      ['https://localhost:3100/api/auth', 'localhost:3100'],
      ['https://thrift.example/api/auth', 'thrift.example'],
      ['http://localhost:3100/api/auth', 'thrift.example'],
    ])
      expect(
        secureSessionCookie(
          new Request(url, { headers: { Host: host, 'X-Forwarded-Host': 'localhost' } }),
        ),
      ).toBe(true);
  });
  it('authorizes the configured owner and rejects other authenticated accounts', async () => {
    expect((await requireUser()).id).toBe(owner.id);
    mocks.getUser.mockResolvedValue({
      data: { user: { ...owner, email: 'other@example.test' } },
      error: null,
    });
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(requireUser()).rejects.toThrow('Unauthorized');
  });
  it('keeps Server Component clients read-only and route cookies HttpOnly', async () => {
    await authClient();
    let options = mocks.createServer.mock.calls.at(-1)![2];
    expect(options.cookies.setAll).toBeUndefined();
    await authClient({ writableCookies: true });
    options = mocks.createServer.mock.calls.at(-1)![2];
    expect(options.cookieOptions).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
    options.cookies.setAll([
      { name: 'session', value: 'test-session', options: { httpOnly: true } },
    ]);
    expect(mocks.set).toHaveBeenCalledWith('session', 'test-session', { httpOnly: true });
  });
  it('refreshes both request and response cookies before page rendering', async () => {
    mocks.getUser.mockImplementation(async () => {
      const options = mocks.createServer.mock.calls.at(-1)![2];
      options.cookies.setAll([
        {
          name: 'session',
          value: 'refreshed-test-session',
          options: { httpOnly: true, sameSite: 'lax', path: '/' },
        },
      ]);
      return { data: { user: owner }, error: null };
    });
    const request = new NextRequest('https://thrift.example/inventory');
    const response = await proxy(request);
    expect(request.cookies.get('session')?.value).toBe('refreshed-test-session');
    expect(response.cookies.get('session')?.value).toBe('refreshed-test-session');
    expect(response.cookies.get('session')?.httpOnly).toBe(true);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('clears an authenticated session when the account is not approved', async () => {
    mocks.signIn.mockResolvedValue({
      data: {
        user: { ...owner, id: '22222222-2222-4222-8222-222222222222', email: 'other@example.test' },
      },
      error: null,
    });
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const request = new Request('https://thrift.example/api/auth', {
      method: 'POST',
      headers: { Origin: 'https://thrift.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'signin',
        email: 'other@example.test',
        password: 'test-password',
      }),
    });
    expect((await authenticate(request)).status).toBe(400);
    expect(mocks.signIn).toHaveBeenCalledOnce();
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
  it('blocks cross-origin auth and protects the workspace when a session expires', async () => {
    const request = new Request('https://thrift.example/api/auth', {
      method: 'POST',
      headers: { Origin: 'https://evil.example' },
      body: '{}',
    });
    expect((await authenticate(request)).status).toBe(400);
    expect(mocks.createServer).not.toHaveBeenCalled();
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'expired' } });
    expect((await workspace()).status).toBe(401);
    expect(mocks.createAdmin).not.toHaveBeenCalled();
  });
  it('returns service unavailable without exposing credentials when configuration is incomplete', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const response = await workspace();
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('test-public-key');
  });
});
describe('private inventory photos', () => {
  it('rejects another owner’s object before requesting a signed URL', async () => {
    const response = await photo(
      new Request('https://thrift.example/api/photos?path=other/test.png'),
    );
    expect(response.status).toBe(404);
    expect(mocks.signedUrl).not.toHaveBeenCalled();
  });
  it('proxies an authenticated private photo without issuing a bearer URL and prevents caching', async () => {
    const path = `${owner.id}/test.png`;
    const response = await photo(new Request(`https://thrift.example/api/photos?path=${path}`));
    expect(response.status).toBe(200);
    expect(mocks.download).toHaveBeenCalledWith(path);
    expect(mocks.signedUrl).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it('validates actual bytes and never uploads SVG/script content', async () => {
    const form = new FormData();
    form.set('file', new File(['<svg onload="alert(1)"/>'], 'pretend.png', { type: 'image/png' }));
    const response = await uploadPhoto(
      new Request('https://thrift.example/api/photos', {
        method: 'POST',
        headers: { Origin: 'https://thrift.example' },
        body: form,
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('uploads valid photo bytes to a unique owner-scoped private path', async () => {
    const form = new FormData();
    form.set(
      'file',
      new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'test.png', {
        type: 'image/png',
      }),
    );
    const response = await uploadPhoto(
      new Request('https://thrift.example/api/photos', {
        method: 'POST',
        headers: { Origin: 'https://thrift.example' },
        body: form,
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.path).toMatch(new RegExp(`^${owner.id}/[0-9a-f-]+\\.png$`));
    expect(mocks.upload.mock.calls[0][2]).toMatchObject({
      contentType: 'image/png',
      upsert: false,
    });
  });
});

it('refuses an old database schema instead of pretending to save new ledger records', async () => {
  mocks.rpc.mockImplementation(async (name: string) => ({
    data: name === 'beta_check_access' ? 'owner' : { schemaVersion: 2 },
    error: null,
  }));
  const response = await workspace();
  expect(response.status).toBe(503);
  expect((await response.json()).error).toContain('202611110001');
  expect(mocks.rpc.mock.calls.map((args) => args[0])).toEqual([
    'beta_check_access',
    'verify_thrift_log',
  ]);
});

describe('native sign-in fallback', () => {
  const formRequest = (origin = 'http://127.0.0.1:3100', password = 'synthetic-password') =>
    new Request('http://localhost:3100/api/auth', {
      method: 'POST',
      headers: {
        Host: '127.0.0.1:3100',
        Origin: origin,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ action: 'signin', email: ` ${owner.email} `, password }),
    });
  it('accepts a normal POST and redirects to session verification without credentials in the URL', async () => {
    const response = await authenticate(formRequest());
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://127.0.0.1:3100/login?verify=1');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(mocks.signIn).toHaveBeenCalledWith({
      email: owner.email,
      password: 'synthetic-password',
    });
  });
  it('shows a fixed error destination and never echoes rejected passwords', async () => {
    mocks.signIn.mockResolvedValue({ error: { message: 'Provider rejected synthetic-password' } });
    const response = await authenticate(formRequest());
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://127.0.0.1:3100/login?error=signin');
    expect(await response.text()).not.toContain('synthetic-password');
  });
  it('does not weaken origin checks for native forms', async () => {
    const response = await authenticate(formRequest('https://evil.example'));
    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
    expect(mocks.signIn).not.toHaveBeenCalled();
  });
});

describe('private Wi-Fi development cookies', () => {
  const request = (host: string, protocol = 'http:') =>
    new Request(`${protocol}//localhost:3000/api/auth`, { headers: { Host: `${host}:3000` } });
  it('permits HTTP cookies for RFC1918 IPv4 hosts only in development', async () => {
    for (const mode of ['development', 'production', 'test']) {
      vi.stubEnv('NODE_ENV', mode);
      for (const host of ['192.168.18.125', '10.0.0.8', '172.16.0.1', '172.31.255.254']) {
        const secure = mode !== 'development';
        expect(secureSessionCookie(request(host))).toBe(secure);
        expect(secureSessionCookie(request(host, 'https:'))).toBe(true);
        await authClient({ writableCookies: true, request: request(host) });
        const options = mocks.createServer.mock.calls.at(-1)![2].cookieOptions;
        expect(options).toMatchObject({ secure, httpOnly: true, sameSite: 'lax', path: '/' });
        expect(options.domain).toBeUndefined();
        await proxy(
          new NextRequest('http://localhost:3000/api/workspace', {
            headers: { Host: `${host}:3000` },
          }),
        );
        expect(mocks.createServer.mock.calls.at(-1)![2].cookieOptions).toMatchObject({
          secure,
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
        });
      }
    }
  });
  it('keeps Secure on public hosts and ignores spoofed forwarding headers', () => {
    vi.stubEnv('NODE_ENV', 'development');
    for (const host of [
      'thrift.example',
      '8.8.8.8',
      '172.15.0.1',
      '172.32.0.1',
      '192.167.18.125',
      '169.254.1.2',
      '192.168.18.125.evil.example',
    ]) {
      expect(secureSessionCookie(request(host))).toBe(true);
      expect(
        secureSessionCookie(
          new Request('http://localhost:3000/api/auth', {
            headers: {
              Host: `${host}:3000`,
              'X-Forwarded-Host': '192.168.18.125:3000',
              'X-Forwarded-Proto': 'http',
            },
          }),
        ),
      ).toBe(true);
    }
  });
  it('retains exact same-origin CSRF enforcement on LAN requests', () => {
    vi.stubEnv('NODE_ENV', 'development');
    for (const origin of [
      'http://192.168.18.125:3000',
      'http://192.168.18.126:3000',
      'http://192.168.18.125:3001',
      'https://evil.example',
    ]) {
      const r = new Request('http://localhost:3000/api/auth', {
        headers: { Host: '192.168.18.125:3000', Origin: origin },
      });
      if (origin === 'http://192.168.18.125:3000') expect(() => checkOrigin(r)).not.toThrow();
      else expect(() => checkOrigin(r)).toThrow('Invalid request origin');
    }
  });
});

const tester = {
  ...owner,
  id: '22222222-2222-4222-8222-222222222222',
  email: 'tester@example.test',
};
function post(path: string, body: unknown, userId?: string) {
  return new Request(`https://thrift.example${path}`, {
    method: 'POST',
    headers: {
      Origin: 'https://thrift.example',
      'Content-Type': 'application/json',
      ...(userId ? { 'x-thrift-user': userId } : {}),
    },
    body: JSON.stringify(body),
  });
}
function asTester() {
  mocks.getUser.mockResolvedValue({ data: { user: tester }, error: null });
  mocks.signIn.mockResolvedValue({ data: { user: tester }, error: null });
  const base = mocks.rpc.getMockImplementation()!;
  mocks.rpc.mockImplementation(async (name: string, args: unknown) =>
    name === 'beta_check_access' ? { data: 'tester', error: null } : base(name, args),
  );
}
describe('invite-only beta authorization', () => {
  it('rejects encoded traversal and nested photo paths before the storage SDK can normalize them', async () => {
    const other = '22222222-2222-4222-8222-222222222222';
    for (const suffix of [
      `../${other}/test.png`,
      `%2e%2e/${other}/test.png`,
      `%252e%252e%252f${other}/test.png`,
      `nested/test.png`,
      `test.png?path=${other}/test.png`,
    ]) {
      const path = `${owner.id}/${suffix}`;
      const response = await photo(
        new Request(`https://thrift.example/api/photos?path=${encodeURIComponent(path)}`),
      );
      expect(response.status).toBe(404);
    }
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.signedUrl).not.toHaveBeenCalled();
  });
  it('keeps invitation setup-error redirects on the browser host rather than Next’s internal hostname', async () => {
    vi.stubEnv('BETA_SITE_URL', '');
    const response = await confirmInvite(
      new Request('http://localhost:3150/auth/confirm?token_hash=invalid&type=invite', {
        headers: { Host: '127.0.0.1:3150' },
      }),
    );
    expect(response.headers.get('location')).toBe('http://127.0.0.1:3150/login?error=invite');
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });
  it('accepts an approved tester’s own verified Auth account and never elevates it to owner', async () => {
    asTester();
    expect(
      (
        await authenticate(
          post('/api/auth', {
            action: 'signin',
            email: tester.email,
            password: 'own-test-password',
          }),
        )
      ).status,
    ).toBe(200);
    expect((await requireUser()).id).toBe(tester.id);
    expect((await listBeta()).status).toBe(403);
    expect(
      (await manageBeta(post('/api/beta', { action: 'authorize', email: 'stranger@example.test' })))
        .status,
    ).toBe(403);
    expect(mocks.rpc.mock.calls.filter((c) => c[0] === 'beta_manage_access')).toHaveLength(0);
  });
  it('rejects an unverified email or mismatched browser account before accessing business data', async () => {
    mocks.getUser.mockResolvedValueOnce({
      data: { user: { ...tester, email_confirmed_at: null } },
      error: null,
    });
    await expect(requireUser()).rejects.toThrow('Unauthorized');
    expect(mocks.rpc).not.toHaveBeenCalled();
    asTester();
    const response = await workspaceGet(
      new Request('https://thrift.example/api/workspace', {
        headers: { 'x-thrift-user': owner.id },
      }),
    );
    expect(response.status).toBe(401);
    expect(mocks.rpc.mock.calls.filter((c) => c[0] === 'load_workspace')).toHaveLength(0);
  });
  it('ignores forged user parameters and commits only to the authenticated tester’s workspace', async () => {
    asTester();
    const base = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (name: string, args: unknown) =>
      name === 'load_workspace'
        ? { data: emptyWorkspace(), error: null }
        : name === 'commit_workspace'
          ? { data: 1, error: null }
          : base(name, args),
    );
    expect(
      (await workspaceGet(new Request(`https://thrift.example/api/workspace?user_id=${owner.id}`)))
        .status,
    ).toBe(200);
    const item = itemSchema.parse({
      id: crypto.randomUUID(),
      sku: 'TESTER-ONLY',
      status: 'Purchased',
      title: 'Tester find',
      cost: 500,
      asking: 2000,
      purchasedAt: '2026-11-01T12:00:00Z',
      createdAt: '2026-11-01T12:00:00Z',
    });
    const response = await saveWorkspace(
      post(
        '/api/workspace',
        {
          user_id: owner.id,
          revision: 0,
          commands: [{ type: 'item', value: { ...item, user_id: owner.id } }],
        },
        tester.id,
      ),
    );
    expect(response.status).toBe(200);
    const calls = mocks.rpc.mock.calls.filter((c) => c[0] === 'commit_workspace');
    expect(calls).toHaveLength(1);
    expect(calls[0][1].p_user_id).toBe(tester.id);
    expect(
      mocks.rpc.mock.calls
        .filter((c) => c[0] === 'load_workspace')
        .every((c) => c[1].p_user_id === tester.id),
    ).toBe(true);
    expect(calls[0][1].p_payload.items[0].user_id).toBeUndefined();
  });
  it('does not resolve a listing’s foreign item ID from another user’s workspace or accept another user’s photo path', async () => {
    asTester();
    const base = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (name: string, args: unknown) =>
      name === 'load_workspace' ? { data: emptyWorkspace(), error: null } : base(name, args),
    );
    const { listingSchema } = await import('../src/lib/model');
    const listing = listingSchema.parse({
      id: crypto.randomUUID(),
      itemId: crypto.randomUUID(),
      marketplace: 'Vinted',
      price: 2000,
      originalPrice: 2000,
      listedAt: '2026-11-01T12:00:00Z',
      status: 'Active',
    });
    expect(
      (
        await saveWorkspace(
          post(
            '/api/workspace',
            { revision: 0, commands: [{ type: 'listing', value: listing }] },
            tester.id,
          ),
        )
      ).status,
    ).toBe(400);
    const item = itemSchema.parse({
      id: crypto.randomUUID(),
      sku: 'BAD-PHOTO',
      status: 'Purchased',
      title: 'Find',
      cost: 500,
      asking: 2000,
      purchasedAt: '2026-11-01T12:00:00Z',
      createdAt: '2026-11-01T12:00:00Z',
      photos: [`${owner.id}/${crypto.randomUUID()}.png`],
    });
    expect(
      (
        await saveWorkspace(
          post(
            '/api/workspace',
            { revision: 0, commands: [{ type: 'item', value: item }] },
            tester.id,
          ),
        )
      ).status,
    ).toBe(400);
    expect(mocks.rpc.mock.calls.filter((c) => c[0] === 'commit_workspace')).toHaveLength(0);
    expect(
      (await photo(new Request(`https://thrift.example/api/photos?path=${owner.id}/test.png`)))
        .status,
    ).toBe(404);
    expect(mocks.download).not.toHaveBeenCalled();
    expect(
      (await photo(new Request(`https://thrift.example/api/photos?path=${tester.id}/test.png`)))
        .status,
    ).toBe(200);
    expect(mocks.download).toHaveBeenCalledWith(`${tester.id}/test.png`);
  });
  it('denies revoked accounts across every business, assistant and photo API despite a valid Auth session', async () => {
    asTester();
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const responses = await Promise.all([
      workspaceGet(new Request('https://thrift.example/api/workspace')),
      saveWorkspace(post('/api/workspace', {})),
      photo(new Request(`https://thrift.example/api/photos?path=${tester.id}/test.png`)),
      uploadPhoto(post('/api/photos', {})),
      assistantConfig(),
      extractAssistant(post('/api/assistant/extract', {})),
      approveAssistant(post('/api/assistant/approve', {})),
      manageBeta(post('/api/beta', { action: 'authorize', email: 'hacker@example.test' })),
    ]);
    expect(responses.every((r) => r.status >= 400)).toBe(true);
    expect(mocks.rpc.mock.calls.every((c) => c[0] === 'beta_check_access')).toBe(true);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.invite).not.toHaveBeenCalled();
  });
  it('allows the owner to authorize and revoke emails without accepting a forged actor ID', async () => {
    const base = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (name: string, args: unknown) =>
      name === 'beta_manage_access'
        ? { data: [{ email: tester.email, active: false, linked: true }], error: null }
        : base(name, args),
    );
    const r = await manageBeta(
      post('/api/beta', { action: 'revoke', email: ' TESTER@example.test ', actor: tester.id }),
    );
    expect(r.status).toBe(200);
    expect((await r.json()).message).toContain('records are retained');
    expect(mocks.rpc.mock.calls.find((c) => c[0] === 'beta_manage_access')![1]).toEqual({
      p_actor_id: owner.id,
      p_email: tester.email,
      p_active: false,
    });
    expect(
      (await manageBeta(post('/api/beta', { action: 'revoke', email: owner.email }))).status,
    ).toBe(400);
    expect(
      (
        await manageBeta(
          new Request('https://thrift.example/api/beta', {
            method: 'POST',
            headers: { Origin: 'https://evil.test' },
            body: '{}',
          }),
        )
      ).status,
    ).toBe(400);
  });
  it('sends invitations only for already authorized emails, to a fixed approved redirect, and reports mail failure honestly', async () => {
    vi.stubEnv('BETA_SITE_URL', 'https://thrift.example');
    const base = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (name: string, args: unknown) =>
      name === 'beta_manage_access'
        ? { data: [{ email: tester.email, active: true, linked: false }], error: null }
        : base(name, args),
    );
    expect(
      (await manageBeta(post('/api/beta', { action: 'invite', email: 'unknown@example.test' })))
        .status,
    ).toBe(400);
    expect(mocks.invite).not.toHaveBeenCalled();
    expect(
      (
        await manageBeta(
          post('/api/beta', {
            action: 'invite',
            email: tester.email,
            redirectTo: 'https://evil.test',
          }),
        )
      ).status,
    ).toBe(200);
    expect(mocks.invite).toHaveBeenCalledWith(tester.email, {
      redirectTo: 'https://thrift.example/auth/confirm',
    });
    mocks.invite.mockResolvedValue({ error: { message: 'provider secret' } });
    const r = await manageBeta(post('/api/beta', { action: 'invite', email: tester.email }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).not.toContain('provider secret');
    vi.stubEnv('BETA_SITE_URL', 'https://evil.test/path');
    expect(
      (await manageBeta(post('/api/beta', { action: 'invite', email: tester.email }))).status,
    ).toBe(400);
  });
  it('verifies invitation OTPs server-side, requires live membership, and never redirects to untrusted next parameters', async () => {
    vi.stubEnv('BETA_SITE_URL', 'https://thrift.example');
    asTester();
    mocks.verifyOtp.mockResolvedValue({ data: { user: tester }, error: null });
    let r = await confirmInvite(
      new Request(
        'https://thrift.example/auth/confirm?token_hash=test-hash&type=invite&next=https://evil.test',
      ),
    );
    expect(r.headers.get('location')).toBe('https://thrift.example/set-password');
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ token_hash: 'test-hash', type: 'invite' });
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    r = await confirmInvite(
      new Request('https://thrift.example/auth/confirm?token_hash=test-hash&type=invite'),
    );
    expect(r.headers.get('location')).toBe('https://thrift.example/login?error=invite');
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    mocks.verifyOtp.mockClear();
    await confirmInvite(
      new Request('https://thrift.example/auth/confirm?token_hash=test-hash&type=email_change'),
    );
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });
  it('requires a valid signup OTP and current beta membership before opening the workspace', async () => {
    vi.stubEnv('BETA_SITE_URL', 'https://thrift.example');
    asTester();
    mocks.verifyOtp.mockResolvedValue({ data: { user: tester }, error: null });
    const request = () =>
      new Request(
        'https://thrift.example/auth/confirm?token_hash=test-hash&type=signup&next=https://evil.test',
      );
    expect((await confirmInvite(request())).headers.get('location')).toBe(
      'https://thrift.example/',
    );
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect((await confirmInvite(request())).headers.get('location')).toBe(
      'https://thrift.example/login?error=invite',
    );
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
  it.each([
    ['Abc1234', 400],
    ['Abc12345', 200],
    ['Abc123456', 200],
    ['x'.repeat(129), 400],
  ])(
    'validates new-password length without changing authorization: %s',
    async (password, status) => {
      asTester();
      const response = await authenticate(
        post('/api/auth', { action: 'password', password }, tester.id),
      );
      expect(response.status).toBe(status);
      if (status === 400) {
        expect(mocks.updateUser).not.toHaveBeenCalled();
        expect((await response.json()).error).toContain('between 8 and 128 characters');
      } else expect(mocks.updateUser).toHaveBeenCalledWith({ password });
    },
  );
  it('sets only an approved account’s own password and exposes no public registration action', async () => {
    asTester();
    expect(
      (
        await authenticate(
          post(
            '/api/auth',
            { action: 'password', password: 'my-unique-strong-password', userId: owner.id },
            tester.id,
          ),
        )
      ).status,
    ).toBe(200);
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: 'my-unique-strong-password' });
    mocks.updateUser.mockClear();
    expect(
      (await authenticate(post('/api/auth', { action: 'password', password: 'short' }, tester.id)))
        .status,
    ).toBe(400);
    expect(
      (
        await authenticate(
          post('/api/auth', { action: 'signup', email: tester.email, password: 'password' }),
        )
      ).status,
    ).toBe(400);
    expect(mocks.updateUser).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect(
      (
        await authenticate(
          post(
            '/api/auth',
            { action: 'password', password: 'my-unique-strong-password' },
            tester.id,
          ),
        )
      ).status,
    ).toBe(400);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
  it('namespaces private drafts by immutable Auth UUID and clears legacy/account drafts while preserving the demo', () => {
    expect(browserScope(false, owner.id)).not.toBe(browserScope(false, tester.id));
    expect(browserScope(true, owner.id)).toBe('demo');
    const data: Record<string, string> = {
      'thrift-log.draft.assistant.owner@example.test': 'private',
      'thrift-log.draft.assistant.private': 'legacy',
      [`thrift-log.draft.assistant.private.${owner.id}`]: 'owner',
      [`thrift-log.draft.private.${tester.id}.item.new`]: 'tester',
      'thrift-log.draft.assistant.demo': 'demo',
      'thrift-log.draft.demo.item.new': 'demo',
      'thrift-log.draft.pipeline-metric.demo': 'cost',
      'thrift-log.marketplace.private': 'Depop',
      unrelated: 'keep',
    };
    const storage = new Proxy(data, {
      get(target, key) {
        if (key === 'removeItem') return (name: string) => delete target[name];
        return target[String(key)];
      },
    }) as unknown as Storage;
    clearPrivateBrowserState(storage);
    expect(Object.keys(data).sort()).toEqual([
      'thrift-log.draft.assistant.demo',
      'thrift-log.draft.demo.item.new',
      'thrift-log.draft.pipeline-metric.demo',
      'unrelated',
    ]);
  });
});
