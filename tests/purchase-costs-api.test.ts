import { beforeEach, it, expect, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const m = vi.hoisted(() => ({ user: vi.fn(), origin: vi.fn(), rpc: vi.fn(), load: vi.fn() }));
vi.mock('../src/lib/supabase/server', () => ({
  requireUser: m.user,
  checkOrigin: m.origin,
  adminClient: () => ({ rpc: m.rpc }),
}));
vi.mock('../src/lib/supabase/workspace', () => ({ loadWorkspace: m.load }));
import { POST } from '../src/app/api/purchase-costs/route';
import { purchaseCostCommands } from '../src/lib/purchase-costs';
import { applyCommand } from '../src/lib/commands';
import { soldCostFixture } from './helpers/purchase-costs';
const owner = '11111111-1111-4111-8111-111111111111';
beforeEach(async () => {
  vi.clearAllMocks();
  m.user.mockResolvedValue({ id: owner });
  m.origin.mockReturnValue(undefined);
  m.load.mockResolvedValue(await soldCostFixture());
  m.rpc.mockImplementation(async (name) => ({
    data: name === 'purchase_costs_ready' ? true : 99,
    error: null,
  }));
});
const req = (data: unknown) =>
  new Request('https://app.test/api/purchase-costs', {
    method: 'POST',
    body: JSON.stringify(data),
  });
async function input() {
  const w = await m.load();
  return {
    revision: w.revision,
    batch: {
      id: crypto.randomUUID(),
      entries: [{ itemId: w.items[0].id, cost: 500 }],
      confirmCorrections: false,
      reason: 'Purchase receipt verified',
    },
  };
}
it('derives actor from Auth and commits cost corrections with the original sale lines intact', async () => {
  const body = await input(),
    w = await m.load(),
    result = await POST(req(body));
  expect(result.status).toBe(200);
  const saved = m.rpc.mock.calls.find((c) => c[0] === 'commit_workspace')![1];
  expect(saved.p_user_id).toBe(owner);
  expect(saved.p_payload.orders).toEqual(w.orders);
  expect(saved.p_payload.financialEvents[0]).toMatchObject({
    kind: 'Cost basis adjustment',
    amount: 500,
    costItemId: w.items[0].id,
  });
});
it('denies revoked, cross-site, foreign-item and injected-actor requests without committing', async () => {
  const body = await input();
  m.user.mockRejectedValueOnce(new Error('Unauthorized'));
  expect((await POST(req(body))).status).toBe(401);
  m.origin.mockImplementationOnce(() => {
    throw new Error('Invalid request origin');
  });
  expect((await POST(req(body))).status).toBe(400);
  expect((await POST(req({ ...body, userId: crypto.randomUUID() }))).status).toBe(400);
  expect(
    (
      await POST(
        req({
          ...body,
          batch: { ...body.batch, entries: [{ itemId: crypto.randomUUID(), cost: 500 }] },
        }),
      )
    ).status,
  ).toBe(400);
  expect(m.rpc).not.toHaveBeenCalled();
});
it('requires the optional historical-cost migration and handles concurrent changes without losing the draft', async () => {
  const body = await input();
  m.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } });
  expect((await POST(req(body))).status).toBe(503);
  expect(m.rpc).toHaveBeenCalledTimes(1);
  m.rpc.mockClear();
  expect((await POST(req({ ...body, revision: body.revision + 1 }))).status).toBe(409);
  expect(m.rpc).not.toHaveBeenCalled();
});
it('replays a completed batch after a lost response without another posting, even with an older client revision', async () => {
  const body = await input(),
    w = await m.load(),
    saved = purchaseCostCommands(w, body.batch).reduce(applyCommand, w);
  m.load.mockResolvedValue(saved);
  const result = await POST(req(body));
  expect(result.status).toBe(200);
  expect((await result.json()).replayed).toBe(true);
  expect(m.rpc).not.toHaveBeenCalled();
});
it('keeps a failed database save atomic, bounds input and hides database diagnostics', async () => {
  const body = await input();
  m.rpc
    .mockResolvedValueOnce({ data: true, error: null })
    .mockResolvedValueOnce({ data: null, error: { message: 'PRIVATE_DATABASE_DIAGNOSTIC' } });
  const failed = await POST(req(body));
  expect(failed.status).toBe(503);
  expect(await failed.text()).not.toContain('PRIVATE_DATABASE_DIAGNOSTIC');
  expect((await POST(req({ ...body, extra: 'x'.repeat(110000) }))).status).toBe(413);
});
