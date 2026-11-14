import { emptyWorkspace } from '../../src/lib/model';
import { historyCsvSources, historyMapping } from '../../src/lib/assistant/csv-history';
import { createHistoryBatch, historyCommands } from '../../src/lib/assistant/history';
import { readCsv } from '../../src/lib/csv';
import { applyCommand } from '../../src/lib/commands';
export async function soldCostFixture(cost: number | null = null) {
  const text = `Item,Price,Date,Fees,Purchase Cost\nHistorical jacket,35,2026-11-10,2,${cost === null ? '' : (cost / 100).toFixed(2)}`;
  const w = emptyWorkspace(),
    sources = await historyCsvSources(text, 'history.csv', {
      mapping: historyMapping(readCsv(text).columns),
      marketplace: 'Depop',
      dateFormat: 'auto',
      allowIncomplete: true,
    }),
    batch = createHistoryBatch(sources, w);
  return historyCommands(
    w,
    batch,
    batch.rows.map((r) => r.id),
  ).reduce(applyCommand, w);
}
