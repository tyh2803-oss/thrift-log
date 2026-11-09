import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { configurationStatus, readConfiguration } from '../src/lib/supabase/config';
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
  rpc: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: mocks.getAll, set: mocks.set }),
}));
vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.createServer }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createAdmin }));
import { authClient, requireUser } from '../src/lib/supabase/server';
import { POST as authenticate } from '../src/app/api/auth/route';
import { GET as workspace } from '../src/app/api/workspace/route';
import { GET as photo, POST as uploadPhoto } from '../src/app/api/photos/route';
import { proxy } from '../src/proxy';
const owner = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.test' };
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
    auth: { getUser: mocks.getUser, signInWithPassword: mocks.signIn, signOut: mocks.signOut },
  });
  mocks.createAdmin.mockReturnValue({
    rpc: mocks.rpc,
    storage: { from: () => ({ upload: mocks.upload, createSignedUrl: mocks.signedUrl }) },
  });
  mocks.rpc.mockImplementation(async (name: string) => ({
    data:
      name === 'verify_thrift_log'
        ? {
            schemaVersion: 3,
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
  it('authorizes the configured owner and rejects other authenticated accounts', async () => {
    expect((await requireUser()).id).toBe(owner.id);
    mocks.getUser.mockResolvedValue({
      data: { user: { ...owner, email: 'other@example.test' } },
      error: null,
    });
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
  it('does not submit wrong-owner passwords to Supabase', async () => {
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
    expect(mocks.signIn).not.toHaveBeenCalled();
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
  it('issues a short-lived URL for an authenticated owner photo and prevents caching', async () => {
    const path = `${owner.id}/test.png`;
    const response = await photo(new Request(`https://thrift.example/api/photos?path=${path}`));
    expect(response.status).toBe(307);
    expect(mocks.signedUrl).toHaveBeenCalledWith(path, 60);
    expect(response.headers.get('cache-control')).toBe('no-store');
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
  mocks.rpc.mockResolvedValue({ data: { schemaVersion: 2 }, error: null });
  const response = await workspace();
  expect(response.status).toBe(503);
  expect((await response.json()).error).toContain('202611090003');
  expect(mocks.rpc.mock.calls.map((args) => args[0])).toEqual(['verify_thrift_log']);
});
