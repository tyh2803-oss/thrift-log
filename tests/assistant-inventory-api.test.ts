import { it, expect, beforeEach, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const m = vi.hoisted(() => ({ user: vi.fn(), origin: vi.fn(), load: vi.fn(), rpc: vi.fn() }));
vi.mock('../src/lib/supabase/server', () => ({
  requireUser: m.user,
  checkOrigin: m.origin,
  adminClient: () => ({ rpc: m.rpc }),
}));
vi.mock('../src/lib/supabase/workspace', () => ({ loadWorkspace: m.load }));
import { POST } from '../src/app/api/assistant/approve/route';
import { createBusinessTools } from '../src/lib/assistant/business-tools';
import { emptyWorkspace } from '../src/lib/model';
import { inventoryChange } from './helpers/inventory-assistant';
import { soldCostFixture } from './helpers/purchase-costs';
const owner = '11111111-1111-4111-8111-111111111111';
const request = (body: unknown) =>
  new Request('https://app.test/api/assistant/approve', {
    method: 'POST',
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockResolvedValue({ id: owner });
  m.origin.mockReturnValue(undefined);
  m.load.mockResolvedValue(emptyWorkspace());
  m.rpc.mockResolvedValue({ data: 1, error: null });
});
async function create() {
  const tools = createBusinessTools(
    emptyWorkspace(),
    { batch: null, historyBatch: null },
    String(inventoryChange().evidence),
    null,
  );
  await tools.execute('prepare_inventory_changes', { changes: [inventoryChange()] });
  const batch = tools.drafts.batch!;
  return { batch, rowIds: [batch.rows[0].id] };
}
it('commits only the verified actor’s approved inventory once and replays a lost response without another item', async () => {
  const input = await create();
  const response = await POST(request({ ...input, userId: crypto.randomUUID() }));
  expect(response.status).toBe(200);
  expect(m.rpc).toHaveBeenCalledTimes(1);
  expect(m.rpc.mock.calls[0][0]).toBe('commit_workspace');
  expect(m.rpc.mock.calls[0][1].p_user_id).toBe(owner);
  expect(m.rpc.mock.calls[0][1].p_payload.items).toHaveLength(1);
  const saved = (await response.json()).workspace;
  m.load.mockResolvedValue(saved);
  m.rpc.mockClear();
  const replay = await POST(request(input));
  expect((await replay.json()).replayed).toBe(true);
  expect(m.rpc).not.toHaveBeenCalled();
});
it('blocks revoked, cross-site, stale and foreign-item requests before any commit', async () => {
  const input = await create();
  m.user.mockRejectedValueOnce(new Error('Unauthorized'));
  expect((await POST(request(input))).status).toBe(401);
  m.origin.mockImplementationOnce(() => {
    throw new Error('Invalid request origin');
  });
  expect((await POST(request(input))).status).toBe(400);
  input.batch.revision = 9;
  expect((await POST(request(input))).status).toBe(409);
  input.batch.revision = 0;
  input.batch.rows[0].inventoryChange!.action = 'edit';
  expect((await POST(request(input))).status).toBe(400);
  expect(m.rpc).not.toHaveBeenCalled();
});
it('rejects an incomplete selected batch atomically while allowing its valid row to be approved separately', async () => {
  const input = await create(),
    second = structuredClone(input.batch.rows[0]);
  second.id = crypto.randomUUID();
  second.inventoryChange!.itemId = crypto.randomUUID();
  second.inventoryChange!.costOperationId = crypto.randomUUID();
  second.inventoryChange!.purchaseCost = null;
  input.batch.rows.push(second);
  expect((await POST(request({ ...input, rowIds: [...input.rowIds, second.id] }))).status).toBe(
    400,
  );
  expect(m.rpc).not.toHaveBeenCalled();
  expect((await POST(request(input))).status).toBe(200);
  expect(m.rpc.mock.calls[0][1].p_payload.items).toHaveLength(1);
});
it('keeps historical cost corrections unsaved until the existing database capability is ready', async () => {
  const w = await soldCostFixture(1200),
    change = inventoryChange({
      action: 'cost',
      itemIds: [w.items[0].id],
      evidence: 'correct jacket cost to 3',
      title: null,
      brand: null,
      category: null,
      source: null,
      askingPrice: null,
    });
  const tools = createBusinessTools(
    w,
    { batch: null, historyBatch: null },
    String(change.evidence),
    null,
  );
  await tools.execute('get_record', { kind: 'item', id: w.items[0].id });
  await tools.execute('prepare_inventory_changes', { changes: [change] });
  const batch = tools.drafts.batch!;
  batch.rows[0].inventoryChange!.confirmCostCorrection = true;
  m.load.mockResolvedValue(w);
  m.rpc.mockResolvedValue({ data: false, error: null });
  const response = await POST(request({ batch, rowIds: [batch.rows[0].id] }));
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(await response.text()).toContain('purchase-cost setup');
  expect(m.rpc.mock.calls.map((c) => c[0])).toEqual(['purchase_costs_ready']);
  expect(w.financialEvents).toHaveLength(0);
});

it('rejects colliding proposal and receipt identities before a cost proof could be overwritten', async () => {
  const input = await create();
  input.batch.rows[0].inventoryChange!.costOperationId = input.batch.rows[0].id;
  const response = await POST(request(input));
  expect(response.status).toBe(400);
  expect(m.rpc).not.toHaveBeenCalled();
});
