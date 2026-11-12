import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { emptyWorkspace } from '../src/lib/model';
import { assistantWorkspace } from './helpers/assistant';
import { applyCommand } from '../src/lib/commands';
import { orderSchema } from '../src/lib/model';
import { metrics } from '../src/lib/finance';
import { applyPipelineMove, type PipelineMove } from '../src/lib/pipeline-moves';
import { inventoryPipeline } from '../src/lib/pipeline';
let db: PGlite;
const owner = '11111111-1111-4111-8111-111111111111';
const tester = '22222222-2222-4222-8222-222222222222';
const stranger = '33333333-3333-4333-8333-333333333333';
const unverified = '44444444-4444-4444-8444-444444444444';
const tables = [
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
const authStorageFixture = `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text unique,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create schema storage;grant usage on schema storage to authenticated,service_role;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key,bucket_id text,name text);alter table storage.objects enable row level security;grant select on storage.objects to authenticated;grant select on storage.buckets to service_role;`;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(authStorageFixture);
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
  for (const [id, email, verified] of [
    [owner, 'owner@example.test', true],
    [tester, 'tester@example.test', true],
    [stranger, 'stranger@example.test', true],
    [unverified, 'unverified@example.test', false],
  ] as const)
    await db.query('insert into auth.users values($1,$2,$3)', [
      id,
      email,
      verified ? '2026-11-01T12:00:00Z' : null,
    ]);
  await db.exec('set role service_role');
  await db.query('select public.beta_bootstrap_owner($1)', [owner]);
});
afterAll(async () => {
  await db?.close();
});
async function actor(id: string, action: () => Promise<void>) {
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${id}'`);
  try {
    await action();
  } finally {
    await db.exec('reset role;set role service_role');
  }
}
it('allows only approved, verified, bound Auth identities; bootstraps exactly one protected owner', async () => {
  expect(
    (await db.query<{ role: string }>('select public.beta_check_access($1) as role', [owner]))
      .rows[0].role,
  ).toBe('owner');
  for (const id of [tester, stranger, unverified])
    expect(
      (await db.query<{ role: string | null }>('select public.beta_check_access($1) as role', [id]))
        .rows[0].role,
    ).toBeNull();
  await db.query('select public.beta_manage_access($1,$2,true)', [owner, ' TESTER@example.test ']);
  await db.query('select public.beta_manage_access($1,$2,true)', [
    owner,
    'unverified@example.test',
  ]);
  expect(
    (await db.query<{ role: string }>('select public.beta_check_access($1) as role', [tester]))
      .rows[0].role,
  ).toBe('tester');
  expect(
    (await db.query<{ role: null }>('select public.beta_check_access($1) as role', [unverified]))
      .rows[0].role,
  ).toBeNull();
  await expect(db.query('select public.beta_bootstrap_owner($1)', [tester])).rejects.toThrow(
    'owner_already_configured',
  );
  await expect(
    db.query('select public.beta_manage_access($1,$2,false)', [owner, 'owner@example.test']),
  ).rejects.toThrow('owner_access_protected');
  await expect(
    db.query('select public.beta_manage_access($1,$2,true)', [tester, 'stranger@example.test']),
  ).rejects.toThrow('owner_required');
});
it('round-trips separate workspaces with identical business IDs, SKUs and listing IDs without leaking data', async () => {
  let a = assistantWorkspace(),
    b = assistantWorkspace();
  b.items[0].title = 'Tester private jacket';
  b.items[0].cost = 900;
  function sold(w: typeof a, price: number) {
    const orderId = '55555555-5555-4555-8555-555555555555';
    w = applyCommand(w, {
      type: 'order',
      value: orderSchema.parse({
        id: orderId,
        marketplace: 'Vinted',
        externalId: 'SAME-SALE-ID',
        date: '2026-11-01T12:00:00Z',
        lines: [{ itemId: w.items[0].id, price, costBasis: w.items[0].cost }],
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
    });
    return applyCommand(w, {
      type: 'financialEvent',
      value: {
        id: '66666666-6666-4666-8666-666666666666',
        orderId,
        date: '2026-11-02T12:00:00Z',
        kind: 'Fee adjustment',
        amount: -100,
        itemIds: [],
        reason: 'Test fee credit',
        externalId: 'SAME-CREDIT',
        reversesId: null,
        category: 'Other',
      },
    });
  }
  a = sold(a, 3500);
  b = sold(b, 2700);
  await db.query('select public.commit_workspace($1,0,$2::jsonb)', [
    owner,
    JSON.stringify({ ...a, financialEvents: [] }),
  ]);
  await db.query('select public.commit_workspace($1,0,$2::jsonb)', [
    tester,
    JSON.stringify({ ...b, financialEvents: [] }),
  ]);
  await db.query('select public.commit_workspace($1,1,$2::jsonb)', [owner, JSON.stringify(a)]);
  await db.query('select public.commit_workspace($1,1,$2::jsonb)', [tester, JSON.stringify(b)]);
  for (const [id, title, cost] of [
    [owner, a.items[0].title, 1200],
    [tester, 'Tester private jacket', 900],
  ] as const) {
    const result = (await db.query<{ w: typeof a }>('select public.load_workspace($1) as w', [id]))
      .rows[0].w;
    expect(result.items[0]).toMatchObject({ title, cost });
    expect(metrics(result).revenue).toBe(id === owner ? 3500 : 2700);
    expect(metrics(result).profit).toBe(id === owner ? 2200 : 1700);
    await actor(id, async () => {
      const items = (
        await db.query<{ user_id: string; title: string }>('select user_id,title from public.items')
      ).rows;
      expect(items).toEqual([{ user_id: id, title }]);
      expect((await db.query('select * from public.listings')).rows).toHaveLength(2);
      expect((await db.query('select * from public.orders')).rows).toHaveLength(1);
      expect((await db.query('select * from public.financial_events')).rows).toHaveLength(1);
      for (const table of tables) {
        const others = (await db.query(`select * from public.${table} where user_id<>$1`, [id]))
          .rows;
        expect(others, table).toHaveLength(0);
        await expect(
          db.query(`delete from public.${table} where user_id=$1`, [id]),
        ).rejects.toThrow('permission denied');
      }
      await expect(
        db.query('select public.load_workspace($1)', [id === owner ? tester : owner]),
      ).rejects.toThrow('permission denied');
      await expect(
        db.query('select public.beta_manage_access($1,$2,true)', [owner, 'hacker@example.test']),
      ).rejects.toThrow('permission denied');
      await expect(db.query('select * from thrift_log_private.beta_access')).rejects.toThrow(
        'permission denied',
      );
    });
  }
  await expect(
    db.query('select public.commit_workspace($1,0,$2::jsonb)', [
      stranger,
      JSON.stringify(emptyWorkspace()),
    ]),
  ).rejects.toThrow('workspace_access_denied');
});
it('blocks cross-workspace foreign item references even at the SQL commit boundary', async () => {
  const itemId = crypto.randomUUID();
  const a = (
    await db.query<{ w: ReturnType<typeof assistantWorkspace> }>(
      'select public.load_workspace($1) as w',
      [owner],
    )
  ).rows[0].w;
  a.items.push({ ...a.items[0], id: itemId, sku: 'OWNER-ONLY', status: 'Purchased' });
  await db.query('select public.commit_workspace($1,2,$2::jsonb)', [owner, JSON.stringify(a)]);
  const b = (
    await db.query<{ w: ReturnType<typeof assistantWorkspace> }>(
      'select public.load_workspace($1) as w',
      [tester],
    )
  ).rows[0].w;
  b.listings[0].itemId = itemId;
  await expect(
    db.query('select public.commit_workspace($1,2,$2::jsonb)', [tester, JSON.stringify(b)]),
  ).rejects.toThrow();
  expect(
    (
      await db.query<{ w: ReturnType<typeof assistantWorkspace> }>(
        'select public.load_workspace($1) as w',
        [tester],
      )
    ).rows[0].w.revision,
  ).toBe(2);
});
it('applies live revocation to RLS, Storage and service RPCs without deleting any records; reactivation restores the same workspace', async () => {
  await db.exec('reset role');
  await db.query(
    "insert into storage.objects values($1,'inventory-photos',$2),($3,'inventory-photos',$4)",
    [crypto.randomUUID(), `${owner}/photo.png`, crypto.randomUUID(), `${tester}/photo.png`],
  );
  await db.exec('set role service_role');
  await actor(tester, async () => {
    expect((await db.query<{ name: string }>('select name from storage.objects')).rows).toEqual([]);
  });
  await db.query('select public.beta_manage_access($1,$2,false)', [owner, 'tester@example.test']);
  expect(
    (await db.query<{ role: null }>('select public.beta_check_access($1) as role', [tester]))
      .rows[0].role,
  ).toBeNull();
  await actor(tester, async () => {
    for (const table of tables)
      expect((await db.query(`select * from public.${table}`)).rows, table).toHaveLength(0);
    expect((await db.query('select * from storage.objects')).rows).toHaveLength(0);
  });
  await expect(db.query('select public.load_workspace($1)', [tester])).rejects.toThrow(
    'workspace_access_denied',
  );
  await expect(
    db.query('select public.commit_workspace($1,1,$2::jsonb)', [
      tester,
      JSON.stringify(emptyWorkspace()),
    ]),
  ).rejects.toThrow('workspace_access_denied');
  expect(
    (await db.query('select * from public.items where user_id=$1', [tester])).rows,
  ).toHaveLength(1);
  await db.query('select public.beta_manage_access($1,$2,true)', [owner, 'tester@example.test']);
  expect(
    (
      await db.query<{ w: ReturnType<typeof assistantWorkspace> }>(
        'select public.load_workspace($1) as w',
        [tester],
      )
    ).rows[0].w.items[0].title,
  ).toBe('Tester private jacket');
});
it('binds later-created invitees only after email verification and does not transfer authorization on an email change', async () => {
  await db.query('select public.beta_manage_access($1,$2,true)', [owner, 'future@example.test']);
  const id = crypto.randomUUID();
  await db.exec('reset role');
  await db.query('insert into auth.users values($1,$2,null)', [id, 'future@example.test']);
  await db.exec('set role service_role');
  expect(
    (await db.query<{ role: null }>('select public.beta_check_access($1) as role', [id])).rows[0]
      .role,
  ).toBeNull();
  await db.exec('reset role');
  await db.query('update auth.users set email_confirmed_at=now() where id=$1', [id]);
  await db.exec('set role service_role');
  expect(
    (await db.query<{ role: string }>('select public.beta_check_access($1) as role', [id])).rows[0]
      .role,
  ).toBe('tester');
  await db.exec('reset role');
  await db.query('update auth.users set email=$1 where id=$2', ['changed@example.test', id]);
  await db.exec('set role service_role');
  expect(
    (await db.query<{ role: null }>('select public.beta_check_access($1) as role', [id])).rows[0]
      .role,
  ).toBeNull();
  await actor(id, async () => {
    expect(
      (await db.query<{ allowed: boolean }>('select public.beta_has_access() as allowed')).rows[0]
        .allowed,
    ).toBe(false);
  });
});
it('reports schema 6 while keeping RLS, RPC grants and public registration safeguards', async () => {
  const checks = (
    await db.query<{ checks: Record<string, unknown> }>(
      'select public.verify_thrift_log() as checks',
    )
  ).rows[0].checks;
  expect(checks).toMatchObject({
    schemaVersion: 6,
    inviteOnlyBeta: true,
    rlsEnabled: true,
    clientWritesBlocked: true,
    privatePhotosBucket: true,
    serverRpcRestricted: true,
  });
  await db.exec('set role anon');
  try {
    await expect(db.query('select public.beta_check_access($1)', [owner])).rejects.toThrow(
      'permission denied',
    );
    await expect(db.query('select public.beta_bootstrap_owner($1)', [tester])).rejects.toThrow(
      'permission denied',
    );
  } finally {
    await db.exec('reset role;set role service_role');
  }
  const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  expect(config.match(/enable_signup = false/g)).toHaveLength(2);
});

it('preserves an existing owner workspace and every business-table row count across the beta migration and bootstrap', async () => {
  const legacy = new PGlite();
  try {
    await legacy.exec(authStorageFixture);
    for (const file of [
      '202611090001_initial.sql',
      '202611090002_auth_storage_hardening.sql',
      '202611090003_financial_ledger_shipments.sql',
      '20261109203443_inventory_pipeline_fulfillment.sql',
      '202611100001_pipeline_operational_corrections.sql',
    ])
      await legacy.exec(
        await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'),
      );
    await legacy.query('insert into auth.users values($1,$2,now())', [owner, 'owner@example.test']);
    const { demoWorkspace } = await import('../src/lib/demo');
    await legacy.query('select public.commit_workspace($1,0,$2::jsonb)', [
      owner,
      JSON.stringify(demoWorkspace()),
    ]);
    const before = (
      await legacy.query<{ w: unknown }>('select public.load_workspace($1) as w', [owner])
    ).rows[0].w;
    const counts: Record<string, number> = {};
    for (const table of tables)
      counts[table] = (
        await legacy.query<{ n: number }>(
          `select count(*)::int as n from public.${table} where user_id=$1`,
          [owner],
        )
      ).rows[0].n;
    await legacy.exec(
      await readFile(
        new URL('../supabase/migrations/202611110001_invite_only_beta.sql', import.meta.url),
        'utf8',
      ),
    );
    await legacy.exec('set role service_role');
    await expect(legacy.query('select public.load_workspace($1)', [owner])).rejects.toThrow(
      'workspace_access_denied',
    );
    const bootstrap = await readFile(
      new URL('../supabase/bootstrap_beta_owner.sql', import.meta.url),
      'utf8',
    );
    await legacy.exec('reset role');
    await expect(
      legacy.exec(bootstrap.replace("'REPLACE_WITH_OWNER_EMAIL'", "'missing@example.test'")),
    ).rejects.toThrow('Existing verified owner not found');
    await legacy.exec('rollback');
    await legacy.exec(bootstrap.replace("'REPLACE_WITH_OWNER_EMAIL'", "'owner@example.test'"));
    await legacy.exec('set role service_role');
    const after = (
      await legacy.query<{ w: unknown }>('select public.load_workspace($1) as w', [owner])
    ).rows[0].w;
    expect(after).toEqual(before);
    for (const table of tables)
      expect(
        (
          await legacy.query<{ n: number }>(
            `select count(*)::int as n from public.${table} where user_id=$1`,
            [owner],
          )
        ).rows[0].n,
        table,
      ).toBe(counts[table]);
  } finally {
    await legacy.close();
  }
});

it('keeps posted money and confirmations immutable while allowing only operational item fulfillment corrections', async () => {
  const w = (
    await db.query<{ w: ReturnType<typeof assistantWorkspace> }>(
      'select public.load_workspace($1) as w',
      [tester],
    )
  ).rows[0].w;
  for (const field of ['fees', 'amountsConfirmed'] as const) {
    const changed = structuredClone(w);
    if (field === 'fees') changed.orders[0].fees++;
    else changed.orders[0].amountsConfirmed = false;
    await expect(
      db.query('select public.commit_workspace($1,$2,$3::jsonb)', [
        tester,
        w.revision,
        JSON.stringify(changed),
      ]),
    ).rejects.toThrow('financial_basis_immutable');
  }
  const operational = structuredClone(w);
  operational.orders[0].fulfillment = 'Shipped';
  operational.orders[0].itemFulfillments = [
    { itemId: w.items[0].id, status: 'Shipped', date: '2026-11-10T12:00:00Z' },
  ];
  await db.query('select public.commit_workspace($1,$2,$3::jsonb)', [
    tester,
    w.revision,
    JSON.stringify(operational),
  ]);
  const after = (await db.query<{ w: typeof w }>('select public.load_workspace($1) as w', [tester]))
    .rows[0].w;
  expect(after.orders[0].itemFulfillments).toEqual(operational.orders[0].itemFulfillments);
  expect(after.orders[0].lines).toEqual(w.orders[0].lines);
  expect(after.orders[0].fees).toBe(w.orders[0].fees);
  expect(after.financialEvents).toEqual(w.financialEvents);
  expect(metrics(after).profit).toBe(metrics(w).profit);
});

it('persists bulk pipeline sales, fulfillment and reversals through the real tenant-scoped SQL transaction without deleting history', async () => {
  const read = async () =>
    (
      await db.query<{ w: ReturnType<typeof assistantWorkspace> }>(
        'select public.load_workspace($1) as w',
        [tester],
      )
    ).rows[0].w;
  const original = await read();
  const originalRevenue = metrics(original).revenue;
  const originalProfit = metrics(original).profit;
  let w = original;
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  for (const [index, id] of ids.entries())
    w = applyCommand(w, {
      type: 'item',
      value: {
        ...assistantWorkspace().items[0],
        id,
        sku: `PIPE-SQL-${index}`,
        status: 'Ready to List',
        photos: [],
      },
    });
  await db.query('select public.commit_workspace($1,$2,$3::jsonb)', [
    tester,
    original.revision,
    JSON.stringify(w),
  ]);
  w = await read();
  const move = async (destination: PipelineMove['destination']) => {
    const request: PipelineMove = {
      id: crypto.randomUUID(),
      revision: w.revision,
      destination,
      date: '2026-11-12T12:00:00Z',
      confirmConsequences: true,
      items: ids.map((itemId) => ({
        itemId,
        sale: {
          marketplace: 'Vinted',
          date: '2026-11-11T12:00:00Z',
          price: 3000,
          purchaseCost: 1200,
          fees: 200,
          processing: 0,
          shipping: 0,
          shippingCollected: 0,
          discount: 0,
          other: 0,
        },
      })),
    };
    const result = await applyPipelineMove(w, request);
    expect(result.failures).toEqual([]);
    expect(result.successIds).toHaveLength(2);
    await db.query('select public.commit_workspace($1,$2,$3::jsonb)', [
      tester,
      w.revision,
      JSON.stringify(result.workspace),
    ]);
    w = await read();
    expect((await applyPipelineMove(w, request)).replayed).toBe(true);
  };
  await move('sold');
  expect(metrics(w).revenue).toBe(originalRevenue + 6000);
  expect(metrics(w).profit).toBe(originalProfit + 3200);
  expect(w.orders.filter((o) => o.lines.some((l) => ids.includes(l.itemId)))).toHaveLength(2);
  await move('shipped');
  expect(
    inventoryPipeline(w).groups.shipped.entries.filter((e) => ids.includes(e.item.id)),
  ).toHaveLength(2);
  await move('sold');
  await move('unlisted');
  expect(
    inventoryPipeline(w).groups.unlisted.entries.filter((e) => ids.includes(e.item.id)),
  ).toHaveLength(2);
  expect(metrics(w).revenue).toBe(originalRevenue);
  expect(metrics(w).profit).toBe(originalProfit);
  expect(w.orders.filter((o) => o.lines.some((l) => ids.includes(l.itemId)))).toHaveLength(2);
  expect(w.items).toHaveLength(original.items.length + 2);
  expect(w.imports.filter((r) => r.mapping.format === 'pipeline-v1')).toHaveLength(4);
});

it('stores optional-cost sale history through the real SQL transaction while preserving the owner workspace and tenant isolation', async () => {
  const { historyCsvSources, historyMapping } = await import('../src/lib/assistant/csv-history');
  const { createHistoryBatch, historyCommands } = await import('../src/lib/assistant/history');
  const { readCsv } = await import('../src/lib/csv');
  const load = async (id: string) =>
    (
      await db.query<{ w: ReturnType<typeof emptyWorkspace> }>(
        'select public.load_workspace($1) as w',
        [id],
      )
    ).rows[0].w;
  const ownerBefore = await load(owner),
    testerBefore = await load(tester);
  const unique = crypto.randomUUID();
  const csv = `Name,Price,Date,Fees,Purchase cost\nHistory-${unique},25,2026-11-11,1,\nKnown-${unique},30,2026-11-11,2,0`;
  const parsed = readCsv(csv);
  const batch = createHistoryBatch(
    await historyCsvSources(csv, 'history.csv', {
      mapping: historyMapping(parsed.columns),
      marketplace: 'Depop',
      dateFormat: 'auto',
    }),
    testerBefore,
  );
  const next = historyCommands(
    testerBefore,
    batch,
    batch.rows.map((r) => r.id),
  ).reduce(applyCommand, testerBefore);
  await db.query('select public.commit_workspace($1,$2,$3::jsonb)', [
    tester,
    testerBefore.revision,
    JSON.stringify(next),
  ]);
  const restored = await load(tester);
  expect(restored.orders).toHaveLength(testerBefore.orders.length + 2);
  expect(restored.items).toHaveLength(testerBefore.items.length + 2);
  expect(metrics(restored).unknownCosts).toBe(1);
  expect(
    restored.imports
      .filter((r) => r.mapping.history === 'true')
      .map((r) => JSON.parse(r.rawCsv).unknownCostItemIds.length),
  ).toEqual([1, 0]);
  expect(await load(owner)).toEqual(ownerBefore);
  await actor(owner, async () => {
    expect(
      (await db.query('select id from public.orders where id=$1', [batch.rows[0].id])).rows,
    ).toHaveLength(0);
  });
});
