import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
vi.mock('server-only', () => ({}));
import { seal, unseal } from '../src/lib/integrations/whatnot/crypto';
import { emptyWorkspace, orderSchema, type Workspace } from '../src/lib/model';
import { applyCommand } from '../src/lib/commands';
import { WhatnotPlan } from '../src/lib/integrations/whatnot/planner';
import { metrics } from '../src/lib/finance';
import { assistantWorkspace } from './helpers/assistant';
import { whatnotSource, whatnotEarnings } from './helpers/whatnot';
let db: PGlite;
const owner = '11111111-1111-4111-8111-111111111111';
let original: Workspace;
const fixture = `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text unique,email_confirmed_at timestamptz);grant usage on schema auth to service_role;grant select,insert on auth.users to service_role;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create schema storage;grant usage on schema storage to authenticated,service_role;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key,bucket_id text,name text);alter table storage.objects enable row level security;grant select on storage.objects to authenticated;grant select on storage.buckets to service_role;`;
async function sql<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  return (await db.query<T>(query, params)).rows;
}
async function rpc<T = unknown>(
  action: string,
  userId: string | null,
  data: unknown = {},
): Promise<T> {
  return (
    await sql<{ result: T }>('select public.whatnot_admin($1,$2,$3::jsonb) as result', [
      action,
      userId,
      JSON.stringify(data),
    ])
  )[0].result;
}
async function load(id: string) {
  return (
    (await sql<{ w: Workspace | null }>('select public.load_workspace($1) as w', [id]))[0].w ||
    emptyWorkspace()
  );
}
beforeAll(async () => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'isolated-db-key-not-a-real-service-key');
  db = new PGlite();
  await db.exec(fixture);
  for (const file of [
    '202611090001_initial.sql',
    '202611090002_auth_storage_hardening.sql',
    '202611090003_financial_ledger_shipments.sql',
    '20261109203443_inventory_pipeline_fulfillment.sql',
    '202611100001_pipeline_operational_corrections.sql',
    '202611110001_invite_only_beta.sql',
    '202611110002_beta_registration.sql',
  ])
    await db.exec(
      await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'),
    );
  await sql('insert into auth.users values($1,$2,$3)', [
    owner,
    'owner@example.test',
    '2026-11-01T12:00:00Z',
  ]);
  await db.exec('set role service_role');
  await sql('select public.beta_bootstrap_owner($1)', [owner]);
  const base = assistantWorkspace(),
    order = orderSchema.parse({
      id: crypto.randomUUID(),
      marketplace: 'Vinted',
      externalId: 'RETAINED-ORDER',
      date: '2026-11-08T12:00:00Z',
      lines: [{ itemId: base.items[0].id, price: 4500, costBasis: 1200 }],
      discount: 0,
      shippingCollected: 0,
      fees: 300,
      processing: 100,
      shipping: 500,
      packaging: 0,
      other: 0,
      refund: 0,
      feeCredit: 0,
      adjustment: 0,
      tips: 0,
      showId: null,
      type: 'Sale',
      status: 'Completed',
      fulfillment: 'Unfulfilled',
      payout: 'Pending',
      provenance: 'Existing owner data',
      importKey: '',
    });
  await sql('select public.commit_workspace($1,0,$2::jsonb)', [
    owner,
    JSON.stringify(applyCommand(base, { type: 'order', value: order })),
  ]);
  original = await load(owner);
  await db.exec('reset role');
  await db.exec(
    await readFile(
      new URL('../supabase/migrations/202611120001_whatnot_read_only.sql', import.meta.url),
      'utf8',
    ),
  );
  await db.exec('set role service_role');
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await db?.close();
});
async function tester() {
  const id = crypto.randomUUID(),
    seller = (1000000 + Math.floor(Math.random() * 1e9)).toString(),
    email = `tester-${id}@example.test`;
  await sql('insert into auth.users values($1,$2,$3)', [id, email, '2026-11-01T12:00:00Z']);
  await sql('select public.beta_manage_access($1,$2,true)', [owner, email]);
  await rpc('connect', id, {
    seller_id: seller,
    username: 'test-seller',
    token_ciphertext: seal(id, 'wn_pat_tk_test_credential'),
  });
  return { id, seller, email };
}
async function expireCooldown(id: string) {
  await sql(
    "update thrift_log_private.whatnot_connections set last_attempt=now()-interval '3 seconds' where user_id=$1",
    [id],
  );
}
async function finish(
  id: string,
  c: { lease: string; version: string },
  base: Workspace,
  plan: WhatnotPlan,
  checkpoint = { phase: 'done' },
) {
  return rpc('finish', id, {
    lease: c.lease,
    version: c.version,
    revision: base.revision,
    workspace: plan.changed ? plan.w : null,
    records: [...plan.writes.values()],
    checkpoint,
    more: checkpoint.phase !== 'done',
  });
}
it('adds the optional integration without changing schema-7 owner data, auth identities or financial calculations', async () => {
  expect(await load(owner)).toEqual(original);
  expect(
    (await sql<{ v: { schemaVersion: number } }>('select public.verify_thrift_log() as v'))[0].v
      .schemaVersion,
  ).toBe(7);
  expect(
    (
      await sql(
        "select count(*)::integer as n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='thrift_log_private' and c.relname in ('whatnot_connections','whatnot_records','whatnot_webhook_events') and c.relrowsecurity",
      )
    )[0].n,
  ).toBe(3);
  expect((await sql('select id,email from auth.users where id=$1', [owner]))[0]).toMatchObject({
    id: owner,
    email: 'owner@example.test',
  });
});
it('blocks client reads/writes/RPC calls for every account and keeps tokens out of public workspace/status results', async () => {
  const user = await tester();
  const status = await rpc<Record<string, unknown>>('status', user.id);
  expect(JSON.stringify(status)).not.toMatch(/ciphertext|wn_pat_tk|lease/);
  expect(JSON.stringify(await load(user.id))).not.toMatch(/ciphertext|wn_pat_tk/);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    for (const query of [
      'select * from thrift_log_private.whatnot_connections',
      'select * from thrift_log_private.whatnot_records',
      'select * from thrift_log_private.whatnot_webhook_events',
      `select public.whatnot_admin('status','${user.id}')`,
      `select public.whatnot_admin('disconnect','${owner}')`,
    ])
      await expect(db.query(query)).rejects.toThrow('permission denied');
    await db.exec('reset role;set role service_role');
  }
  const stored = (
    await sql<{ token_ciphertext: string }>(
      'select token_ciphertext from thrift_log_private.whatnot_connections where user_id=$1',
      [user.id],
    )
  )[0];
  expect(unseal(user.id, stored.token_ciphertext)).toBe('wn_pat_tk_test_credential');
  expect(() => unseal(owner, stored.token_ciphertext)).toThrow();
});
it('serializes sync, persists one atomic sale/fee/receipt mapping, and makes a replay or stale revision unable to duplicate it', async () => {
  const user = await tester(),
    base = await load(user.id),
    connection = await rpc<{ lease: string; version: string }>('claim', user.id, { force: true });
  expect(connection.lease).toBeTruthy();
  expect(await rpc('claim', user.id, { force: true })).toBeNull();
  const plan = new WhatnotPlan(user.id, user.seller, base);
  const tx = { ...whatnotEarnings(), sellerId: user.seller };
  plan.save('transaction', tx.id, tx, 'pending');
  plan.order(whatnotSource());
  await finish(user.id, connection, base, plan);
  const saved = await load(user.id);
  expect(saved.orders).toHaveLength(1);
  expect(saved.items).toHaveLength(1);
  expect(saved.financialEvents).toHaveLength(2);
  expect(metrics(saved)).toMatchObject({ revenue: 4300, profit: 2475 });
  await expect(finish(user.id, connection, base, plan)).rejects.toThrow('stale_sync_lease');
  expect(await load(user.id)).toEqual(saved);
  expect(await load(owner)).toEqual(original);
  await expireCooldown(user.id);
  const next = await rpc<{ lease: string; version: string }>('claim', user.id, { force: true });
  await expect(finish(user.id, next, base, plan)).rejects.toThrow('revision_conflict');
  expect(await load(user.id)).toEqual(saved);
});
it('disconnects or rotates credentials without deleting records and fences a running sync against both actions', async () => {
  const user = await tester(),
    base = await load(user.id),
    connection = await rpc<{ lease: string; version: string }>('claim', user.id, { force: true }),
    plan = new WhatnotPlan(user.id, user.seller, base);
  plan.order(whatnotSource());
  await rpc('connect', user.id, {
    seller_id: user.seller,
    username: 'test-seller',
    token_ciphertext: seal(user.id, 'wn_pat_tk_new_credential'),
  });
  await expect(finish(user.id, connection, base, plan)).rejects.toThrow('stale_sync_lease');
  await expireCooldown(user.id);
  const next = await rpc<{ lease: string; version: string }>('claim', user.id, { force: true });
  await rpc('disconnect', user.id);
  await expect(finish(user.id, next, base, plan)).rejects.toThrow('stale_sync_lease');
  expect(await load(user.id)).toEqual(base);
  const status = await rpc<{ connected: boolean }>('status', user.id);
  expect(status.connected).toBe(false);
  expect(
    (
      await sql(
        'select token_ciphertext,webhook_ciphertext from thrift_log_private.whatnot_connections where user_id=$1',
        [user.id],
      )
    )[0],
  ).toEqual({ token_ciphertext: null, webhook_ciphertext: null });
});
it('revoked beta accounts cannot be synchronized, retrieved through webhooks or scheduled even with an in-flight lease', async () => {
  const user = await tester(),
    base = await load(user.id),
    connection = await rpc<{ lease: string; version: string; webhook_id: string }>(
      'claim',
      user.id,
      { force: true },
    ),
    plan = new WhatnotPlan(user.id, user.seller, base);
  plan.order(whatnotSource());
  await sql('select public.beta_manage_access($1,$2,false)', [owner, user.email]);
  await expect(finish(user.id, connection, base, plan)).rejects.toThrow('workspace_access_denied');
  expect(await rpc('webhook_connection', null, { endpoint: connection.webhook_id })).toBeNull();
  expect(await rpc<string[]>('due', null)).not.toContain(user.id);
  await expect(rpc('status', user.id)).rejects.toThrow('workspace_access_denied');
  expect(await load(owner)).toEqual(original);
});
it('stores and deduplicates signed-event identifiers without allowing cross-seller delivery or duplicate active account links', async () => {
  const user = await tester();
  await rpc('webhook', user.id, {
    ciphertext: seal(user.id, 'wn_wh_' + Buffer.alloc(32, 7).toString('base64'), 'webhook'),
  });
  const status = await rpc<{ webhook_id: string }>('status', user.id);
  const c = await rpc<{ version: string }>('webhook_connection', null, {
      endpoint: status.webhook_id,
    }),
    event = {
      endpoint: status.webhook_id,
      seller_id: user.seller,
      version: c.version,
      event_id: 'event-1',
    };
  expect(await rpc('enqueue', user.id, event)).toEqual({ accepted: true });
  expect(await rpc('enqueue', user.id, event)).toEqual({ accepted: false });
  await expect(rpc('enqueue', user.id, { ...event, seller_id: '999999' })).rejects.toThrow(
    'invalid_webhook',
  );
  const other = await tester();
  await expect(
    rpc('connect', other.id, {
      seller_id: user.seller,
      username: 'wrong-workspace',
      token_ciphertext: seal(other.id, 'wn_pat_tk_other_credential'),
    }),
  ).rejects.toThrow();
});
it('rolls the metadata and workspace back together if a payload references another tenant’s item', async () => {
  const user = await tester(),
    base = await load(user.id),
    connection = await rpc<{ lease: string; version: string }>('claim', user.id, { force: true }),
    plan = new WhatnotPlan(user.id, user.seller, base);
  plan.order(whatnotSource());
  plan.w.orders[0].lines[0].itemId = original.items[0].id;
  await expect(finish(user.id, connection, base, plan)).rejects.toThrow();
  expect(await load(user.id)).toEqual(base);
  expect(await rpc('read', user.id, { kind: 'order' })).toEqual([]);
  expect(await load(owner)).toEqual(original);
});
