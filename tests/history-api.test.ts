import { beforeEach, expect, it, vi } from 'vitest';
import { createHistoryBatch } from '../src/lib/assistant/history';
import { historyCsvSources, historyMapping } from '../src/lib/assistant/csv-history';
import { readCsv } from '../src/lib/csv';
import { emptyWorkspace } from '../src/lib/model';
import { applyCommand } from '../src/lib/commands';
import { historyCommands } from '../src/lib/assistant/history';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  checkOrigin: vi.fn(),
  loadWorkspace: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('../src/lib/supabase/server', () => ({
  requireUser: mocks.requireUser,
  checkOrigin: mocks.checkOrigin,
  adminClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock('../src/lib/supabase/workspace', () => ({ loadWorkspace: mocks.loadWorkspace }));
import { POST } from '../src/app/api/assistant/approve/route';
const owner = '11111111-1111-4111-8111-111111111111';
async function batch() {
  const text = 'Name,Price,Date,Fees\nCoatUnique,25,2026-11-10,1\nBootUnique,30,2026-11-11,2';
  const parsed = readCsv(text);
  return createHistoryBatch(
    await historyCsvSources(text, 'history.csv', {
      mapping: historyMapping(parsed.columns),
      marketplace: 'Depop',
      dateFormat: 'auto',
    }),
    emptyWorkspace(),
  );
}
const request = (body: unknown) =>
  new Request('https://app.test/api/assistant/approve', {
    method: 'POST',
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: owner });
  mocks.checkOrigin.mockReturnValue(undefined);
  mocks.loadWorkspace.mockResolvedValue(emptyWorkspace());
  mocks.rpc.mockResolvedValue({ data: 1, error: null });
});
it('saves all approved history records in one tenant-scoped SQL transaction, preserving explicit unknown costs', async () => {
  const b = await batch();
  const response = await POST(
    request({
      mode: 'history',
      batch: b,
      rowIds: b.rows.map((r) => r.id),
      userId: crypto.randomUUID(),
    }),
  );
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.workspace.orders).toHaveLength(2);
  expect(data.workspace.items).toHaveLength(2);
  expect(
    data.workspace.imports.every(
      (r: { mapping: { history: string }; rawCsv: string }) =>
        r.mapping.history === 'true' && JSON.parse(r.rawCsv).unknownCostItemIds.length === 1,
    ),
  ).toBe(true);
  expect(mocks.loadWorkspace).toHaveBeenCalledWith(owner);
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(mocks.rpc.mock.calls[0][0]).toBe('commit_workspace');
  expect(mocks.rpc.mock.calls[0][1].p_user_id).toBe(owner);
});
it('rejects unauthenticated, stale and foreign-item requests without a write', async () => {
  const b = await batch();
  const payload = { mode: 'history', batch: b, rowIds: b.rows.map((r) => r.id) };
  mocks.requireUser.mockRejectedValueOnce(new Error('Unauthorized'));
  expect((await POST(request(payload))).status).toBe(401);
  expect(mocks.loadWorkspace).not.toHaveBeenCalled();
  mocks.loadWorkspace.mockResolvedValueOnce({ ...emptyWorkspace(), revision: 10 });
  expect((await POST(request(payload))).status).toBe(409);
  b.rows[0].matches[0].itemId = crypto.randomUUID();
  b.rows[0].matches[0].newItem = null;
  expect((await POST(request(payload))).status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('replays confirmed retries without another SQL call, and fails unconfirmed saves without claiming success', async () => {
  const b = await batch(),
    ids = b.rows.map((r) => r.id);
  const saved = historyCommands(emptyWorkspace(), b, ids).reduce(applyCommand, emptyWorkspace());
  mocks.loadWorkspace.mockResolvedValueOnce(saved);
  const replay = await POST(request({ mode: 'history', batch: b, rowIds: ids }));
  expect((await replay.json()).replayed).toBe(true);
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValueOnce({
    data: null,
    error: { message: 'private database diagnostics' },
  });
  const failed = await POST(request({ mode: 'history', batch: b, rowIds: ids }));
  expect(failed.status).toBe(400);
  expect((await failed.json()).error).not.toContain('private database');
});
