import { it, expect } from 'vitest';
import { purchaseCostCommands } from '../src/lib/purchase-costs';
import { applyCommand } from '../src/lib/commands';
import { metrics } from '../src/lib/finance';
import { currentOrderTotals, itemIsSold } from '../src/lib/ledger';
import { correctedCostBasis } from '../src/lib/cost-basis';
import { historyCostUnknown } from '../src/lib/cost-knowledge';
import { confirmedFreeInventory } from '../src/lib/assistant/listing-review';
import { inventoryPipeline } from '../src/lib/pipeline';
import { orderSchema, type Workspace } from '../src/lib/model';
import { soldCostFixture } from './helpers/purchase-costs';
const batch = (w: Workspace, cost: number, confirmCorrections = false) => ({
  id: crypto.randomUUID(),
  entries: [{ itemId: w.items[0].id, cost }],
  confirmCorrections,
  reason: 'Confirmed acquisition cost',
});
it('fills unknown saved sale cost with a dated COGS correction, preserves original lines, and is idempotent by batch identity', async () => {
  const w = await soldCostFixture(),
    request = batch(w, 500),
    original = structuredClone(w.orders);
  const commands = purchaseCostCommands(w, request),
    saved = commands.reduce(applyCommand, w);
  expect(w.financialEvents).toHaveLength(0);
  expect(saved.orders).toEqual(original);
  expect(saved.orders[0].lines[0].costBasis).toBe(0);
  expect(saved.items[0].cost).toBe(500);
  expect(saved.financialEvents[0]).toMatchObject({
    kind: 'Cost basis adjustment',
    amount: 500,
    date: w.orders[0].date,
    itemIds: [],
    costItemId: w.items[0].id,
  });
  expect(metrics(saved)).toMatchObject({ cogs: 500, profit: 2800, unknownCosts: 0 });
  expect(currentOrderTotals(saved, saved.orders[0]).netProceeds).toBe(3300);
  expect(historyCostUnknown(saved, saved.orders[0].id)).toBe(false);
  expect(inventoryPipeline(saved).groups.sold.entries[0].cost).toBe(500);
  expect(purchaseCostCommands(saved, request)).toEqual([]);
  expect(() =>
    purchaseCostCommands(saved, { ...request, entries: [{ itemId: w.items[0].id, cost: 600 }] }),
  ).toThrow('different values');
});
it('requires explicit correction for known costs, preserves posted ledger entries, and supports repeated corrections including confirmed zero', async () => {
  let w = await soldCostFixture(1200);
  const original = structuredClone(w.orders);
  w = applyCommand(w, {
    type: 'financialEvent',
    value: {
      id: crypto.randomUUID(),
      orderId: w.orders[0].id,
      date: '2026-11-11T12:00:00Z',
      kind: 'Fee adjustment',
      amount: 100,
      itemIds: [],
      externalId: 'FEE-1',
      reversesId: null,
      reason: 'Additional fee',
      category: 'Other',
    },
  });
  expect(() => purchaseCostCommands(w, batch(w, 500))).toThrow('Confirm');
  w = purchaseCostCommands(w, batch(w, 500, true)).reduce(applyCommand, w);
  expect(w.orders).toEqual(original);
  expect(w.financialEvents[0].amount).toBe(100);
  expect(currentOrderTotals(w, w.orders[0]).cogs).toBe(500);
  w = purchaseCostCommands(w, batch(w, 0, true)).reduce(applyCommand, w);
  expect(correctedCostBasis(w, w.orders[0], w.items[0].id)).toBe(0);
  expect(confirmedFreeInventory(w, w.items[0].id)).toBe(true);
  expect(metrics(w).profit).toBe(3200);
});
it('distinguishes unknown from explicitly confirmed zero without inventing a purchase or acquisition date', async () => {
  const w = await soldCostFixture();
  expect(historyCostUnknown(w, w.orders[0].id)).toBe(true);
  const next = purchaseCostCommands(w, batch(w, 0)).reduce(applyCommand, w);
  expect(next.financialEvents[0].amount).toBe(0);
  expect(historyCostUnknown(next, next.orders[0].id)).toBe(false);
  expect(next.items[0].purchasedAt).toBe(w.items[0].purchasedAt);
  expect(metrics(next).profit).toBe(3300);
});
it('handles physical returns and resales without double-charging acquisition cost or changing revenue and payouts', async () => {
  let w = await soldCostFixture();
  const first = w.orders[0],
    itemId = w.items[0].id;
  w = applyCommand(w, {
    type: 'financialEvent',
    value: {
      id: crypto.randomUUID(),
      orderId: first.id,
      date: '2026-11-11T12:00:00Z',
      kind: 'Return',
      amount: 0,
      itemIds: [itemId],
      externalId: 'RETURN-1',
      reversesId: null,
      reason: 'Physical return received',
      category: 'Other',
    },
  });
  w = applyCommand(w, {
    type: 'order',
    value: orderSchema.parse({
      ...first,
      id: crypto.randomUUID(),
      date: '2026-11-12T12:00:00Z',
      externalId: 'RESALE',
      importKey: '',
      lines: [{ itemId, price: 4000, costBasis: 0 }],
    }),
  });
  const beforeRevenue = metrics(w).revenue;
  w = purchaseCostCommands(w, batch(w, 500, true)).reduce(applyCommand, w);
  expect(currentOrderTotals(w, w.orders[0]).cogs).toBe(0);
  expect(currentOrderTotals(w, w.orders[1]).cogs).toBe(500);
  expect(metrics(w).cogs).toBe(500);
  expect(metrics(w).revenue).toBe(beforeRevenue);
  expect(w.payouts).toHaveLength(0);
  expect(itemIsSold(w, itemId)).toBe(true);
  expect(w.items).toHaveLength(1);
});
it('rejects foreign items, repeated physical selections, invalid cents and invalid cost-event targets without mutation', async () => {
  const w = await soldCostFixture(),
    original = structuredClone(w);
  expect(() =>
    purchaseCostCommands(w, {
      ...batch(w, 500),
      entries: [{ itemId: crypto.randomUUID(), cost: 500 }],
    }),
  ).toThrow('workspace');
  const b = batch(w, 500);
  expect(() => purchaseCostCommands(w, { ...b, entries: [...b.entries, ...b.entries] })).toThrow(
    'once',
  );
  expect(() => purchaseCostCommands(w, batch(w, -1))).toThrow();
  const command = purchaseCostCommands(w, batch(w, 500)).find((c) => c.type === 'financialEvent')!;
  if (command.type !== 'financialEvent') throw new Error('Missing correction');
  expect(() =>
    applyCommand(w, { ...command, value: { ...command.value, costItemId: crypto.randomUUID() } }),
  ).toThrow('identify');
  expect(() => applyCommand(w, { ...command, value: { ...command.value, amount: -500 } })).toThrow(
    'negative',
  );
  expect(w).toEqual(original);
});
