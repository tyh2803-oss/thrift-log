import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { assistantWorkspace } from './helpers/assistant';
import { applyCommand } from '../src/lib/commands';
import { orderSchema } from '../src/lib/model';
let db: PGlite;
const owner = '11111111-1111-4111-8111-111111111111',
  friend = '22222222-2222-4222-8222-222222222222',
  outsider = '33333333-3333-4333-8333-333333333333';
let preserved: unknown;
const response = {
  message: 'Prepared only.',
  choices: [],
  drafts: { batch: null, historyBatch: null },
  model: 'gpt-6.1-sol',
  workspaceRevision: 1,
  tools: ['search_inventory'],
  usage: { inputTokens: 100, outputTokens: 20 },
};
async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}
async function rpc<T = Record<string, unknown>>(action: string, id: string, data: unknown = {}) {
  return (
    await query<{ v: T }>('select public.assistant_chat($1,$2,$3::jsonb) as v', [
      action,
      id,
      JSON.stringify(data),
    ])
  )[0].v;
}
async function start(id: string, revision = 0) {
  const requestId = crypto.randomUUID(),
    inputHash = 'a'.repeat(64);
  const state = await rpc<{ lease: string; revision: number; messages: unknown[] }>('claim', id, {
    requestId,
    revision,
    inputHash,
  });
  return { ...state, requestId, inputHash };
}
async function finish(id: string, turn: Awaited<ReturnType<typeof start>>) {
  return rpc<{ revision: number; messages: unknown[]; response: typeof response }>('finish', id, {
    ...turn,
    messages: [
      { id: turn.requestId, role: 'user', text: 'Find my jacket.' },
      { id: crypto.randomUUID(), role: 'assistant', text: 'Prepared only.' },
    ],
    response,
  });
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text unique,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create schema storage;grant usage on schema storage to authenticated,service_role;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key,bucket_id text,name text);alter table storage.objects enable row level security;grant select on storage.objects to authenticated;grant select on storage.buckets to service_role;`,
  );
  for (const file of [
    '202611090001_initial.sql',
    '202611090002_auth_storage_hardening.sql',
    '202611090003_financial_ledger_shipments.sql',
    '20261109203443_inventory_pipeline_fulfillment.sql',
    '202611100001_pipeline_operational_corrections.sql',
    '202611110001_invite_only_beta.sql',
  ])
    await db.exec(
      await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'),
    );
  for (const [id, email] of [
    [owner, 'owner@example.test'],
    [friend, 'friend@example.test'],
    [outsider, 'outsider@example.test'],
  ])
    await query('insert into auth.users values($1,$2,$3)', [id, email, '2026-11-01T12:00:00Z']);
  await db.exec('set role service_role');
  await query('select public.beta_bootstrap_owner($1)', [owner]);
  await query('select public.beta_manage_access($1,$2,true)', [owner, 'friend@example.test']);
  let w = assistantWorkspace();
  w.items[0].photos = [`${owner}/55555555-5555-4555-8555-555555555555.jpg`];
  w = applyCommand(w, {
    type: 'order',
    value: orderSchema.parse({
      id: crypto.randomUUID(),
      marketplace: 'Vinted',
      externalId: 'RETAINED-SALE',
      date: '2026-11-08T12:00:00Z',
      showId: null,
      lines: [{ itemId: w.items[0].id, price: 3500, costBasis: 1200 }],
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
      provenance: 'Retained owner record',
      importKey: '',
    }),
  });
  await query('select public.commit_workspace($1,0,$2::jsonb)', [owner, JSON.stringify(w)]);
  preserved = (await query<{ w: unknown }>('select public.load_workspace($1) as w', [owner]))[0].w;
  await db.exec('reset role');
  await db.exec(
    await readFile(
      new URL('../supabase/migrations/202611130001_assistant_conversations.sql', import.meta.url),
      'utf8',
    ),
  );
  await db.exec('set role service_role');
});
afterAll(async () => {
  await db?.close();
});
it('adds optional persistent conversations to schema 6 without changing existing owner inventory, photos, sales or financials', async () => {
  expect(
    (await query<{ w: unknown }>('select public.load_workspace($1) as w', [owner]))[0].w,
  ).toEqual(preserved);
  expect(
    (await query<{ v: { schemaVersion: number } }>('select public.verify_thrift_log() as v'))[0].v
      .schemaVersion,
  ).toBe(6);
  const state = await rpc<{ revision: number; messages: unknown[] }>('load', owner);
  expect(state.revision).toBe(0);
  expect(state.messages).toEqual([]);
});
it('blocks all direct client reads and RPC access, including authenticated owners and testers', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    for (const statement of [
      'select * from thrift_log_private.assistant_conversations',
      `select public.assistant_chat('load','${owner}')`,
      `select public.assistant_chat('clear','${friend}','{"revision":0}')`,
    ])
      await expect(query(statement)).rejects.toThrow('permission denied');
  }
  await db.exec('reset role;set role service_role');
  await expect(rpc('load', outsider)).rejects.toThrow('workspace_access_denied');
  expect(
    (
      await query<{ v: boolean }>(
        "select relrowsecurity as v from pg_class where oid='thrift_log_private.assistant_conversations'::regclass",
      )
    )[0].v,
  ).toBe(true);
});
it('persists separate histories, replays identical retries, and rejects changed input under an existing turn ID', async () => {
  const turn = await start(owner);
  const saved = await finish(owner, turn);
  expect(saved.revision).toBe(1);
  expect(saved.messages).toHaveLength(2);
  expect((await rpc<{ messages: unknown[] }>('load', friend)).messages).toEqual([]);
  const replay = await rpc<{ replayed: boolean; response: unknown }>('claim', owner, {
    requestId: turn.requestId,
    inputHash: turn.inputHash,
    revision: 0,
  });
  expect(replay.replayed).toBe(true);
  expect(replay.response).toEqual(response);
  await expect(
    rpc('claim', owner, { requestId: turn.requestId, inputHash: 'b'.repeat(64), revision: 1 }),
  ).rejects.toThrow('turn_changed');
});
it('serializes concurrent turns, rejects stale revisions and clears only the owned conversation without resetting business records', async () => {
  const turn = await start(friend);
  await expect(start(friend)).rejects.toThrow('busy');
  await expect(
    rpc('cancel', friend, { requestId: turn.requestId, lease: crypto.randomUUID() }),
  ).rejects.toThrow('stale_turn');
  await finish(friend, turn);
  await expect(start(friend, 0)).rejects.toThrow('context_changed');
  const cleared = await rpc<{ revision: number; messages: unknown[] }>('clear', friend, {
    revision: 1,
  });
  expect(cleared.messages).toEqual([]);
  expect(cleared.revision).toBe(2);
  expect((await rpc<{ messages: unknown[] }>('load', owner)).messages).toHaveLength(2);
  expect(
    (await query<{ w: unknown }>('select public.load_workspace($1) as w', [owner]))[0].w,
  ).toEqual(preserved);
});
it('revocation denies history reads and late model completion while retaining the user’s records', async () => {
  const turn = await start(friend, 2);
  await query('select public.beta_manage_access($1,$2,false)', [owner, 'friend@example.test']);
  await expect(rpc('load', friend)).rejects.toThrow('workspace_access_denied');
  await expect(finish(friend, turn)).rejects.toThrow('workspace_access_denied');
  await query('select public.beta_manage_access($1,$2,true)', [owner, 'friend@example.test']);
  await rpc('cancel', friend, { requestId: turn.requestId, lease: turn.lease });
  expect((await rpc<{ revision: number }>('load', friend)).revision).toBe(2);
});
it('enforces a shared durable rate limit, bounded context, and stale-lease protection after Clear chat', async () => {
  await query(
    "update thrift_log_private.assistant_conversations set rate_start=now()-interval '2 minutes' where user_id=$1",
    [friend],
  );
  let revision = 2;
  for (let i = 0; i < 10; i++) {
    const turn = await start(friend, revision);
    revision = (await finish(friend, turn)).revision;
  }
  await expect(start(friend, revision)).rejects.toThrow('rate_limit');
  await rpc('clear', friend, { revision });
  await expect(start(friend, revision + 1)).rejects.toThrow('rate_limit');
  await query(
    "update thrift_log_private.assistant_conversations set rate_start=now()-interval '2 minutes' where user_id=$1",
    [friend],
  );
  const turn = await start(friend, revision + 1);
  await rpc('clear', friend, { revision: revision + 1 });
  await expect(finish(friend, turn)).rejects.toThrow('stale_turn');
});
it('also preserves schema-7 registration and existing accounts when the registration migration is present', async () => {
  await db.exec('reset role');
  await db.exec(
    await readFile(
      new URL('../supabase/migrations/202611110002_beta_registration.sql', import.meta.url),
      'utf8',
    ),
  );
  await db.exec('set role service_role');
  const checks = (
    await query<{ v: { schemaVersion: number; betaRegistration: boolean; rlsEnabled: boolean } }>(
      'select public.verify_thrift_log() as v',
    )
  )[0].v;
  expect(checks).toMatchObject({ schemaVersion: 7, betaRegistration: true, rlsEnabled: true });
  expect(
    (await query<{ w: unknown }>('select public.load_workspace($1) as w', [owner]))[0].w,
  ).toEqual(preserved);
});

async function fileRpc<T = unknown>(action: string, id: string, data: unknown = {}) {
  return (
    await query<{ v: T }>('select public.assistant_file($1,$2,$3::jsonb) as v', [
      action,
      id,
      JSON.stringify(data),
    ])
  )[0].v;
}
it('isolates retained attachment identities, denies direct access, and blocks revoked file requests without deleting sources', async () => {
  const id = crypto.randomUUID(),
    data = {
      id,
      name: 'private.csv',
      mime: 'text/csv',
      size: 20,
      hash: 'a'.repeat(64),
      path: `${friend}/injected.csv`,
    };
  const saved = await fileRpc<{ path: string }>('create', owner, data);
  expect(saved.path).toBe(`${owner}/${id}.csv`);
  expect(await fileRpc('list', friend, { ids: [id] })).toEqual([]);
  expect(await fileRpc('create', owner, data)).toEqual(saved);
  await expect(fileRpc('create', owner, { ...data, hash: 'b'.repeat(64) })).rejects.toThrow(
    'identity_changed',
  );
  await fileRpc('delete', friend, { ids: [id] });
  expect(await fileRpc('list', owner, { ids: [id] })).toHaveLength(1);
  await query('select public.beta_manage_access($1,$2,false)', [owner, 'friend@example.test']);
  await expect(fileRpc('list', friend)).rejects.toThrow('workspace_access_denied');
  await query('select public.beta_manage_access($1,$2,true)', [owner, 'friend@example.test']);
  await db.exec('set role authenticated');
  await expect(query('select * from thrift_log_private.assistant_files')).rejects.toThrow(
    'permission denied',
  );
  await expect(query(`select public.assistant_file('list','${owner}')`)).rejects.toThrow(
    'permission denied',
  );
  await db.exec('reset role;set role service_role');
});
it('retains the last completed draft checkpoint after a failed turn', async () => {
  const revision = (await rpc<{ revision: number }>('load', owner)).revision;
  const turn = await start(owner, revision);
  expect((await rpc<{ response: unknown }>('load', owner)).response).toEqual(response);
  await rpc('cancel', owner, { requestId: turn.requestId, lease: turn.lease });
  expect((await rpc<{ response: unknown }>('load', owner)).response).toEqual(response);
});
it('denies direct assistant storage even with a permissive policy, preserving the existing inventory photo proxy restriction', async () => {
  await db.exec('reset role');
  await query('insert into storage.objects values($1,$2,$3)', [
    crypto.randomUUID(),
    'assistant-files',
    `${owner}/private.csv`,
  ]);
  await query('insert into storage.objects values($1,$2,$3)', [
    crypto.randomUUID(),
    'inventory-photos',
    `${owner}/55555555-5555-4555-8555-555555555555.jpg`,
  ]);
  await db.exec(
    'create policy accidental_test_allow on storage.objects for select to authenticated using(true);set role authenticated',
  );
  const rows = await query<{ bucket_id: string }>('select * from storage.objects');
  expect(rows).toEqual([]);
  await db.exec(
    'reset role;drop policy accidental_test_allow on storage.objects;set role service_role',
  );
});
it('fails closed if private file security is misconfigured and preserves all owner business records', async () => {
  await db.exec(
    "reset role;update storage.buckets set public=true where id='assistant-files';set role service_role",
  );
  await expect(rpc('load', owner)).rejects.toThrow('security_not_ready');
  await expect(fileRpc('list', owner)).rejects.toThrow('security_not_ready');
  await db.exec(
    "reset role;update storage.buckets set public=false where id='assistant-files';grant select on thrift_log_private.assistant_files to authenticated;set role service_role",
  );
  await expect(fileRpc('list', owner)).rejects.toThrow('security_not_ready');
  await db.exec(
    'reset role;revoke select on thrift_log_private.assistant_files from authenticated;set role service_role',
  );
  expect(
    (await query<{ v: boolean }>('select thrift_log_private.assistant_ready() as v'))[0].v,
  ).toBe(true);
  expect(
    (await query<{ w: unknown }>('select public.load_workspace($1) as w', [owner]))[0].w,
  ).toEqual(preserved);
});
it('bounds persistent context to forty messages and rejects malformed or expired completions', async () => {
  let revision = (await rpc<{ revision: number }>('load', owner)).revision;
  for (let i = 0; i < 21; i++) {
    if (i % 10 === 0)
      await query(
        "update thrift_log_private.assistant_conversations set rate_start=now()-interval '2 minutes' where user_id=$1",
        [owner],
      );
    revision = (await finish(owner, await start(owner, revision))).revision;
  }
  const loaded = await rpc<{ messages: unknown[] }>('load', owner);
  expect(loaded.messages).toHaveLength(40);
  const turn = await start(owner, revision);
  await expect(
    rpc('finish', owner, {
      ...turn,
      messages: [{ text: 'Missing role' }, { role: 'assistant', text: 'Unsafe' }],
      response,
    }),
  ).rejects.toThrow('invalid_assistant_response');
  await query(
    "update thrift_log_private.assistant_conversations set lease_until=now()-interval '1 second' where user_id=$1",
    [owner],
  );
  await expect(finish(owner, turn)).rejects.toThrow('stale_turn');
  await rpc('cancel', owner, { requestId: turn.requestId, lease: turn.lease });
  expect((await rpc<{ revision: number }>('load', owner)).revision).toBe(revision);
});
it('defends against accidental client RPC grants and a weakened private-storage policy', async () => {
  await db.exec(
    'reset role;grant execute on function public.assistant_chat(text,uuid,jsonb) to authenticated;grant execute on function public.assistant_file(text,uuid,jsonb) to authenticated;set role authenticated',
  );
  await expect(rpc('load', owner)).rejects.toThrow(/workspace_access_denied|permission denied/);
  await expect(fileRpc('list', owner)).rejects.toThrow(/workspace_access_denied|permission denied/);
  await db.exec(
    'reset role;revoke execute on function public.assistant_chat(text,uuid,jsonb) from authenticated;revoke execute on function public.assistant_file(text,uuid,jsonb) from authenticated;alter policy assistant_files_server_only on storage.objects using(true) with check(true);set role service_role',
  );
  await expect(fileRpc('list', owner)).rejects.toThrow('security_not_ready');
  await db.exec(
    "reset role;alter policy assistant_files_server_only on storage.objects using(bucket_id<>'assistant-files') with check(bucket_id<>'assistant-files');set role service_role",
  );
  expect(
    (await query<{ v: boolean }>('select thrift_log_private.assistant_ready() as v'))[0].v,
  ).toBe(true);
});
