import { soldCostFixture } from './purchase-costs';
import { workspaceSchema } from '../../src/lib/model';

/** Synthetic imported history: no production accounts, images or business data. */
export async function navigationWorkspace(count = 600) {
  const w = await soldCostFixture(null);
  const occurredAt = new Date().toISOString();
  const item = w.items[0],
    order = w.orders[0],
    receipt = w.imports[0];
  w.items = [];
  w.orders = [];
  w.imports = [];
  for (let n = 0; n < count; n++) {
    const itemId = crypto.randomUUID(),
      orderId = crypto.randomUUID();
    const audit = JSON.parse(receipt.rawCsv);
    audit.unknownCostItemIds = [itemId];
    audit.assumedAcquisitionItemIds = [itemId];
    w.items.push({
      ...item,
      id: itemId,
      sku: `PERF-${n}`,
      title: `Navigation item ${n}`,
      purchasedAt: occurredAt,
      createdAt: occurredAt,
      status: 'Sold',
    });
    w.orders.push({
      ...order,
      id: orderId,
      date: occurredAt,
      externalId: `PERF-${n}`,
      importKey: `PERF-${n}`,
      lines: [{ ...order.lines[0], itemId }],
    });
    w.imports.push({
      ...receipt,
      id: orderId,
      recordIds: [orderId, itemId],
      rawCsv: JSON.stringify(audit),
    });
  }
  return workspaceSchema.parse(w);
}
