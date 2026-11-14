import { it, expect } from 'vitest';
import { profitReview } from '../src/lib/profit-review';
import { metrics } from '../src/lib/finance';
import { soldCostFixture } from './helpers/purchase-costs';
import { purchaseCostCommands } from '../src/lib/purchase-costs';
import { applyCommand } from '../src/lib/commands';
const all: [number, number] = [0, Infinity];
it('identifies exactly the dashboard missing-cost items, honors dates and clears after a confirmed-zero correction', async () => {
  let w = await soldCostFixture();
  expect(profitReview(w, all).itemIds).toEqual([w.items[0].id]);
  expect(metrics(w).unknownCosts).toBe(1);
  expect(profitReview(w, [0, Date.parse('2026-11-01')])).toEqual({ itemIds: [], feeOrderIds: [] });
  w = purchaseCostCommands(w, {
    id: crypto.randomUUID(),
    entries: [{ itemId: w.items[0].id, cost: 0 }],
    confirmCorrections: false,
    reason: 'Confirmed free inventory',
  }).reduce(applyCommand, w);
  expect(profitReview(w, all).itemIds).toEqual([]);
  expect(metrics(w).profitKnown).toBe(true);
});
it('keeps seller-fee gaps separate from purchase costs without guessing any charges', async () => {
  const w = await soldCostFixture(300);
  w.imports[0].mapping.whatnot = 'true';
  w.imports[0].rawCsv = JSON.stringify({
    ...JSON.parse(w.imports[0].rawCsv),
    whatnotFinancialsPending: true,
  });
  expect(profitReview(w, all)).toEqual({ itemIds: [], feeOrderIds: [w.orders[0].id] });
  expect(metrics(w)).toMatchObject({ unknownCosts: 0, unknownFinancials: 1, profitKnown: false });
});
it('nets physical returns using canonical dated postings, including a return in a later reporting period', async () => {
  let w = await soldCostFixture();
  w = applyCommand(w, {
    type: 'financialEvent',
    value: {
      id: crypto.randomUUID(),
      orderId: w.orders[0].id,
      date: '2026-11-11T12:00:00Z',
      kind: 'Return',
      amount: 0,
      itemIds: [w.items[0].id],
      externalId: 'returned',
      reversesId: null,
      reason: 'Returned physical item',
      category: 'Other',
    },
  });
  expect(profitReview(w, all).itemIds).toEqual([]);
  const later: [number, number] = [Date.parse('2026-11-11T00:00:00Z'), Infinity];
  expect(profitReview(w, later).itemIds).toEqual([w.items[0].id]);
  expect(metrics(w, ...later).unknownCosts).toBe(1);
});
