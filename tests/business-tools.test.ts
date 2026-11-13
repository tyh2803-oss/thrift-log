import { expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createBusinessTools, spokenDate } from '../src/lib/assistant/business-tools';
import { approvalCommands, previewBatch } from '../src/lib/assistant/planner';
import { applyCommand } from '../src/lib/commands';
import { metrics } from '../src/lib/finance';
import { createHistoryBatch } from '../src/lib/assistant/history';
import { historyCsvSources, historyMapping } from '../src/lib/assistant/csv-history';
import { readCsv } from '../src/lib/csv';
import {
  businessWorkspace,
  saleChange,
  inventorySearch,
  emptyDrafts,
} from './helpers/business-assistant';

it('searches tee/t-shirt descriptions and real listing dates without creating or altering records', async () => {
  const w = businessWorkspace(),
    before = structuredClone(w),
    tools = createBusinessTools(w, emptyDrafts, 'Harley tee', null);
  const found = (await tools.execute('search_inventory', inventorySearch)) as {
    total: number;
    items: { id: string; purchaseCost: number }[];
  };
  expect(found.total).toBe(1);
  expect(found.items[0]).toMatchObject({ id: w.items[0].id, purchaseCost: 1200 });
  expect(w).toEqual(before);
  await expect(tools.execute('execute_sql', { query: 'select * from auth.users' })).rejects.toThrow(
    'not allowed',
  );
  await expect(tools.execute('__proto__', {})).rejects.toThrow('not allowed');
  await expect(
    tools.execute('get_record', { kind: 'item', id: crypto.randomUUID() }),
  ).rejects.toThrow('not available');
});
it('prepares known identity and actual sale price but never copies listing dates, asking prices or missing fees', async () => {
  const w = businessWorkspace(),
    tools = createBusinessTools(
      w,
      emptyDrafts,
      'I sold the Harley tee I listed on Depop yesterday for $35.',
      null,
    );
  await tools.execute('search_inventory', inventorySearch);
  await tools.execute('prepare_changes', { changes: [saleChange(w.items[0].id)] });
  const row = tools.drafts.batch!.rows[0];
  expect(row.matches[0]).toMatchObject({ itemId: w.items[0].id, newItem: null });
  expect(row.facts).toMatchObject({
    date: null,
    fees: null,
    processing: null,
    shipping: null,
    refund: null,
    lines: [{ price: 3500 }],
  });
  expect(previewBatch(w, tools.drafts.batch!)[0].ready).toBe(false);
  await expect(
    tools.execute('prepare_changes', {
      changes: [saleChange(w.items[0].id, { date: '2026-11-12', dateEvidence: 'yesterday' })],
    }),
  ).rejects.toThrow();
  expect(w.orders).toHaveLength(0);
});
it('requires a real user choice for equally plausible pieces and preserves an explicit zero separately from unknown', async () => {
  const w = businessWorkspace();
  w.items.push({
    ...w.items[0],
    id: crypto.randomUUID(),
    sku: 'HARLEY-BLUE-L',
    color: 'Blue',
    title: 'Blue Harley Davidson T-Shirt',
    cost: 0,
  });
  const tools = createBusinessTools(w, emptyDrafts, 'I sold the Harley tee for $35.', null);
  const result = (await tools.execute('search_inventory', inventorySearch)) as {
    ambiguous: boolean;
  };
  expect(result.ambiguous).toBe(true);
  await expect(
    tools.execute('prepare_changes', { changes: [saleChange(w.items[0].id)] }),
  ).rejects.toThrow('choose');
  const chosen = createBusinessTools(
    w,
    emptyDrafts,
    'I sold the Harley tee for $35.',
    w.items[1].id,
  );
  await chosen.execute('search_inventory', inventorySearch);
  await chosen.execute('prepare_changes', { changes: [saleChange(w.items[1].id)] });
  expect(previewBatch(w, chosen.drafts.batch!)[0].costs).toEqual([null]);
  chosen.drafts.batch!.rows[0].matches[0].costOverride = 0;
  chosen.drafts.batch!.rows[0].matches[0].costCorrection = true;
  expect(previewBatch(w, chosen.drafts.batch!)[0].costs).toEqual([0]);
});
it('updates a pending sale on follow-up, approves through canonical commands, and prevents another sale of the same physical item', async () => {
  const w = businessWorkspace(),
    tools = createBusinessTools(
      w,
      emptyDrafts,
      'I sold the Harley tee for $35. It sold today. Fees were $2 and no other amounts.',
      null,
    );
  await tools.execute('search_inventory', inventorySearch);
  await tools.execute('prepare_changes', { changes: [saleChange(w.items[0].id)] });
  const id = tools.drafts.batch!.rows[0].id;
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: w.settings.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  await tools.execute('prepare_changes', {
    changes: [
      saleChange(w.items[0].id, {
        date: today,
        dateEvidence: 'today',
        fees: 200,
        processing: 0,
        shipping: 0,
        shippingCollected: 0,
        discount: 0,
        refund: 0,
        other: 0,
        marketplace: null,
      }),
    ],
  });
  expect(tools.drafts.batch!.rows).toHaveLength(1);
  expect(tools.drafts.batch!.rows[0].id).toBe(id);
  expect(previewBatch(w, tools.drafts.batch!)[0].ready).toBe(true);
  const saved = approvalCommands(w, tools.drafts.batch!, [id]).reduce(applyCommand, w);
  expect(saved.items).toHaveLength(w.items.length);
  expect(saved.orders).toHaveLength(1);
  expect(saved.orders[0].lines[0]).toMatchObject({ price: 3500, costBasis: 1200 });
  expect(metrics(saved).profit).toBe(2100);
  const retry = createBusinessTools(saved, emptyDrafts, 'I sold the Harley tee for $35.', null);
  await retry.execute('search_inventory', inventorySearch);
  await expect(
    retry.execute('prepare_changes', { changes: [saleChange(w.items[0].id)] }),
  ).rejects.toThrow('already');
});
it('allows no asking-price substitute for an actual sale and keeps direct foreign photo access unavailable', async () => {
  const w = businessWorkspace(),
    reader = vi.fn(),
    tools = createBusinessTools(w, emptyDrafts, 'I sold the Harley tee.', null, new Date(), reader);
  await tools.execute('search_inventory', inventorySearch);
  await tools.execute('prepare_changes', { changes: [saleChange(w.items[0].id, { price: null })] });
  expect(tools.drafts.batch!.rows[0].facts.lines[0].price).toBeNull();
  await expect(
    tools.execute('inspect_inventory_photo', { itemId: crypto.randomUUID(), index: 0 }),
  ).rejects.toThrow('not available');
  expect(reader).not.toHaveBeenCalled();
});
it('reuses safe pipeline status rules and requires confirmation before ending active local listings', async () => {
  const w = businessWorkspace(),
    tools = createBusinessTools(w, emptyDrafts, 'Unlist the Harley tee', null);
  await tools.execute('search_inventory', inventorySearch);
  await tools.execute('prepare_changes', {
    changes: [saleChange(w.items[0].id, { action: 'unlisted', price: null })],
  });
  const b = tools.drafts.batch!;
  expect(previewBatch(w, b)[0].ready).toBe(false);
  b.rows[0].confirmStatusImpact = true;
  const saved = approvalCommands(w, b, [b.rows[0].id]).reduce(applyCommand, w);
  expect(saved.items[0].status).toBe('Ready to List');
  expect(saved.listings[0].status).toBe('Ended');
  expect(saved.orders).toEqual(w.orders);
});
it('uses existing financial helpers and labels shared labor/overhead globally instead of allocating it', async () => {
  const w = businessWorkspace(),
    tools = createBusinessTools(w, emptyDrafts, 'How is Depop doing?', null);
  const all = (await tools.execute('business_summary', {
    period: 'All time',
    marketplace: null,
    from: null,
    to: null,
  })) as { revenue: number; profit: number; pipeline: Record<string, number> };
  expect(all.revenue).toBe(metrics(w).revenue);
  expect(all.profit).toBe(metrics(w).profit);
  expect(all.pipeline['for-sale']).toBe(1);
  const depop = (await tools.execute('business_summary', {
    period: 'All time',
    marketplace: 'Depop',
    from: null,
    to: null,
  })) as { profitMeaning: string; globalMetricsMeaning: string };
  expect(depop.profitMeaning).toContain('before shared');
  expect(depop.globalMetricsMeaning).toContain('not this marketplace');
});
it('never creates a second text sale for an already pending file sale', async () => {
  const w = businessWorkspace(),
    text = `Name,Price,Date,Fees,SKU\nHarley tee,35,2026-11-12,2,${w.items[0].sku}`;
  const sources = await historyCsvSources(text, 'history.csv', {
    mapping: historyMapping(readCsv(text).columns),
    marketplace: 'Depop',
    dateFormat: 'auto',
  });
  const historyBatch = createHistoryBatch(sources, w),
    tools = createBusinessTools(
      w,
      { batch: null, historyBatch },
      'I sold the Harley tee for $35.',
      null,
    );
  await tools.execute('search_inventory', inventorySearch);
  await expect(
    tools.execute('prepare_changes', { changes: [saleChange(w.items[0].id)] }),
  ).rejects.toThrow('pending file sale');
});
it('resolves dictated relative date phrases in the account timezone without accepting invented evidence', () => {
  const now = new Date('2026-11-13T02:00:00Z');
  expect(spokenDate('yesterday', 'Sold yesterday', 'America/New_York', now)).toBe('2026-11-11');
  expect(spokenDate('last Friday', 'Sold last Friday', 'America/New_York', now)).toBe('2026-11-06');
  expect(spokenDate('01/02/2026', 'Sold 01/02/2026', 'America/New_York', now)).toBeNull();
  expect(() => spokenDate('today', 'The date is unknown', 'America/New_York', now)).toThrow(
    'evidence',
  );
});

it('reuses private file imports, preserves mixed-document source indexes, allocates by physical item, and synchronizes individual cross-list overrides', async () => {
  const { extractedSale, extractedLine } = await import('./helpers/assistant');
  const w = businessWorkspace(),
    fileId = crypto.randomUUID();
  const listing = (title: string, sku: string, marketplace: 'Depop' | 'Vinted' = 'Depop') =>
    extractedSale({
      kind: 'listing',
      status: 'active',
      marketplace,
      externalOrderId: null,
      date: null,
      lines: [extractedLine({ title, sku, brand: null })],
    });
  const source = {
    hash: 'a'.repeat(64),
    chatFileId: fileId,
    name: 'mixed.pdf',
    sourceType: 'pdf' as const,
    extraction: {
      records: [
        extractedSale({
          lines: [extractedLine({ title: 'Historical Patagonia fleece', sku: 'HISTORY-1' })],
        }),
        listing('Levi jeans', 'NEW-1'),
        listing('Columbia parka', 'NEW-2'),
        listing('Levi jeans', 'NEW-1', 'Vinted'),
        listing(w.items[0].title, w.items[0].sku),
      ],
      message: 'Mixed supported records.',
    },
  };
  const attachments = {
    files: [{ id: fileId, name: 'mixed.pdf', mime: 'application/pdf', size: 100 }],
    prepare: vi.fn().mockResolvedValue([source]),
    read: vi.fn(),
    rows: vi.fn(),
    summary: vi.fn(),
  };
  const transcript =
    'Import these files. The total purchase cost for new inventory was $10.01. The jeans actually cost $7.';
  const tools = createBusinessTools(
    w,
    emptyDrafts,
    transcript,
    null,
    new Date(),
    undefined,
    attachments,
  );
  await expect(
    tools.execute('read_attachment', { fileId: crypto.randomUUID(), part: 0 }),
  ).rejects.toThrow('not available');
  expect(attachments.read).not.toHaveBeenCalled();
  await tools.execute('prepare_file_import', {
    fileIds: [fileId],
    intentEvidence: 'Import these files',
  });
  expect(tools.drafts.batch!.rows.map((r) => r.recordIndex)).toEqual([1, 2, 3, 4]);
  expect(tools.drafts.historyBatch!.rows.map((r) => r.recordIndex)).toEqual([0]);
  expect(tools.drafts.batch!.screenshots[0].extraction.records).toHaveLength(5);
  const beforeIds = tools.drafts.batch!.rows.map((r) => r.id);
  await tools.execute('prepare_file_import', {
    fileIds: [fileId],
    intentEvidence: 'Import these files',
  });
  expect(attachments.prepare).toHaveBeenCalledTimes(1);
  expect(tools.drafts.batch!.rows.map((r) => r.id)).toEqual(beforeIds);
  await tools.execute('allocate_batch_cost', {
    mode: 'split',
    amount: 1001,
    evidence: '$10.01',
    physicalItemIds: null,
  });
  expect(tools.drafts.batch!.rows.map((r) => r.matches[0].newItem?.cost)).toEqual([
    501,
    500,
    501,
    undefined,
  ]);
  expect(w.items[0].cost).toBe(1200);
  await tools.execute('edit_drafts', {
    rowIds: [beforeIds[0]],
    marketplace: null,
    date: null,
    dateEvidence: null,
    price: null,
    fees: null,
    processing: null,
    shipping: null,
    shippingCollected: null,
    discount: null,
    refund: null,
    other: null,
    purchaseCost: 700,
    purchaseCostEvidence: 'jeans actually cost $7',
  });
  expect(tools.drafts.batch!.rows.map((r) => r.matches[0].newItem?.cost)).toEqual([
    700,
    500,
    700,
    undefined,
  ]);
  expect(tools.drafts.batch!.rows[2].matches[0].costAllocation?.mode).toBe('individual');
  expect(w.orders).toHaveLength(0);
});
it('prepares shared file fees without guessing other amounts and rejects unauthorized acquisition-cost corrections atomically', async () => {
  const w = businessWorkspace(),
    text = `Item,Sold Price,Purchase Cost,SKU\nHarley tee,35,12,${w.items[0].sku}\nLevi jeans,30,5,NEW-JEANS`;
  const source = await historyCsvSources(text, 'history.csv', {
    mapping: historyMapping(readCsv(text).columns),
    marketplace: 'Depop',
    dateFormat: 'auto',
    allowIncomplete: true,
  });
  const historyBatch = createHistoryBatch(source, w),
    tools = createBusinessTools(
      w,
      { batch: null, historyBatch },
      'These sold on 2026-11-12. Fees were $2 each. Their cost was $99 each.',
      null,
    );
  const edit = {
    rowIds: null,
    marketplace: null,
    date: '2026-11-12',
    dateEvidence: '2026-11-12',
    price: null,
    fees: 200,
    processing: null,
    shipping: null,
    shippingCollected: null,
    discount: null,
    refund: null,
    other: null,
    purchaseCost: null,
    purchaseCostEvidence: null,
  };
  await tools.execute('edit_drafts', edit);
  expect(
    tools.drafts.historyBatch!.rows.every(
      (r) => r.facts.fees === 200 && r.facts.date === '2026-11-12',
    ),
  ).toBe(true);
  expect(tools.drafts.historyBatch!.rows.every((r) => r.facts.shipping === null)).toBe(true);
  const before = structuredClone(tools.drafts);
  await expect(
    tools.execute('edit_drafts', {
      ...edit,
      purchaseCost: 9900,
      purchaseCostEvidence: 'cost was $99 each',
    }),
  ).rejects.toThrow('protected');
  expect(tools.drafts).toEqual(before);
});
