import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { workspaceSchema, type Workspace } from '../src/lib/model';
import { applyCommand } from '../src/lib/commands';
import { purchaseCostCommands, type PurchaseCosts } from '../src/lib/purchase-costs';
import { metrics } from '../src/lib/finance';
import { soldCostFixture } from './helpers/purchase-costs';
let db: PGlite, base: Workspace, saved: Workspace;
const owner = '11111111-1111-4111-8111-111111111111',
  friend = '22222222-2222-4222-8222-222222222222';
const fixture = `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text unique,email_confirmed_at timestamptz);grant usage on schema auth to service_role;grant select,insert on auth.users to service_role;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create schema storage;grant usage on schema storage to authenticated,service_role;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key,bucket_id text,name text);alter table storage.objects enable row level security;grant select on storage.objects to authenticated;grant select on storage.buckets to service_role;`;
async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}
async function load(user = owner) {
  return workspaceSchema.parse(
    (await query<{ w: unknown }>('select public.load_workspace($1) as w', [user]))[0].w,
  );
}
async function commit(w: Workspace, revision: number, user = owner) {
  return (
    await query<{ n: number }>('select public.commit_workspace($1,$2,$3::jsonb) as n', [
      user,
      revision,
      JSON.stringify(w),
    ])
  )[0].n;
}
beforeAll(async () => {
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
  for (const [id, email] of [
    [owner, 'owner@example.test'],
    [friend, 'friend@example.test'],
  ])
    await query('insert into auth.users values($1,$2,$3)', [id, email, '2026-11-01T12:00:00Z']);
  await db.exec('set role service_role');
  await query('select public.beta_bootstrap_owner($1)', [owner]);
  await query('select public.beta_manage_access($1,$2,true)', [owner, 'friend@example.test']);
  base = await soldCostFixture();
  base = applyCommand(base, {
    type: 'financialEvent',
    value: {
      id: crypto.randomUUID(),
      orderId: base.orders[0].id,
      date: base.orders[0].date,
      kind: 'Fee adjustment',
      amount: 100,
      reason: 'Previously recorded fee',
      externalId: 'existing-fee',
      reversesId: null,
      category: 'Other',
      itemIds: [],
    },
  });
  await commit(base, 0);
  base = await load();
  await db.exec('reset role');
  await db.exec(
    await readFile(
      new URL('../supabase/migrations/202611130002_purchase_cost_corrections.sql', import.meta.url),
      'utf8',
    ),
  );
  await db.exec('set role service_role');
});
afterAll(async () => await db?.close());
it('adds cost corrections to schema 6 without changing owner inventory, sales, posted costs or authorization', async () => {
  const actual = await load();
  expect(actual.items).toEqual(base.items);
  expect(actual.orders).toEqual(base.orders);
  expect(actual.imports).toEqual(base.imports);
  expect(actual.financialEvents.map((e) => ({ ...e, costItemId: e.costItemId ?? null }))).toEqual(
    base.financialEvents.map((e) => ({ ...e, costItemId: e.costItemId ?? null })),
  );
  expect((await query<{ v: boolean }>('select public.purchase_costs_ready() as v'))[0].v).toBe(
    true,
  );
  expect(
    (await query<{ v: { schemaVersion: number } }>('select public.verify_thrift_log() as v'))[0].v
      .schemaVersion,
  ).toBe(6);
});
it('persists an unknown purchase-cost correction atomically and reloads exact COGS without rewriting the original sale', async () => {
  const request: PurchaseCosts = {
    id: crypto.randomUUID(),
    entries: [{ itemId: base.items[0].id, cost: 501 }],
    confirmCorrections: false,
    reason: 'Confirmed purchase cost',
  };
  saved = purchaseCostCommands(base, request).reduce(applyCommand, base);
  const revision = await commit(saved, base.revision);
  saved = await load();
  expect(saved.revision).toBe(revision);
  expect(saved.orders).toEqual(base.orders);
  expect(saved.items[0].cost).toBe(501);
  expect(saved.financialEvents.find((e) => e.kind === 'Cost basis adjustment')!.costItemId).toBe(
    base.items[0].id,
  );
  expect(metrics(saved)).toMatchObject({ cogs: 501, profit: 2699, unknownCosts: 0 });
  expect(purchaseCostCommands(saved, request)).toEqual([]);
});
it('retains immutable financial and original sale-line protections with corrected costs', async () => {
  await expect(
    query('update public.financial_events set amount=999 where user_id=$1', [owner]),
  ).rejects.toThrow('posted_record_immutable');
  await expect(
    query('update public.order_lines set "costBasis"=999 where user_id=$1', [owner]),
  ).rejects.toThrow('financial_basis_immutable');
  const before = await load(),
    bad = structuredClone(before);
  bad.financialEvents.push({
    ...bad.financialEvents.find((e) => e.kind === 'Cost basis adjustment')!,
    id: crypto.randomUUID(),
    externalId: 'NEGATIVE',
    amount: -9999,
  });
  await expect(commit(bad, before.revision)).rejects.toThrow('invalid_corrected_purchase_cost');
  expect((await load()).revision).toBe(before.revision);
});
it('denies foreign cost targets, raw client writes, read-only clients and revoked accounts', async () => {
  await expect(
    query(
      'insert into public.financial_events(user_id,id,"orderId",date,kind,amount,reason,"externalId","reversesId",category,"costItemId") values($1,$2,$3,$4,$5,1,$6,$7,null,$8,$9)',
      [
        owner,
        crypto.randomUUID(),
        saved.orders[0].id,
        saved.orders[0].date,
        'Cost basis adjustment',
        'Invalid foreign target',
        'FOREIGN',
        'Other',
        crypto.randomUUID(),
      ],
    ),
  ).rejects.toThrow('invalid_purchase_cost_correction');
  await db.exec('set role authenticated');
  await query("select set_config('request.jwt.claim.sub',$1,false)", [friend]);
  expect(await query('select * from public.financial_events')).toEqual([]);
  await expect(query('select public.purchase_costs_ready()')).rejects.toThrow('permission denied');
  await expect(query('update public.items set cost=1')).rejects.toThrow('permission denied');
  await db.exec('reset role;set role service_role');
  await query('select public.beta_manage_access($1,$2,false)', [owner, 'friend@example.test']);
  await expect(query('select public.load_workspace($1)', [friend])).rejects.toThrow(
    'workspace_access_denied',
  );
});
it('remains compatible with existing schema-7 registration', async () => {
  await db.exec('reset role');
  await db.exec(
    await readFile(
      new URL('../supabase/migrations/202611110002_beta_registration.sql', import.meta.url),
      'utf8',
    ),
  );
  await db.exec('set role service_role');
  expect(
    (await query<{ v: { schemaVersion: number } }>('select public.verify_thrift_log() as v'))[0].v
      .schemaVersion,
  ).toBe(7);
  expect((await load()).orders).toEqual(base.orders);
});
