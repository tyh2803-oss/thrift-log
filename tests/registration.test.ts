import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { assistantWorkspace } from './helpers/assistant';
import { applyCommand } from '../src/lib/commands';
import { orderSchema } from '../src/lib/model';
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  create: vi.fn(),
  signIn: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
  resend: vi.fn(),
  update: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: vi.fn() }) }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      signInWithPassword: mocks.signIn,
      getUser: mocks.getUser,
      signOut: mocks.signOut,
      resend: mocks.resend,
    },
  }),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: mocks.rpc,
    auth: { admin: { createUser: mocks.create, updateUserById: mocks.update } },
  }),
}));
import { POST as register } from '../src/app/api/register/route';
import { POST as authenticate } from '../src/app/api/auth/route';
import { requireUser } from '../src/lib/supabase/server';
import { loadWorkspace } from '../src/lib/supabase/workspace';

let db: PGlite;
const ownerId = '11111111-1111-4111-8111-111111111111';
const ownerEmail = 'owner@example.test';
const password = 'A distinct beta password 123';
type Account = { id: string; email: string; email_confirmed_at: string | null; password: string };
const accounts = new Map<string, Account>();
let session: Account | null = null;
let beforeOwner: unknown;
let beforeOwnerRecords: unknown;
const businessTables = [
  'workspaces',
  'imports',
  'locations',
  'trips',
  'shows',
  'items',
  'listings',
  'orders',
  'expenses',
  'sessions',
  'order_lines',
  'financial_audit',
  'financial_events',
  'payouts',
  'shipments',
  'financial_event_returns',
  'payout_allocations',
  'shipment_orders',
];
async function ownerRecords() {
  const rows: Record<string, unknown> = {};
  for (const table of businessTables)
    rows[table] = (
      await db.query<Record<string, unknown>>(
        `select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) as records from public.${table} t where user_id=$1`,
        [ownerId],
      )
    ).rows[0].records;
  return rows;
}
async function authQuery(sql: string, params: (string | null)[]) {
  // Auth runs as its own privileged service, not the app's service_role transaction identity.
  await db.exec('reset role');
  try {
    return await db.query<Record<string, unknown>>(sql, params);
  } finally {
    await db.exec('set role service_role');
  }
}
const fixture = `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text unique,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create schema storage;grant usage on schema storage to authenticated,service_role;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key,bucket_id text,name text);alter table storage.objects enable row level security;grant select on storage.objects to authenticated;grant select on storage.buckets to service_role;`;
const signatures: Record<string, string[]> = {
  beta_begin_registration: ['p_email', 'p_email_key', 'p_client_key', 'p_global_key'],
  beta_finish_registration: ['p_email', 'p_token', 'p_user_id'],
  beta_cancel_registration: ['p_email', 'p_token'],
  beta_check_access: ['p_user_id'],
  verify_thrift_log: [],
  load_workspace: ['p_user_id'],
};
beforeAll(async () => {
  db = new PGlite();
  await db.exec(fixture);
  const folder = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(folder)).filter((name) => name.endsWith('.sql')).sort()) {
    if (name === '202611110002_beta_registration.sql') {
      await db.query<Record<string, unknown>>('insert into auth.users values($1,$2,now())', [
        ownerId,
        ownerEmail,
      ]);
      await db.query<Record<string, unknown>>('select public.beta_bootstrap_owner($1)', [ownerId]);
      await db.query<Record<string, unknown>>('select public.commit_workspace($1,0,$2::jsonb)', [
        ownerId,
        JSON.stringify(
          applyCommand(assistantWorkspace(), {
            type: 'order',
            value: orderSchema.parse({
              id: randomUUID(),
              marketplace: 'Vinted',
              date: '2026-11-10T12:00:00Z',
              lines: [
                {
                  itemId: assistantWorkspace().items[0].id,
                  price: 4500,
                  costBasis: assistantWorkspace().items[0].cost,
                },
              ],
              discount: 0,
              shippingCollected: 0,
              fees: 200,
              processing: 0,
              shipping: 0,
              packaging: 0,
              other: 0,
              refund: 0,
              feeCredit: 0,
              adjustment: 0,
              tips: 0,
              type: 'Sale',
              status: 'Completed',
              fulfillment: 'Unfulfilled',
              payout: 'Pending',
              amountsConfirmed: true,
            }),
          }),
        ),
      ]);
      beforeOwner = (
        await db.query<Record<string, unknown>>('select public.load_workspace($1) as w', [ownerId])
      ).rows[0];
      beforeOwnerRecords = await ownerRecords();
    }
    await db.exec(await readFile(new URL(name, folder), 'utf8'));
  }
  expect(
    (await db.query<Record<string, unknown>>('select public.load_workspace($1) as w', [ownerId]))
      .rows[0],
  ).toEqual(beforeOwner);
  expect(await ownerRecords()).toEqual(beforeOwnerRecords);
  // The existing dashboard bootstrap remains usable when all migrations were applied together.
  const bootstrap = await readFile(
    new URL('../supabase/bootstrap_beta_owner.sql', import.meta.url),
    'utf8',
  );
  await db.exec(bootstrap.replace('REPLACE_WITH_OWNER_EMAIL', ownerEmail));
  expect(await ownerRecords()).toEqual(beforeOwnerRecords);
});
beforeEach(async () => {
  vi.resetAllMocks();
  for (const [k, v] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-public-key',
    SUPABASE_SERVICE_ROLE_KEY: 'test-server-key',
    OWNER_EMAIL: ownerEmail,
    BETA_REGISTRATION_MODE: 'preauthorized',
    BETA_SITE_URL: 'https://thrift.example',
    VERCEL: '',
  }))
    vi.stubEnv(k, v);
  await db.exec('begin;set role service_role');
  session = null;
  accounts.clear();
  accounts.set(ownerEmail, {
    id: ownerId,
    email: ownerEmail,
    email_confirmed_at: '2026-11-01T00:00:00Z',
    password,
  });
  mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown> = {}) => {
    const signature = signatures[name];
    if (!signature) throw new Error('Unexpected RPC');
    await db.exec('savepoint sdk_rpc');
    try {
      const result = await db.query<Record<string, unknown>>(
        `select public.${name}(${signature.map((_, i) => `$${i + 1}`).join(',')}) as result`,
        signature.map((key) => args[key]),
      );
      await db.exec('release savepoint sdk_rpc');
      return { data: result.rows[0].result, error: null };
    } catch (error) {
      await db.exec('rollback to savepoint sdk_rpc;release savepoint sdk_rpc');
      return { data: null, error };
    }
  });
  mocks.create.mockImplementation(
    async (input: { email: string; password: string; email_confirm: boolean }) => {
      if (accounts.has(input.email))
        return { data: { user: null }, error: { code: 'email_exists', status: 422 } };
      const user = {
        id: randomUUID(),
        email: input.email,
        password: input.password,
        email_confirmed_at: input.email_confirm ? '2026-11-11T00:00:00Z' : null,
      };
      accounts.set(user.email, user);
      await authQuery('insert into auth.users values($1,$2,$3)', [
        user.id,
        user.email,
        user.email_confirmed_at,
      ]);
      return { data: { user }, error: null };
    },
  );
  mocks.signIn.mockImplementation(
    async ({ email, password: provided }: { email: string; password: string }) => {
      const user = accounts.get(email);
      if (!user || !user.email_confirmed_at || user.password !== provided)
        return { data: { user: null }, error: { code: 'invalid_credentials' } };
      session = user;
      return { data: { user }, error: null };
    },
  );
  mocks.getUser.mockImplementation(async () => ({ data: { user: session }, error: null }));
  mocks.signOut.mockImplementation(async () => {
    session = null;
    return { error: null };
  });
  mocks.resend.mockResolvedValue({ error: null });
});
afterEach(async () => {
  try {
    await db.exec('reset role;set role service_role');
    // Every test also proves registration left all preexisting owner inventory/financial JSON unchanged.
    expect(
      (await db.query<Record<string, unknown>>('select public.load_workspace($1) as w', [ownerId]))
        .rows[0],
    ).toEqual(beforeOwner);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(await ownerRecords()).toEqual(beforeOwnerRecords);
  } finally {
    await db.exec('rollback;reset role');
    vi.unstubAllEnvs();
  }
});
afterAll(async () => {
  await db?.close();
});
it('upgrades a populated schema-6 database without changing existing owner, verified, invited or revoked tester accounts and records', async () => {
  const legacy = new PGlite();
  try {
    await legacy.exec(fixture);
    const folder = new URL('../supabase/migrations/', import.meta.url);
    const migration = '202611110002_beta_registration.sql';
    for (const name of (await readdir(folder))
      .filter((name) => name.endsWith('.sql') && name < migration)
      .sort())
      await legacy.exec(await readFile(new URL(name, folder), 'utf8'));
    await legacy.exec(
      'alter table auth.users add column encrypted_password text;alter table auth.users add column invited_at timestamptz',
    );
    const users = [
      { id: ownerId, email: ownerEmail, confirmed: true },
      { id: randomUUID(), email: 'existing@example.test', confirmed: true },
      { id: randomUUID(), email: 'invited@example.test', confirmed: false },
      { id: randomUUID(), email: 'revoked@example.test', confirmed: true },
    ];
    for (const user of users) {
      await legacy.query(
        'insert into auth.users(id,email,email_confirmed_at,encrypted_password,invited_at) values($1,$2,$3,$4,$5)',
        [
          user.id,
          user.email,
          user.confirmed ? '2026-11-01T12:00:00Z' : null,
          'synthetic-existing-password-hash',
          user.confirmed ? null : '2026-11-02T12:00:00Z',
        ],
      );
      if (user.id === ownerId)
        await legacy.query('select public.beta_bootstrap_owner($1)', [ownerId]);
      else
        await legacy.query('select public.beta_manage_access($1,$2,true)', [ownerId, user.email]);
      if (user.confirmed) {
        const w = assistantWorkspace();
        w.items[0].title = `${user.email} retained inventory`;
        await legacy.query('select public.commit_workspace($1,0,$2::jsonb)', [
          user.id,
          JSON.stringify(w),
        ]);
        await legacy.query('insert into storage.objects values($1,$2,$3)', [
          randomUUID(),
          'inventory-photos',
          `${user.id}/retained.png`,
        ]);
      }
    }
    await legacy.query('select public.beta_manage_access($1,$2,false)', [
      ownerId,
      'revoked@example.test',
    ]);
    const snapshot = async () => {
      const records: Record<string, unknown> = {};
      for (const table of [
        ...businessTables.map((t) => `public.${t}`),
        'auth.users',
        'thrift_log_private.beta_access',
        'storage.objects',
      ])
        records[table] = (
          await legacy.query<{ records: unknown }>(
            `select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) as records from ${table} t`,
          )
        ).rows[0].records;
      return records;
    };
    expect(
      (
        await legacy.query<{ v: { schemaVersion: number } }>(
          'select public.verify_thrift_log() as v',
        )
      ).rows[0].v.schemaVersion,
    ).toBe(6);
    const before = await snapshot();
    await legacy.exec(await readFile(new URL(migration, folder), 'utf8'));
    expect(await snapshot()).toEqual(before);
    expect(
      (await legacy.query<{ v: unknown }>('select public.verify_thrift_log() as v')).rows[0].v,
    ).toMatchObject({
      schemaVersion: 7,
      betaRegistration: true,
      inviteOnlyBeta: true,
      betaOwnerConfigured: true,
    });
    for (const [index, role] of [
      [0, 'owner'],
      [1, 'tester'],
      [2, null],
      [3, null],
    ] as const)
      expect(
        (
          await legacy.query<{ role: string | null }>(
            'select public.beta_check_access($1) as role',
            [users[index].id],
          )
        ).rows[0].role,
      ).toBe(role);
    expect(await snapshot()).toEqual(before);
  } finally {
    await legacy.close();
  }
});
async function authorize(email: string) {
  await db.query<Record<string, unknown>>('select public.beta_manage_access($1,$2,true)', [
    ownerId,
    email,
  ]);
}
function request(
  email = 'friend@example.test',
  patch: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  return new Request('https://thrift.example/api/register', {
    method: 'POST',
    headers: { Origin: 'https://thrift.example', 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ email, password, ...patch }),
  });
}
async function begin(email: string, emailKey = 'a'.repeat(64), clientKey = 'b'.repeat(64)) {
  return (
    await db.query<{ v: { status: string; token?: string } }>(
      'select public.beta_begin_registration($1,$2,$3,$4) as v',
      [email, emailKey, clientKey, 'c'.repeat(64)],
    )
  ).rows[0].v;
}
it('registers an approved normalized email, binds exactly one UUID, signs in and opens an empty private workspace without email', async () => {
  await authorize('friend@example.test');
  const r = await register(
    request(' FRIEND@example.test ', { role: 'owner', userId: ownerId, email_confirm: false }),
  );
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ ok: true });
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({ email: 'friend@example.test', email_confirm: true, password }),
  );
  expect(mocks.resend).not.toHaveBeenCalled();
  const user = await requireUser();
  expect(user.betaRole).toBe('tester');
  expect(user.id).not.toBe(ownerId);
  const w = await loadWorkspace(user.id);
  expect(w.items).toEqual([]);
  expect(w.orders).toEqual([]);
  expect(
    (
      await db.query<Record<string, unknown>>(
        'select user_id from thrift_log_private.beta_access where email=$1',
        ['friend@example.test'],
      )
    ).rows[0].user_id,
  ).toBe(user.id);
});
it('rejects unknown, revoked and owner emails without creating, confirming or authorizing accounts', async () => {
  await authorize('revoked@example.test');
  await db.query<Record<string, unknown>>('select public.beta_manage_access($1,$2,false)', [
    ownerId,
    'revoked@example.test',
  ]);
  for (const email of ['unknown@example.test', 'revoked@example.test', ownerEmail])
    expect(
      (await register(request(email, { role: 'owner', isOwner: true, userId: ownerId }))).status,
    ).toBe(400);
  expect(mocks.create).not.toHaveBeenCalled();
  expect(accounts.size).toBe(1);
  expect(
    (
      await db.query<Record<string, unknown>>(
        'select count(*)::int as n from thrift_log_private.beta_access',
      )
    ).rows[0].n,
  ).toBe(2);
});
it('keeps registration disabled until explicitly enabled and rejects CSRF, malformed and oversized requests', async () => {
  vi.stubEnv('BETA_REGISTRATION_MODE', '');
  expect((await register(request())).status).toBe(503);
  vi.stubEnv('BETA_REGISTRATION_MODE', 'preauthorized');
  expect(
    (await register(request('friend@example.test', {}, { Origin: 'https://evil.example' }))).status,
  ).toBe(400);
  expect((await register(request('invalid-email'))).status).toBe(400);
  const huge = new Request('https://thrift.example/api/register', {
    method: 'POST',
    headers: { Origin: 'https://thrift.example' },
    body: 'x'.repeat(5000),
  });
  expect((await register(huge)).status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('validates passwords without consuming the authorization or retaining an abandoned claim', async () => {
  await authorize('friend@example.test');
  for (const pwd of ['short', '😀'.repeat(19)])
    expect((await register(request(undefined, { password: pwd }))).status).toBe(400);
  expect(mocks.create).not.toHaveBeenCalled();
  expect((await register(request())).status).toBe(200);
});
it.each([
  ['Abc1234', 400],
  ['Abc12345', 200],
  ['Abc123456', 200],
])('enforces the eight-character registration boundary for %s', async (newPassword, status) => {
  await authorize('friend@example.test');
  const response = await register(request(undefined, { password: newPassword }));
  expect(response.status).toBe(status);
  if (status === 400) {
    expect((await response.json()).error).toContain('at least 8 characters');
    expect(mocks.create).not.toHaveBeenCalled();
  } else {
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ password: newPassword }));
    expect((await requireUser()).betaRole).toBe('tester');
  }
});
it('returns a clean password-policy error and permits correcting it without a duplicate user', async () => {
  await authorize('friend@example.test');
  mocks.create.mockResolvedValueOnce({
    data: { user: null },
    error: { code: 'weak_password', status: 422, message: password },
  });
  const r = await register(request());
  expect(r.status).toBe(400);
  expect(await r.text()).not.toContain(password);
  expect((await register(request())).status).toBe(200);
});
it('handles duplicate verified accounts by proving the existing password and preserving their workspace and UUID', async () => {
  await authorize('friend@example.test');
  expect((await register(request())).status).toBe(200);
  const id = session!.id;
  await db.query<Record<string, unknown>>('select public.commit_workspace($1,0,$2::jsonb)', [
    id,
    JSON.stringify(assistantWorkspace()),
  ]);
  const before = await loadWorkspace(id);
  expect(
    (await register(request(undefined, { password: 'incorrect existing password' }))).status,
  ).toBe(400);
  expect((await register(request())).status).toBe(200);
  expect(session!.id).toBe(id);
  expect(await loadWorkspace(id)).toEqual(before);
  expect(mocks.create).toHaveBeenCalledTimes(1);
});
it('never overwrites an existing invited/unconfirmed account and allows setup with an owner-supplied temporary password', async () => {
  const invited = {
    id: randomUUID(),
    email: 'friend@example.test',
    password: 'existing temporary password',
    email_confirmed_at: null as string | null,
  };
  accounts.set(invited.email, invited);
  await authQuery('insert into auth.users values($1,$2,null)', [invited.id, invited.email]);
  await authorize(invited.email);
  expect((await register(request())).status).toBe(400);
  expect(mocks.create).not.toHaveBeenCalled();
  expect(invited.password).toBe('existing temporary password');
  // Simulates owner completing setup securely in Auth dashboard; the public endpoint cannot do it.
  invited.email_confirmed_at = '2026-11-11T00:00:00Z';
  await authQuery('update auth.users set email_confirmed_at=now() where id=$1', [invited.id]);
  const r = await authenticate(
    new Request('https://thrift.example/api/auth', {
      method: 'POST',
      headers: { Origin: 'https://thrift.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'signin', email: invited.email, password: invited.password }),
    }),
  );
  expect(r.status).toBe(200);
  expect((await requireUser()).id).toBe(invited.id);
});
it('rechecks revocation between Auth creation and binding; the created account cannot access data', async () => {
  await authorize('friend@example.test');
  const create = mocks.create.getMockImplementation()!;
  mocks.create.mockImplementationOnce(async (input) => {
    const r = await create(input);
    await db.query<Record<string, unknown>>('select public.beta_manage_access($1,$2,false)', [
      ownerId,
      input.email,
    ]);
    return r;
  });
  expect((await register(request())).status).toBe(409);
  expect(mocks.signIn).not.toHaveBeenCalled();
  session = accounts.get('friend@example.test')!;
  await expect(requireUser()).rejects.toThrow('Unauthorized');
});
it('recovers an uncertain post-create link failure by proving the same password, without another Auth user', async () => {
  await authorize('friend@example.test');
  const rpc = mocks.rpc.getMockImplementation()!;
  mocks.rpc.mockImplementation(async (name, args) =>
    name === 'beta_finish_registration'
      ? { data: null, error: { message: 'network uncertainty' } }
      : rpc(name, args),
  );
  expect((await register(request())).status).toBe(409);
  expect((await register(request())).status).toBe(200);
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect((await requireUser()).betaRole).toBe('tester');
});
it('limits failed email attempts across client/IP changes and ignores caller-supplied forwarding headers', async () => {
  for (let i = 0; i < 5; i++)
    expect(
      (await register(request('unknown@example.test', {}, { 'x-forwarded-for': `203.0.113.${i}` })))
        .status,
    ).toBe(400);
  const r = await register(
    request('unknown@example.test', {}, { 'x-forwarded-for': '203.0.113.99' }),
  );
  expect(r.status).toBe(429);
  expect(r.headers.get('Retry-After')).toBe('900');
  const calls = mocks.rpc.mock.calls.filter(([name]) => name === 'beta_begin_registration');
  expect(new Set(calls.map(([, args]) => args.p_client_key)).size).toBe(1);
  for (const [, args] of calls) {
    expect(args.p_email_key).toMatch(/^[a-f0-9]{64}$/);
    expect(args.p_client_key).toMatch(/^[a-f0-9]{64}$/);
  }
});
it('limits many distinct email failures from one client and globally across distributed clients', async () => {
  for (let i = 0; i < 20; i++)
    expect((await register(request(`unknown${i}@example.test`))).status).toBe(400);
  expect((await register(request('new@example.test'))).status).toBe(429);
  // Exercise the shared SQL budget with distinct keyed clients and emails.
  for (let i = 0; i < 100; i++)
    expect(
      (
        await begin(
          `g${i}@example.test`,
          i.toString(16).padStart(64, '0'),
          (i + 1000).toString(16).padStart(64, '0'),
        )
      ).status,
    ).toBe('denied');
  expect((await begin('g100@example.test', 'd'.repeat(64), 'e'.repeat(64))).status).toBe('limited');
});
it('serializes competing signups, enforces claim identity and safely expires abandoned claims', async () => {
  await authorize('friend@example.test');
  const first = await begin('friend@example.test');
  expect(first.status).toBe('allowed');
  expect((await begin('friend@example.test')).status).toBe('busy');
  expect(
    (
      await db.query<Record<string, unknown>>(
        'select public.beta_finish_registration($1,$2,$3) as ok',
        ['friend@example.test', randomUUID(), ownerId],
      )
    ).rows[0].ok,
  ).toBe(false);
  await db.query<Record<string, unknown>>(
    "update thrift_log_private.beta_registration_claims set expires_at=now()-interval '1 second'",
  );
  const next = await begin('friend@example.test');
  expect(next.status).toBe('allowed');
  expect(next.token).not.toBe(first.token);
});
it('retains denied attempt counters across requests and resets budgets after their time window', async () => {
  for (let i = 0; i < 5; i++) expect((await begin('unknown@example.test')).status).toBe('denied');
  expect((await begin('unknown@example.test')).status).toBe('limited');
  await db.exec(
    "update thrift_log_private.beta_registration_limits set window_start=now()-interval '16 minutes'",
  );
  expect((await begin('unknown@example.test')).status).toBe('denied');
});
it('bounds limiter storage after the global budget is exhausted even when attackers rotate emails and clients', async () => {
  for (let i = 0; i < 100; i++)
    await begin(
      `g${i}@example.test`,
      i.toString(16).padStart(64, '0'),
      (i + 1000).toString(16).padStart(64, '0'),
    );
  const count = async () =>
    (
      await db.query<{ n: number }>(
        'select count(*)::int as n from thrift_log_private.beta_registration_limits',
      )
    ).rows[0].n;
  const before = await count();
  for (let i = 100; i < 110; i++)
    expect(
      (
        await begin(
          `g${i}@example.test`,
          i.toString(16).padStart(64, '0'),
          (i + 1000).toString(16).padStart(64, '0'),
        )
      ).status,
    ).toBe('limited');
  expect(await count()).toBe(before);
});
it('requires email proof in confirmation mode without changing public signup or granting access early', async () => {
  vi.stubEnv('BETA_REGISTRATION_MODE', 'email');
  await authorize('friend@example.test');
  const r = await register(
    request(undefined, {
      email_confirm: true,
      mode: 'preauthorized',
      app_metadata: { role: 'owner' },
    }),
  );
  expect(r.status).toBe(200);
  expect((await r.json()).confirmationRequired).toBe(true);
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ email_confirm: false }));
  expect(mocks.resend).toHaveBeenCalledWith({
    type: 'signup',
    email: 'friend@example.test',
    options: { emailRedirectTo: 'https://thrift.example/auth/confirm' },
  });
  session = accounts.get('friend@example.test')!;
  await expect(requireUser()).rejects.toThrow('Unauthorized');
  session.email_confirmed_at = '2026-11-11T00:00:00Z';
  await authQuery('update auth.users set email_confirmed_at=now() where id=$1', [session.id]);
  expect((await requireUser()).betaRole).toBe('tester');
});
it('reports email-delivery failure without deleting the account or bypassing verification', async () => {
  vi.stubEnv('BETA_REGISTRATION_MODE', 'email');
  await authorize('friend@example.test');
  mocks.resend.mockResolvedValue({ error: { message: 'SMTP unavailable' } });
  expect((await register(request())).status).toBe(503);
  expect(accounts.get('friend@example.test')!.email_confirmed_at).toBeNull();
});
it('preserves owner login and keeps two registered testers isolated under real RLS and private Storage rules', async () => {
  const ids: string[] = [];
  for (const email of ['friend@example.test', 'friend2@example.test']) {
    await authorize(email);
    expect((await register(request(email))).status).toBe(200);
    ids.push(session!.id);
    await db.query<Record<string, unknown>>('select public.commit_workspace($1,0,$2::jsonb)', [
      session!.id,
      JSON.stringify(assistantWorkspace()),
    ]);
  }
  for (const id of ids) {
    await authQuery('insert into storage.objects values($1,$2,$3)', [
      randomUUID(),
      'inventory-photos',
      `${id}/test.png`,
    ]);
  }
  expect((await authQuery('select count(*)::int as n from storage.objects', [])).rows[0].n).toBe(2);
  for (const id of ids) {
    await db.exec(`set role authenticated;set request.jwt.claim.sub='${id}'`);
    expect(
      (await db.query<Record<string, unknown>>('select distinct user_id from public.items')).rows,
    ).toEqual([{ user_id: id }]);
    expect(
      (
        await db.query<Record<string, unknown>>('select * from public.items where user_id=$1', [
          ownerId,
        ])
      ).rows,
    ).toEqual([]);
    expect((await db.query<Record<string, unknown>>('select * from storage.objects')).rows).toEqual(
      [],
    );
    await db.exec('reset role;set role service_role');
  }
  const r = await authenticate(
    new Request('https://thrift.example/api/auth', {
      method: 'POST',
      headers: { Origin: 'https://thrift.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'signin', email: ownerEmail, password }),
    }),
  );
  expect(r.status).toBe(200);
  expect((await requireUser()).betaRole).toBe('owner');
  expect(
    (await db.query<Record<string, unknown>>('select public.verify_thrift_log() as v')).rows[0].v,
  ).toMatchObject({
    schemaVersion: 7,
    betaRegistration: true,
    inviteOnlyBeta: true,
    betaOwnerConfigured: true,
  });
});
it('does not grant either client role registration RPCs or access to private registration tables', async () => {
  for (const role of ['anon', 'authenticated']) {
    for (const signature of [
      'beta_begin_registration(text,text,text,text)',
      'beta_finish_registration(text,uuid,uuid)',
      'beta_cancel_registration(text,uuid)',
    ])
      expect(
        (
          await db.query<Record<string, unknown>>('select has_function_privilege($1,$2,$3) as ok', [
            role,
            'public.' + signature,
            'EXECUTE',
          ])
        ).rows[0].ok,
      ).toBe(false);
    for (const table of ['beta_registration_claims', 'beta_registration_limits'])
      expect(
        (
          await db.query<Record<string, unknown>>('select has_table_privilege($1,$2,$3) as ok', [
            role,
            'thrift_log_private.' + table,
            'SELECT',
          ])
        ).rows[0].ok,
      ).toBe(false);
  }
});
