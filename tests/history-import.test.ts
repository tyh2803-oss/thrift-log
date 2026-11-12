import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { readCsv, planImport } from '../src/lib/csv';
import {
  historyCsvSources,
  historyMapping,
  isDepopReport,
  sourceAmount,
} from '../src/lib/assistant/csv-history';
import { createHistoryBatch, historyCommands, previewHistory } from '../src/lib/assistant/history';
import { emptyWorkspace } from '../src/lib/model';
import { applyCommand } from '../src/lib/commands';
import { metrics } from '../src/lib/finance';
import { ledgerExportRows, currentOrderTotals } from '../src/lib/ledger';
import { inventoryPipeline, pipelineValue } from '../src/lib/pipeline';
import { alreadyApproved } from '../src/lib/assistant/planner';
import { assistantWorkspace } from './helpers/assistant';
const synthetic = await readFile(
  new URL('./fixtures/csv/depop-synthetic.csv', import.meta.url),
  'utf8',
);
async function sources(text: string, marketplace = 'Depop') {
  const parsed = readCsv(text);
  return historyCsvSources(text, 'history.csv', {
    mapping: historyMapping(parsed.columns),
    marketplace,
    dateFormat: 'auto',
    depop: isDepopReport(parsed.columns),
  });
}
it('parses the example-shaped 44-item Depop export as 40 sales with one five-item bundle and no retained buyer details', async () => {
  const src = await sources(synthetic);
  expect(src).toHaveLength(2);
  const records = src.flatMap((s) => s.extraction.records);
  expect(records).toHaveLength(40);
  expect(records.reduce((n, r) => n + r.lines.length, 0)).toBe(44);
  const bundle = records.find((r) => r.lines.length === 5)!;
  expect(bundle.fees).toBe(100);
  expect(bundle.processing).toBe(75);
  expect(bundle.shippingCollected).toBeNull();
  expect(records.reduce((n, r) => n + (r.fees || 0) + (r.processing || 0), 0)).toBe(7000);
  expect(JSON.stringify(src)).not.toMatch(/PRIVATE_BUYER|PRIVATE_PERSON|PRIVATE_ADDRESS/);
  expect(records.every((r) => r.externalOrderId === null)).toBe(true);
  expect(
    records.every((r) => r.lines.every((l) => l.sku === null && l.purchaseCost === null)),
  ).toBe(true);
  const w = emptyWorkspace(),
    batch = createHistoryBatch(src, w);
  expect(previewHistory(w, batch).every((p) => p.ready)).toBe(true);
  const saved = historyCommands(
    w,
    batch,
    batch.rows.map((r) => r.id),
  ).reduce(applyCommand, w);
  expect(saved.items).toHaveLength(44);
  expect(saved.orders).toHaveLength(40);
  const m = metrics(saved);
  expect(m.revenue).toBe(44000);
  expect(m.fees).toBe(7000);
  expect(m.unknownCosts).toBe(44);
  expect(m.profitKnown).toBe(false);
  expect(m.hourly).toBe(null);
  expect(pipelineValue(inventoryPipeline(saved).groups.sold, 'profit')).toMatchObject({
    value: null,
    missing: 44,
  });
  expect(currentOrderTotals(saved, saved.orders[0]).profitKnown).toBe(false);
  expect(
    ledgerExportRows(saved)
      .filter((r) => r.record_type === 'Original order')
      .every((r) => r.operating_profit === '' && r.cogs === ''),
  ).toBe(true);
  expect(
    alreadyApproved(
      saved,
      batch,
      batch.rows.map((r) => r.id),
    ),
  ).toBe(true);
  expect(
    previewHistory(saved, createHistoryBatch(await sources(synthetic), saved)).every(
      (p) => !p.ready,
    ),
  ).toBe(true);
});
it('requires only name, price, date and fees; blank cost differs from an explicit zero', async () => {
  const w = emptyWorkspace();
  const batch = createHistoryBatch(
    await sources(
      'Item Name,Price,Date,Fees,Purchase Cost\nUniqueCoat,25,2026-10-01,0,\nUniqueBoots,30,2026-10-02,2,0',
    ),
    w,
  );
  expect(previewHistory(w, batch).every((p) => p.ready)).toBe(true);
  const saved = historyCommands(
    w,
    batch,
    batch.rows.map((r) => r.id),
  ).reduce(applyCommand, w);
  expect(metrics(saved).unknownCosts).toBe(1);
  expect(currentOrderTotals(saved, saved.orders[0]).profitKnown).toBe(false);
  expect(currentOrderTotals(saved, saved.orders[1]).profitKnown).toBe(true);
  expect(pipelineValue(inventoryPipeline(saved).groups.sold, 'profit')).toMatchObject({
    value: 2800,
    missing: 1,
  });
});
it('rejects missing core fields, formulas, invalid amounts and ambiguous dates without silently using today', async () => {
  for (const text of [
    'Item Name,Price,Date,Fees\nCoat,,2026-10-01,0',
    'Item Name,Price,Date,Fees\nCoat,25,,0',
    'Item Name,Price,Date,Fees\nCoat,25,2026-10-01,',
    'Item Name,Price,Date,Fees\nCoat,25,01/02/2026,0',
  ])
    await expect(sources(text)).rejects.toThrow();
  expect(() => sourceAmount('=SUM(1,2)')).toThrow();
  expect(() => sourceAmount('-1')).toThrow();
  expect(sourceAmount('$1,234.50')).toBe(123450);
});
it('matches exact inventory, preserves recorded costs, and blocks ID manipulation or unknown match overrides', async () => {
  const w = assistantWorkspace();
  const batch = createHistoryBatch(
    await sources(
      'Name,Price,Date,Fees,SKU\nBlue Carhartt Workwear Jacket,45,2026-11-08,4,JACKET-1',
    ),
    w,
  );
  expect(batch.rows[0].matches[0].itemId).toBe(w.items[0].id);
  const saved = historyCommands(w, batch, [batch.rows[0].id]).reduce(applyCommand, w);
  expect(saved.items).toHaveLength(1);
  expect(saved.orders[0].lines[0].costBasis).toBe(1200);
  batch.rows[0].matches[0].purchaseCost = 1;
  expect(() => historyCommands(w, batch, [batch.rows[0].id])).toThrow(
    'different recorded purchase cost',
  );
  batch.rows[0].matches[0].purchaseCost = undefined;
  batch.rows[0].matches[0].itemId = crypto.randomUUID();
  expect(() => historyCommands(w, batch, [batch.rows[0].id])).toThrow('unavailable');
});
it('allows order-ID-free legacy SKU imports with stable duplicate detection after reordering and a later import day', () => {
  const w = assistantWorkspace(),
    row = { sku: 'JACKET-1', price: '45', marketplace: 'Vinted' };
  const mapping = Object.fromEntries(Object.keys(row).map((c) => [c, c]));
  const plan = planImport('Sales', [row, row], mapping, w);
  expect(plan.errors).toEqual([]);
  expect(plan.commands).toHaveLength(1);
  expect(plan.duplicates).toBe(1);
  const saved = plan.commands.reduce(applyCommand, w);
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-12-01'));
  try {
    expect(planImport('Sales', [row], mapping, saved).duplicates).toBe(1);
  } finally {
    vi.useRealTimers();
  }
});
it('keeps supplied IDs as multi-item order groups and rejects incomplete Depop bundles', async () => {
  const parsed = readCsv(synthetic);
  const fewer = parsed.rows.filter((_, i) => i !== 10);
  const Papa = (await import('papaparse')).default;
  await expect(sources(Papa.unparse(fewer))).rejects.toThrow(
    'incomplete or ambiguous Depop bundle',
  );
  const batch = createHistoryBatch(
    await sources(
      'Name,Price,Date,Fees,Order ID\nCoatUnique,25,2026-10-01,1,BUNDLE\nBootUnique,30,2026-10-01,2,BUNDLE',
    ),
    emptyWorkspace(),
  );
  expect(batch.rows).toHaveLength(1);
  expect(batch.rows[0].facts.lines).toHaveLength(2);
  expect(batch.rows[0].facts.fees).toBe(300);
});

it('honors explicit pending/cancelled source statuses instead of inventing completed sales', async () => {
  const w = emptyWorkspace();
  const batch = createHistoryBatch(
    await sources(
      'Name,Price,Date,Fees,Status\nPendingCoat,25,2026-10-01,0,pending\nCancelledCoat,30,2026-10-02,0,cancelled',
    ),
    w,
  );
  expect(batch.rows.every((r) => r.facts.kind === 'other')).toBe(true);
  expect(previewHistory(w, batch).every((p) => !p.ready)).toBe(true);
  expect(() =>
    historyCommands(
      w,
      batch,
      batch.rows.map((r) => r.id),
    ),
  ).toThrow('included');
});
it.runIf(!!process.env.HISTORY_EXAMPLE_CSV)(
  'validates the supplied Depop export locally without saving records or retaining its personal columns',
  async () => {
    const text = await readFile(process.env.HISTORY_EXAMPLE_CSV!, 'utf8');
    const src = await sources(text);
    const batch = createHistoryBatch(src, emptyWorkspace());
    expect(batch.rows).toHaveLength(40);
    expect(batch.rows.reduce((n, r) => n + r.facts.lines.length, 0)).toBe(44);
    expect(
      batch.rows
        .flatMap((r) => r.facts.lines)
        .every((l) => l.purchaseCost === null && l.sku === null),
    ).toBe(true);
    const preview = previewHistory(emptyWorkspace(), batch);
    console.log(
      JSON.stringify({
        providedExample: 'Depop',
        physicalItems: 44,
        saleRecords: 40,
        ready: preview.filter((p) => p.ready).length,
        inventoryMatchExceptions: preview.filter((p) => !p.ready).length,
        sourceDocuments: src.length,
        productionWrites: 0,
      }),
    );
    expect(src.some((s) => s.extraction.records.some((r) => r.lines.length === 5))).toBe(true);
  },
);
it('preserves a provided foreign currency and refuses conversion rather than relabeling it as USD', async () => {
  const w = emptyWorkspace();
  const batch = createHistoryBatch(
    await sources('Name,Price,Date,Fees,Currency\nUniqueCoat,25,2026-11-10,0,CAD'),
    w,
  );
  expect(batch.rows[0].facts.currency).toBe('CAD');
  expect(previewHistory(w, batch)[0].issues[0]).toContain('USD');
  expect(() => historyCommands(w, batch, [batch.rows[0].id])).toThrow('USD');
});
it('keeps returned inventory costs unknown and does not invent free stock after reversing a historical sale', async () => {
  const initial = emptyWorkspace(),
    batch = createHistoryBatch(
      await sources('Name,Price,Date,Fees\nUniqueReturnCoat,25,2026-11-10,1'),
      initial,
    );
  let w = historyCommands(initial, batch, [batch.rows[0].id]).reduce(applyCommand, initial);
  const order = w.orders[0];
  w = applyCommand(w, {
    type: 'financialEvent',
    value: {
      id: crypto.randomUUID(),
      orderId: order.id,
      date: '2026-11-11T12:00:00Z',
      kind: 'Refund',
      amount: 2500,
      itemIds: [w.items[0].id],
      reason: 'Completed full refund and physical return.',
      externalId: '',
      reversesId: null,
      category: 'Other',
    },
  });
  expect(metrics(w).profitKnown).toBe(true);
  expect(metrics(w).inventoryUnknownCosts).toBe(1);
  expect(metrics(w).profit).toBe(-100);
});
it('keeps explicit zero costs on matched inventory known even when optional selling amounts remain unknown', async () => {
  const w = assistantWorkspace();
  w.items[0].cost = 0;
  const batch = createHistoryBatch(
    await sources(
      'Name,Price,Date,Fees,SKU,Purchase cost\nBlue Carhartt Workwear Jacket,45,2026-11-08,4,JACKET-1,0',
    ),
    w,
  );
  batch.rows[0].facts.shipping = null;
  const saved = historyCommands(w, batch, [batch.rows[0].id]).reduce(applyCommand, w);
  const value = pipelineValue(inventoryPipeline(saved).groups.sold, 'profit');
  expect(value.missing).toBe(0);
  expect(value.provisional).toBe(1);
  expect(value.value).toBe(4100);
  expect(metrics(saved).unknownCosts).toBe(0);
});

it('rejects mixed currencies or event states within a grouped order', async () => {
  for (const tail of ['USD,pending', 'CAD,completed']) {
    await expect(
      sources(
        `Name,Price,Date,Fees,Order ID,Currency,Status\nUniqueCoat,25,2026-11-10,1,bundle,USD,completed\nUniqueBoots,30,2026-11-10,2,bundle,${tail}`,
      ),
    ).rejects.toThrow('same currency, source status and show');
  }
});

it('preserves optional packaging and existing-show association, rejecting foreign show IDs', async () => {
  const w = emptyWorkspace();
  const showId = crypto.randomUUID();
  w.shows.push({
    id: showId,
    name: 'Retained show',
    date: '2026-11-10T12:00:00Z',
    type: 'Whatnot',
    status: 'Ended',
    notes: '',
    externalId: '',
    checklist: [],
    lineup: [],
    durationMinutes: 60,
  });
  const batch = createHistoryBatch(
    await sources(
      `Name,Price,Date,Fees,Purchase Cost,Packaging,Show ID\nUniqueShowCoat,25,2026-11-10,1,5,0.75,${showId}`,
      'Whatnot',
    ),
    w,
  );
  const saved = historyCommands(w, batch, [batch.rows[0].id]).reduce(applyCommand, w);
  expect(saved.orders[0]).toMatchObject({ packaging: 75, showId });
  expect(metrics(saved).profit).toBe(1825);
  batch.rows[0].facts.showId = crypto.randomUUID();
  expect(() => historyCommands(w, batch, [batch.rows[0].id])).toThrow('Show');
});

it('includes buyer shipping only when explicitly mapped as money received by the seller', async () => {
  const parsed = readCsv(synthetic);
  const mapping = historyMapping(parsed.columns);
  expect(mapping.shipping_collected).toBe('');
  mapping.shipping_collected = 'Buyer shipping cost';
  const src = await historyCsvSources(synthetic, 'verified-shipping.csv', {
    mapping,
    marketplace: 'Depop',
    dateFormat: 'mdy',
    depop: true,
  });
  expect(
    src.flatMap((s) => s.extraction.records).find((r) => r.lines.length === 5)!.shippingCollected,
  ).toBe(500);
});
