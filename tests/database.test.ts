import { matchInventory } from '../src/lib/assistant/matching';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { demoWorkspace } from '../src/lib/demo';
import { workspaceSchema } from '../src/lib/model';
let db: PGlite;
const user = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create schema storage;grant usage on schema storage to authenticated,service_role;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key,bucket_id text,name text);alter table storage.objects enable row level security;grant select on storage.objects to authenticated;grant select on storage.buckets to service_role;insert into auth.users values('${user}'),('${other}');`,
  );
  await db.exec(
    await readFile(
      new URL('../supabase/migrations/202611090001_initial.sql', import.meta.url),
      'utf8',
    ),
  );
  await db.exec(
    await readFile(
      new URL('../supabase/migrations/202611090002_auth_storage_hardening.sql', import.meta.url),
      'utf8',
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        '../supabase/migrations/202611090003_financial_ledger_shipments.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        '../supabase/migrations/20261109203443_inventory_pipeline_fulfillment.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  );
});
afterAll(async () => {
  await db?.close();
});
it('applies the complete migration and round-trips related records', async () => {
  const w = demoWorkspace();
  const saved = await db.query<{ revision: number }>(
    'select public.commit_workspace($1,0,$2::jsonb) as revision',
    [user, JSON.stringify(w)],
  );
  expect(saved.rows[0].revision).toBe(1);
  const result = await db.query<{ workspace: unknown }>(
    'select public.load_workspace($1) as workspace',
    [user],
  );
  const loaded = workspaceSchema.parse(result.rows[0].workspace);
  expect(loaded.items).toHaveLength(24);
  expect(loaded.orders).toHaveLength(14);
  expect(loaded.orders[0].lines).toHaveLength(1);
  expect(
    (await db.query<{ count: number }>('select count(*)::int as count from public.financial_audit'))
      .rows[0].count,
  ).toBe(28);
});
it('rejects stale revisions atomically', async () => {
  await expect(
    db.query('select public.commit_workspace($1,0,$2::jsonb)', [
      user,
      JSON.stringify(demoWorkspace()),
    ]),
  ).rejects.toThrow('revision_conflict');
  expect(
    (
      await db.query<{ revision: number }>(
        'select revision from public.workspaces where user_id=$1',
        [user],
      )
    ).rows[0].revision,
  ).toBe(1);
});
it('enforces RLS and blocks direct authenticated writes and RPC access', async () => {
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${other}';`);
  expect((await db.query('select * from public.items')).rows).toHaveLength(0);
  await expect(db.query('select public.load_workspace($1)', [user])).rejects.toThrow(
    'permission denied',
  );
  await expect(db.query('delete from public.items')).rejects.toThrow('permission denied');
  await db.exec('reset role');
});
it('rejects duplicate physical sales and rolls back financial history', async () => {
  const w = demoWorkspace();
  w.orders.push({ ...w.orders[0], id: crypto.randomUUID(), externalId: 'DUPLICATE' });
  await expect(
    db.query('select public.commit_workspace($1,1,$2::jsonb)', [user, JSON.stringify(w)]),
  ).rejects.toThrow('duplicate_physical_sale');
  expect(
    (await db.query<{ count: number }>('select count(*)::int as count from public.orders')).rows[0]
      .count,
  ).toBe(14);
});

it('verifies all application RLS and restricted RPC grants under the actual service role', async () => {
  await db.exec('set role service_role');
  try {
    const result = await db.query<{ checks: Record<string, unknown> }>(
      'select public.verify_thrift_log() as checks',
    );
    expect(result.rows[0].checks).toEqual({
      schemaVersion: 4,
      itemFulfillment: true,
      financialLedger: true,
      shipmentStorage: true,
      tablesPresent: true,
      rlsEnabled: true,
      clientWritesBlocked: true,
      privatePhotosBucket: true,
      serverRpcRestricted: true,
      privatePhotoReadPolicy: true,
    });
    const loaded = await db.query<{ workspace: unknown }>(
      'select public.load_workspace($1) as workspace',
      [user],
    );
    expect(workspaceSchema.parse(loaded.rows[0].workspace).items).toHaveLength(24);
  } finally {
    await db.exec('reset role');
  }
});
it('allows owner-only inventory photo reads and denies anonymous access', async () => {
  await db.query(
    "insert into storage.objects values($1,'inventory-photos',$2),($3,'inventory-photos',$4)",
    [crypto.randomUUID(), `${user}/test.png`, crypto.randomUUID(), `${other}/test.png`],
  );
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${user}';`);
  try {
    const result = await db.query<{ name: string }>('select name from storage.objects');
    expect(result.rows.map((r) => r.name)).toEqual([`${user}/test.png`]);
    await expect(db.query('select public.verify_thrift_log()')).rejects.toThrow(
      'permission denied',
    );
  } finally {
    await db.exec('reset role');
  }
  await db.exec('set role anon');
  try {
    await expect(db.query('select * from storage.objects')).rejects.toThrow('permission denied');
  } finally {
    await db.exec('reset role');
  }
});
it('isolates every business table from another authenticated account', async () => {
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${other}';`);
  try {
    for (const table of [
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
    ])
      expect((await db.query(`select * from public.${table}`)).rows, table).toHaveLength(0);
  } finally {
    await db.exec('reset role');
  }
});
it('round-trips a dated return and resale in one atomic transaction', async () => {
  const { applyCommand } = await import('../src/lib/commands');
  const result = await db.query<{ workspace: unknown }>(
    'select public.load_workspace($1) as workspace',
    [user],
  );
  let w = workspaceSchema.parse(result.rows[0].workspace);
  const rev = w.revision;
  const original = w.orders.find((o) => o.lines[0].itemId === w.items[0].id) || w.orders[0];
  const line = original.lines[0];
  const date = new Date().toISOString();
  w = applyCommand(w, {
    type: 'financialEvent',
    value: {
      id: '30000000-0000-4000-8000-000000000001',
      orderId: original.id,
      date,
      kind: 'Refund',
      amount: 100,
      itemIds: [line.itemId],
      reason: 'Test partial return',
      externalId: 'TEST-RETURN',
      reversesId: null,
      category: 'Other',
    },
  });
  w = applyCommand(w, {
    type: 'order',
    value: {
      ...original,
      id: '30000000-0000-4000-8000-000000000002',
      externalId: 'TEST-RESALE',
      date,
      lines: [{ ...line, price: 5000 }],
      refund: 0,
      feeCredit: 0,
      adjustment: 0,
      discount: 0,
    },
  });
  await db.exec('set role service_role');
  try {
    await db.query('select public.commit_workspace($1,$2,$3::jsonb)', [
      user,
      rev,
      JSON.stringify(w),
    ]);
  } finally {
    await db.exec('reset role');
  }
  const saved = workspaceSchema.parse(
    (
      await db.query<{ workspace: unknown }>('select public.load_workspace($1) as workspace', [
        user,
      ])
    ).rows[0].workspace,
  );
  expect(saved.financialEvents[0].itemIds).toEqual([line.itemId]);
  expect(saved.orders.some((o) => o.externalId === 'TEST-RESALE')).toBe(true);
  expect(saved.revision).toBe(rev + 1);
});
it('rejects edits to posted events and original financial bases at the database boundary', async () => {
  const w = workspaceSchema.parse(
    (
      await db.query<{ workspace: unknown }>('select public.load_workspace($1) as workspace', [
        user,
      ])
    ).rows[0].workspace,
  );
  const changed = structuredClone(w);
  changed.financialEvents[0].amount++;
  await expect(
    db.query('select public.commit_workspace($1,$2,$3::jsonb)', [
      user,
      w.revision,
      JSON.stringify(changed),
    ]),
  ).rejects.toThrow('posted_record_immutable');
  const changedOrder = structuredClone(w);
  changedOrder.orders.find((o) => o.id === w.financialEvents[0].orderId)!.lines[0].price++;
  await expect(
    db.query('select public.commit_workspace($1,$2,$3::jsonb)', [
      user,
      w.revision,
      JSON.stringify(changedOrder),
    ]),
  ).rejects.toThrow('financial_basis_immutable');
  expect(
    (
      await db.query<{ revision: number }>(
        'select revision from public.workspaces where user_id=$1',
        [user],
      )
    ).rows[0].revision,
  ).toBe(w.revision);
});
it('isolates the new ledger, receipt, and shipment tables with RLS', async () => {
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${other}';`);
  try {
    for (const table of [
      'financial_events',
      'payouts',
      'shipments',
      'financial_event_returns',
      'payout_allocations',
      'shipment_orders',
    ]) {
      expect((await db.query(`select * from public.${table}`)).rows, table).toHaveLength(0);
      await expect(db.query(`delete from public.${table}`)).rejects.toThrow('permission denied');
    }
  } finally {
    await db.exec('reset role');
  }
});

it('commits assistant-approved sales and provenance with the existing ledger and revision transaction', async () => {
  const { assistantWorkspace, extractedSale, extractedLine } = await import('./helpers/assistant');
  const { createBatch } = await import('../src/lib/assistant/drafts');
  const { approvalCommands, previewBatch } = await import('../src/lib/assistant/planner');
  const { applyCommand } = await import('../src/lib/commands');
  const { metrics } = await import('../src/lib/finance');
  const owner = '44444444-4444-4444-8444-444444444444';
  await db.query('insert into auth.users(id) values($1)', [owner]);
  const w = assistantWorkspace();
  const batch = createBatch(
    [
      {
        hash: 'a'.repeat(64),
        name: 'sale.png',
        extraction: {
          records: [extractedSale({ lines: [extractedLine({ listingId: 'listing-1' })] })],
          message: '',
        },
      },
    ],
    w,
  );
  const next = approvalCommands(w, batch, [batch.rows[0].id]).reduce(applyCommand, w);
  await db.query('select public.commit_workspace($1,0,$2::jsonb)', [owner, JSON.stringify(next)]);
  const loaded = workspaceSchema.parse(
    (await db.query<{ w: unknown }>('select public.load_workspace($1) as w', [owner])).rows[0].w,
  );
  expect(loaded.items).toHaveLength(1);
  expect(loaded.orders).toHaveLength(1);
  expect(loaded.imports[0].mapping.format).toBe('assistant-v1');
  expect(loaded.items[0].status).toBe('Sold');
  expect(loaded.listings.find((l) => l.marketplace === 'Depop')?.status).toBe('Needs delisting');
  expect(metrics(loaded, 0, Infinity).profit).toBe(2600);
  expect(previewBatch(loaded, batch)[0].ready).toBe(false);
  await expect(
    db.query('select public.commit_workspace($1,0,$2::jsonb)', [owner, JSON.stringify(next)]),
  ).rejects.toThrow('revision_conflict');
});

it('round-trips new assistant inventory and listings atomically without changing existing counts', async () => {
  const { assistantWorkspace, extractedSale, extractedLine } = await import('./helpers/assistant');
  const { createBatch } = await import('../src/lib/assistant/drafts');
  const { approvalCommands } = await import('../src/lib/assistant/planner');
  const { applyCommand } = await import('../src/lib/commands');
  const { listingMetrics } = await import('../src/lib/listing-metrics');
  const owner = '55555555-5555-4555-8555-555555555555';
  await db.query('insert into auth.users(id) values($1)', [owner]);
  const w = assistantWorkspace();
  const batch = createBatch(
    [
      {
        hash: 'b'.repeat(64),
        name: 'listing.png',
        extraction: {
          message: '',
          records: [
            extractedSale({
              kind: 'listing',
              status: 'active',
              lines: [extractedLine({ title: 'New boots', listingId: 'boots' })],
            }),
          ],
        },
      },
    ],
    w,
  );
  batch.rows[0].matches[0] = {
    itemId: null,
    confirmZeroCost: false,
    newItem: {
      id: crypto.randomUUID(),
      sku: 'NEW-BOOTS',
      cost: 1400,
      purchasedAt: '2026-10-01',
      confirmedDistinct: true,
    },
  };
  batch.rows[0].matches[0].dismissedCandidateIds = matchInventory(
    w,
    batch.rows[0].facts,
    batch.rows[0].facts.lines[0],
  ).map((c) => c.item.id);
  const next = approvalCommands(w, batch, [batch.rows[0].id]).reduce(applyCommand, w);
  await db.query('select public.commit_workspace($1,0,$2::jsonb)', [owner, JSON.stringify(next)]);
  const loaded = workspaceSchema.parse(
    (await db.query<{ w: unknown }>('select public.load_workspace($1) as w', [owner])).rows[0].w,
  );
  expect(listingMetrics(loaded)).toMatchObject({
    physicalItems: 2,
    inventoryCost: 2600,
    activeListings: 3,
  });
  expect(loaded.orders).toHaveLength(0);
});

it('persists partial item fulfillment and amount confirmation with the existing revision transaction', async () => {
  const { assistantWorkspace } = await import('./helpers/assistant');
  const { orderSchema } = await import('../src/lib/model');
  const { applyCommand } = await import('../src/lib/commands');
  const { setItemFulfillment } = await import('../src/lib/fulfillment-state');
  const { inventoryPipeline } = await import('../src/lib/pipeline');
  const owner = '66666666-6666-4666-8666-666666666666';
  await db.query('insert into auth.users(id) values($1)', [owner]);
  let w = assistantWorkspace();
  w.items.push({ ...w.items[0], id: crypto.randomUUID(), sku: 'SECOND' });
  const order = orderSchema.parse({
    id: crypto.randomUUID(),
    marketplace: 'Vinted',
    date: '2026-11-01T12:00:00Z',
    lines: w.items.map((i) => ({ itemId: i.id, price: 4500, costBasis: i.cost })),
    discount: 0,
    shippingCollected: 0,
    fees: 400,
    processing: 0,
    shipping: 300,
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
  });
  w = applyCommand(w, { type: 'order', value: order });
  w = applyCommand(w, {
    type: 'order',
    value: setItemFulfillment(w.orders[0], w.items[0].id, 'Shipped', '2026-11-02T12:00:00Z'),
  });
  await db.query('select public.commit_workspace($1,0,$2::jsonb)', [owner, JSON.stringify(w)]);
  const loaded = workspaceSchema.parse(
    (await db.query<{ w: unknown }>('select public.load_workspace($1) as w', [owner])).rows[0].w,
  );
  expect(loaded.orders[0].amountsConfirmed).toBe(true);
  expect(loaded.orders[0].itemFulfillments).toHaveLength(2);
  expect(inventoryPipeline(loaded).groups.sold.count).toBe(1);
  expect(inventoryPipeline(loaded).groups.shipped.count).toBe(1);
  const invalid = structuredClone(loaded);
  invalid.orders[0].itemFulfillments![0].itemId = crypto.randomUUID();
  await expect(
    db.query('select public.commit_workspace($1,1,$2::jsonb)', [owner, JSON.stringify(invalid)]),
  ).rejects.toThrow('invalid_item_fulfillment');
  const latest = workspaceSchema.parse(
    (await db.query<{ w: unknown }>('select public.load_workspace($1) as w', [owner])).rows[0].w,
  );
  expect(latest.revision).toBe(1);
  expect(latest.orders[0].itemFulfillments).toEqual(loaded.orders[0].itemFulfillments);
});

import { fiveUnknownListings } from './helpers/assistant';
import { approvalCommands } from '../src/lib/assistant/planner';
import { changeListingCost } from '../src/lib/assistant/listing-review';
import { emptyWorkspace } from '../src/lib/model';
import { applyCommand } from '../src/lib/commands';
import { inventoryPipeline } from '../src/lib/pipeline';
it('atomically persists five new assistant inventory records and listings through the actual Supabase SQL RPC', async () => {
  const owner = crypto.randomUUID(),
    w = emptyWorkspace(),
    batch = fiveUnknownListings(w);
  await db.query('insert into auth.users values ($1)', [owner]);
  batch.rows = batch.rows.map((row, index) => changeListingCost(w, row, 0, String(index * 5)));
  for (const row of batch.rows) {
    row.matches[0].newItem!.confirmedDistinct = true;
    row.matches[0].newItem!.purchasedAt = '2026-10-01';
  }
  const next = approvalCommands(
    w,
    batch,
    batch.rows.map((r) => r.id),
  ).reduce(applyCommand, w);
  const invalid = structuredClone(next);
  invalid.listings[4].itemId = crypto.randomUUID();
  await expect(
    db.query('select public.commit_workspace($1,0,$2::jsonb)', [owner, JSON.stringify(invalid)]),
  ).rejects.toThrow();
  expect(
    (await db.query('select id from public.items where user_id=$1', [owner])).rows,
  ).toHaveLength(0);
  expect(
    (await db.query('select id from public.listings where user_id=$1', [owner])).rows,
  ).toHaveLength(0);
  await db.query('select public.commit_workspace($1,0,$2::jsonb)', [owner, JSON.stringify(next)]);
  const loaded = await db.query<{ workspace: unknown }>(
    'select public.load_workspace($1) as workspace',
    [owner],
  );
  const saved = workspaceSchema.parse(loaded.rows[0].workspace);
  expect(saved.items).toHaveLength(5);
  expect(saved.listings).toHaveLength(5);
  expect(saved.imports).toHaveLength(5);
  expect(new Set(saved.listings.map((l) => l.itemId)).size).toBe(5);
  expect(saved.items.map((i) => i.cost).sort((a, b) => a - b)).toEqual([0, 500, 1000, 1500, 2000]);
  expect(inventoryPipeline(saved).groups['for-sale'].count).toBe(5);
  await expect(
    db.query('select public.commit_workspace($1,0,$2::jsonb)', [owner, JSON.stringify(next)]),
  ).rejects.toThrow('revision_conflict');
  expect(
    (await db.query('select id from public.items where user_id=$1', [owner])).rows,
  ).toHaveLength(5);
});

import { applyBatchCost } from '../src/lib/assistant/review-bulk';
it('persists four new listings from costs alone with explicit final-approval authorization', async () => {
  const owner = crypto.randomUUID(),
    w = emptyWorkspace();
  await db.query('insert into auth.users values ($1)', [owner]);
  const batch = fiveUnknownListings(w);
  batch.rows = batch.rows.slice(0, 4);
  const costed = applyBatchCost(w, batch, 'split', '10.01');
  const next = approvalCommands(
    w,
    costed,
    costed.rows.map((r) => r.id),
  ).reduce(applyCommand, w);
  await db.query('select public.commit_workspace($1,0,$2::jsonb)', [owner, JSON.stringify(next)]);
  const loaded = workspaceSchema.parse(
    (await db.query<{ w: unknown }>('select public.load_workspace($1) as w', [owner])).rows[0].w,
  );
  expect(loaded.items).toHaveLength(4);
  expect(loaded.listings).toHaveLength(4);
  expect(loaded.items.reduce((n, i) => n + i.cost, 0)).toBe(1001);
  expect(loaded.items.every((i) => i.notes.includes('assumed and accepted'))).toBe(true);
  expect(inventoryPipeline(loaded).groups['for-sale'].count).toBe(4);
  expect(JSON.parse(loaded.imports[0].rawCsv).authorization.kind).toBe('final-approval');
});
