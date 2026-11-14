import { it, expect, vi } from 'vitest';
import { readImportAudit } from '../src/lib/import-audit';
import {
  historyCostUnknown,
  historyInventoryCostUnknown,
  assumedHistoryAcquisition,
} from '../src/lib/cost-knowledge';
import { confirmedFreeInventory } from '../src/lib/assistant/listing-review';
import { inventoryPipeline } from '../src/lib/pipeline';
import { soldCostFixture } from './helpers/purchase-costs';

it('parses each receipt once across repeated read-only cost/date/pipeline checks without changing decisions', async () => {
  const w = await soldCostFixture(null);
  const item = w.items[0],
    order = w.orders[0],
    receipt = w.imports[0];
  const before = structuredClone(w);
  const parse = vi.spyOn(JSON, 'parse');
  try {
    for (let n = 0; n < 50; n++) {
      expect(historyCostUnknown(w, order.id, item.id)).toBe(true);
      expect(historyInventoryCostUnknown(w, item.id)).toBe(true);
      expect(assumedHistoryAcquisition(w, item.id)).toBe(true);
      expect(confirmedFreeInventory(w, item.id)).toBe(false);
    }
    expect(inventoryPipeline(w).entries[0].cost).toBeNull();
    expect(parse.mock.calls.filter(([raw]) => raw === receipt.rawCsv)).toHaveLength(1);
    expect(w).toEqual(before);
  } finally {
    parse.mockRestore();
  }
});
it('keeps confirmed zero separate from unknown and uses fresh receipts after a saved correction', async () => {
  const unknown = await soldCostFixture(null),
    free = await soldCostFixture(0);
  expect(historyInventoryCostUnknown(unknown, unknown.items[0].id)).toBe(true);
  expect(confirmedFreeInventory(free, free.items[0].id)).toBe(true);
  expect(historyInventoryCostUnknown(free, free.items[0].id)).toBe(false);
  expect(inventoryPipeline(free).entries[0].cost).toBe(0);
  const receipt = unknown.imports[0],
    audit = structuredClone(readImportAudit(receipt));
  audit.unknownCostItemIds = [];
  audit.knownZeroItemIds = [unknown.items[0].id];
  const corrected = { ...unknown, imports: [{ ...receipt, rawCsv: JSON.stringify(audit) }] };
  expect(historyCostUnknown(corrected, corrected.orders[0].id)).toBe(false);
  expect(historyCostUnknown(unknown, unknown.orders[0].id)).toBe(true);
});
it('invalidates on edited raw text, isolates distinct account receipts, and caches invalid JSON without converting it to proof', async () => {
  const w = await soldCostFixture(null),
    receipt = { ...w.imports[0], rawCsv: '{"proof":"first"}' };
  expect(readImportAudit(receipt)).toEqual({ proof: 'first' });
  receipt.rawCsv = '{"proof":"second"}';
  expect(readImportAudit(receipt)).toEqual({ proof: 'second' });
  expect(readImportAudit({ ...receipt, rawCsv: '{"proof":"other account"}' })).toEqual({
    proof: 'other account',
  });
  receipt.rawCsv = '{invalid audit';
  const parse = vi.spyOn(JSON, 'parse');
  try {
    expect(() => readImportAudit(receipt)).toThrow(SyntaxError);
    expect(() => readImportAudit(receipt)).toThrow(SyntaxError);
    expect(parse.mock.calls.filter(([raw]) => raw === receipt.rawCsv)).toHaveLength(1);
  } finally {
    parse.mockRestore();
  }
  receipt.rawCsv = '{"proof":"repaired"}';
  expect(readImportAudit(receipt)).toEqual({ proof: 'repaired' });
});
