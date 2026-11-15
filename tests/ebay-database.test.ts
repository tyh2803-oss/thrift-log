import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
vi.mock('server-only', () => ({}));
import { emptyWorkspace, type Workspace } from '../src/lib/model';
import { assistantWorkspace } from './helpers/assistant';
import { EbayPlan } from '../src/lib/integrations/ebay/planner';
import { ebayOrder, ebayTransaction, ebayAmount, ebayActor } from './helpers/ebay';
import { seal, unseal } from '../src/lib/integrations/ebay/crypto';
let db: PGlite, original: Workspace;
const owner = ebayActor;
const fixture = `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text unique,email_confirmed_at timestamptz);grant usage on schema auth to service_role;grant select,insert on auth.users to service_role;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create schema storage;grant usage on schema storage to authenticated,service_role;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key,bucket_id text,name text);alter table storage.objects enable row level security;grant select on storage.objects to authenticated;grant select on storage.buckets to service_role;`;
async function sql<T = Record<string, unknown>>(q: string, args: unknown[] = []) {
  return (await db.query<T>(q, args)).rows;
}
async function rpc<T = unknown>(action: string, id: string | null, data: unknown = {}): Promise<T> {
  return (
    await sql<{ r: T }>('select public.ebay_admin($1,$2,$3::jsonb) r', [
      action,
      id,
      JSON.stringify(data),
    ])
  )[0].r;
}
async function load(id: string) {
  return (
    (await sql<{ w: Workspace | null }>('select public.load_workspace($1) w', [id]))[0].w ||
    emptyWorkspace()
  );
}
async function grant(id: string, seller: string) {
  const hash = crypto.randomUUID().replaceAll('-', '').repeat(2);
  await rpc('begin_oauth', id, { state_hash: hash, financials: true, environment: 'production' });
  await rpc('consume_oauth', id, { state_hash: hash });
  await rpc('connect', id, {
    state_hash: hash,
    seller_id: seller,
    username: 'test-seller',
    token_ciphertext: seal(id, 'private-token'),
  });
  return hash;
}
async function tester() {
  const id = crypto.randomUUID(),
    email = id + '@example.test';
  await sql('insert into auth.users values($1,$2,now())', [id, email]);
  await sql('select public.beta_manage_access($1,$2,true)', [owner, email]);
  await grant(id, id);
  return { id, email };
}
beforeAll(async () => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'isolated-test-root');
  db = new PGlite();
  await db.exec(fixture);
  for (const name of [
    '202611090001_initial.sql',
    '202611090002_auth_storage_hardening.sql',
    '202611090003_financial_ledger_shipments.sql',
    '20261109203443_inventory_pipeline_fulfillment.sql',
    '202611100001_pipeline_operational_corrections.sql',
    '202611110001_invite_only_beta.sql',
  ])
    await db.exec(
      await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8'),
    );
  await sql('insert into auth.users values($1,$2,now())', [owner, 'owner@example.test']);
  await db.exec('set role service_role');
  await sql('select public.beta_bootstrap_owner($1)', [owner]);
  await sql('select public.commit_workspace($1,0,$2::jsonb)', [
    owner,
    JSON.stringify(assistantWorkspace()),
  ]);
  original = await load(owner);
  await db.exec('reset role');
  await db.exec(
    await readFile(
      new URL('../supabase/migrations/202611150001_ebay_read_only.sql', import.meta.url),
      'utf8',
    ),
  );
  await db.exec('set role service_role');
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await db?.close();
});
it('is additive on schema 6 and preserves owner records/auth/storage policies; schema 7 upgrade remains compatible', async () => {
  expect(await load(owner)).toEqual(original);
  expect(
    (await sql<{ v: { schemaVersion: number } }>('select public.verify_thrift_log() v'))[0].v
      .schemaVersion,
  ).toBe(6);
  await db.exec('reset role');
  await db.exec(
    await readFile(
      new URL('../supabase/migrations/202611110002_beta_registration.sql', import.meta.url),
      'utf8',
    ),
  );
  await db.exec('set role service_role');
  expect(
    (await sql<{ v: { schemaVersion: number } }>('select public.verify_thrift_log() v'))[0].v
      .schemaVersion,
  ).toBe(7);
  expect(await load(owner)).toEqual(original);
  expect(
    (
      await sql(
        "select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='thrift_log_private' and c.relname in ('ebay_connections','ebay_oauth_states','ebay_records') and c.relrowsecurity",
      )
    )[0].n,
  ).toBe(3);
});
it('denies every client role direct tables and RPC and keeps all credentials out of public status and workspace', async () => {
  const user = await tester();
  expect(JSON.stringify(await rpc('status', user.id))).not.toMatch(
    /ciphertext|private-token|lease/,
  );
  expect(JSON.stringify(await load(user.id))).not.toMatch(/ciphertext|private-token/);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    for (const q of [
      'select * from thrift_log_private.ebay_connections',
      'select * from thrift_log_private.ebay_oauth_states',
      'select * from thrift_log_private.ebay_records',
      'select * from thrift_log_private.ebay_deletion_events',
      `select public.ebay_admin('status','${user.id}')`,
      `select public.ebay_admin('disconnect','${owner}')`,
    ])
      await expect(db.query(q)).rejects.toThrow('permission denied');
    await db.exec('reset role;set role service_role');
  }
  const stored = (
    await sql<{ token_ciphertext: string }>(
      'select token_ciphertext from thrift_log_private.ebay_connections where user_id=$1',
      [user.id],
    )
  )[0];
  expect(unseal(user.id, stored.token_ciphertext)).toBe('private-token');
  expect(() => unseal(owner, stored.token_ciphertext)).toThrow();
});
it('makes OAuth state actor-bound, expiring, single-use and unable to resurrect a disconnected account', async () => {
  const a = await tester(),
    b = await tester(),
    hash = 'a'.repeat(64);
  await rpc('begin_oauth', a.id, {
    state_hash: hash,
    financials: false,
    environment: 'production',
  });
  await expect(rpc('consume_oauth', b.id, { state_hash: hash })).rejects.toThrow(
    'invalid_oauth_state',
  );
  await rpc('consume_oauth', a.id, { state_hash: hash });
  await expect(rpc('consume_oauth', a.id, { state_hash: hash })).rejects.toThrow(
    'invalid_oauth_state',
  );
  await rpc('disconnect', a.id);
  await expect(
    rpc('connect', a.id, {
      state_hash: hash,
      seller_id: a.id,
      username: 'test',
      token_ciphertext: seal(a.id, 'token'),
    }),
  ).rejects.toThrow('invalid_oauth_state');
  const expired = 'b'.repeat(64);
  await rpc('begin_oauth', a.id, {
    state_hash: expired,
    financials: false,
    environment: 'production',
  });
  await sql(
    "update thrift_log_private.ebay_oauth_states set created_at=now()-interval '11 minutes' where state_hash=$1",
    [expired],
  );
  await expect(rpc('consume_oauth', a.id, { state_hash: expired })).rejects.toThrow(
    'invalid_oauth_state',
  );
});
it('rate-limits OAuth attempts durably rather than only in one browser', async () => {
  const u = await tester();
  for (let i = 0; i < 9; i++)
    await rpc('begin_oauth', u.id, {
      state_hash: crypto.randomUUID().replaceAll('-', '').repeat(2),
      financials: false,
      environment: 'production',
    });
  await expect(
    rpc('begin_oauth', u.id, {
      state_hash: 'f'.repeat(64),
      financials: false,
      environment: 'production',
    }),
  ).rejects.toThrow('oauth_rate_limit');
});
it('commits workspace and source mapping atomically, checks revisions and leases, and isolates users', async () => {
  const u = await tester(),
    other = await tester(),
    base = await load(u.id),
    c = await rpc<{ lease: string; version: string }>('claim', u.id, { force: true }),
    p = new EbayPlan(u.id, u.id, 'production', base);
  p.order(ebayOrder());
  p.transaction(ebayTransaction());
  p.payout({
    payoutId: 'payout-1',
    payoutDate: '2026-11-12T00:00:00Z',
    payoutStatus: 'SUCCEEDED',
    amount: ebayAmount('42.75'),
    transactionCount: 1,
  });
  const data = {
    lease: c.lease,
    version: c.version,
    revision: base.revision,
    workspace: p.w,
    records: [...p.writes.values()],
    checkpoint: { phase: 'done' },
    more: false,
  };
  expect(await rpc('claim', u.id, { force: true })).toBeNull();
  await rpc('finish', u.id, data);
  expect((await load(u.id)).orders).toHaveLength(1);
  expect((await load(u.id)).financialEvents).toHaveLength(1);
  expect((await load(u.id)).payouts).toHaveLength(1);
  expect((await load(other.id)).orders).toHaveLength(0);
  await expect(rpc('finish', u.id, data)).rejects.toThrow('stale_sync_lease');
  expect(await load(owner)).toEqual(original);
  await sql(
    "update thrift_log_private.ebay_connections set last_attempt=now()-interval '3 seconds' where user_id=$1",
    [u.id],
  );
  const next = await rpc<{ lease: string; version: string }>('claim', u.id, { force: true });
  await expect(rpc('finish', u.id, { ...data, lease: next.lease })).rejects.toThrow(
    'revision_conflict',
  );
});
it('revocation and disconnect fence every in-flight commit and remove credentials without deleting records', async () => {
  const u = await tester(),
    c = await rpc<{ lease: string; version: string }>('claim', u.id, { force: true }),
    base = await load(u.id);
  await sql('select public.beta_manage_access($1,$2,false)', [owner, u.email]);
  await expect(
    rpc('finish', u.id, {
      lease: c.lease,
      version: c.version,
      revision: 0,
      records: [],
      checkpoint: { phase: 'done' },
    }),
  ).rejects.toThrow('workspace_access_denied');
  expect(await rpc<string[]>('due', null)).not.toContain(u.id);
  await expect(rpc('status', u.id)).rejects.toThrow('workspace_access_denied');
  const v = await tester(),
    claim = await rpc<{ lease: string; version: string }>('claim', v.id, { force: true });
  await rpc('disconnect', v.id);
  await expect(
    rpc('finish', v.id, {
      lease: claim.lease,
      version: claim.version,
      revision: 0,
      records: [],
      checkpoint: { phase: 'done' },
    }),
  ).rejects.toThrow('stale_sync_lease');
  expect(
    (
      await sql(
        'select token_ciphertext from thrift_log_private.ebay_connections where user_id=$1',
        [v.id],
      )
    )[0].token_ciphertext,
  ).toBeNull();
  expect(await load(v.id)).toEqual(base);
});

it('verified account-deletion cleanup removes only that seller’s private integration data and cannot resurrect an in-flight sync', async () => {
  const u = await tester(),
    other = await tester(),
    base = await load(u.id),
    connection = await rpc<{ lease: string; version: string }>('claim', u.id, { force: true }),
    p = new EbayPlan(u.id, u.id, 'production', base);
  p.order(ebayOrder());
  await rpc('finish', u.id, {
    lease: connection.lease,
    version: connection.version,
    revision: base.revision,
    workspace: p.w,
    records: [...p.writes.values()],
    checkpoint: { phase: 'done' },
    more: false,
  });
  const saved = await load(u.id),
    otherStatus = await rpc('status', other.id);
  await rpc('account_deletion', null, {
    seller_id: u.id,
    environment: 'production',
    event_hash: 'a'.repeat(64),
  });
  expect(await rpc('status', u.id)).toMatchObject({ ready: true, connected: false });
  expect(
    (
      await sql('select count(*)::int n from thrift_log_private.ebay_records where user_id=$1', [
        u.id,
      ])
    )[0].n,
  ).toBe(0);
  await expect(
    rpc('finish', u.id, {
      lease: connection.lease,
      version: connection.version,
      revision: saved.revision,
      records: [],
      checkpoint: { phase: 'done' },
    }),
  ).rejects.toThrow('stale_sync_lease');
  expect(await load(u.id)).toEqual(saved);
  expect(await load(owner)).toEqual(original);
  expect(await rpc('status', other.id)).toEqual(otherStatus);
  await rpc('account_deletion', null, {
    seller_id: u.id,
    environment: 'production',
    event_hash: 'a'.repeat(64),
  });
  expect(
    (await sql('select count(*)::int n from thrift_log_private.ebay_deletion_events'))[0].n,
  ).toBe(1);
});
