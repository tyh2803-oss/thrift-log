import { beforeEach, expect, it, vi } from 'vitest';
import { assistantWorkspace } from './helpers/assistant';
import type { Workspace } from '../src/lib/model';
import { applyPipelineMove, type PipelineMove } from '../src/lib/pipeline-moves';
const mocks = vi.hoisted(() => ({ user: vi.fn(), origin: vi.fn(), load: vi.fn(), rpc: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('../src/lib/supabase/server', () => ({
  requireUser: mocks.user,
  checkOrigin: mocks.origin,
  adminClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock('../src/lib/supabase/workspace', () => ({ loadWorkspace: mocks.load }));
import { POST } from '../src/app/api/pipeline/route';
const owner = '11111111-1111-4111-8111-111111111111';
const request = (body: unknown) =>
  new Request('https://app.test/api/pipeline', { method: 'POST', body: JSON.stringify(body) });
function payload(w: Workspace): PipelineMove {
  return {
    id: crypto.randomUUID(),
    revision: w.revision,
    destination: 'unlisted',
    date: '2026-11-10T12:00:00Z',
    confirmConsequences: true,
    items: [{ itemId: w.items[0].id }],
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: owner });
  mocks.origin.mockReturnValue(undefined);
  mocks.load.mockResolvedValue(assistantWorkspace());
  mocks.rpc.mockImplementation(async (name: string) =>
    name === 'verify_thrift_log'
      ? { data: { schemaVersion: 5, pipelineMoves: true }, error: null }
      : { data: 1, error: null },
  );
});
it('uses one canonical Supabase transaction and confirms the returned database revision', async () => {
  const w = assistantWorkspace(),
    input = payload(w);
  const response = await POST(request(input));
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.workspace.revision).toBe(1);
  expect(result.successIds).toEqual([w.items[0].id]);
  expect(mocks.rpc.mock.calls.filter((call) => call[0] === 'commit_workspace')).toHaveLength(1);
  expect(mocks.rpc.mock.calls.at(-1)![0]).toBe('commit_workspace');
});
it('authenticates first, rejects stale revisions, and rejects a cross-origin request', async () => {
  const input = payload(assistantWorkspace());
  mocks.user.mockRejectedValueOnce(new Error('Unauthorized'));
  expect((await POST(request(input))).status).toBe(401);
  expect(mocks.load).not.toHaveBeenCalled();
  mocks.load.mockResolvedValue({ ...assistantWorkspace(), revision: 99 });
  expect((await POST(request(input))).status).toBe(409);
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.origin.mockImplementation(() => {
    throw new Error('Invalid origin');
  });
  expect((await POST(request(input))).status).toBe(400);
});
it('replays a lost response without a second write and reports a failed save without confirming success', async () => {
  const w = assistantWorkspace(),
    input = payload(w);
  const saved = await applyPipelineMove(w, input);
  mocks.load.mockResolvedValue(saved.workspace);
  const response = await POST(request(input));
  expect((await response.json()).replayed).toBe(true);
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.load.mockResolvedValue(w);
  mocks.rpc.mockImplementation(async (name: string) =>
    name === 'verify_thrift_log'
      ? { data: { schemaVersion: 5, pipelineMoves: true }, error: null }
      : { data: null, error: { message: 'private details' } },
  );
  const failure = await POST(request(input));
  expect(failure.status).toBe(400);
  expect((await failure.json()).error).not.toContain('private details');
});
it('returns valid item results and explicit partial failures instead of claiming all items succeeded', async () => {
  const w = assistantWorkspace();
  w.items.push({ ...w.items[0], id: crypto.randomUUID(), sku: 'ARCHIVED', status: 'Archived' });
  mocks.load.mockResolvedValue(w);
  const input = payload(w);
  input.items.push({ itemId: crypto.randomUUID() });
  const response = await POST(request(input));
  const data = await response.json();
  expect(data.successIds).toEqual([w.items[0].id]);
  expect(data.failures).toHaveLength(1);
  expect(data.failures[0].message).toBe('Inventory item was not found.');
  expect(mocks.rpc.mock.calls.filter((call) => call[0] === 'commit_workspace')).toHaveLength(1);
});

it('blocks unsupported database versions with a specific setup message before any write', async () => {
  mocks.rpc.mockResolvedValue({ data: { schemaVersion: 4 }, error: null });
  const response = await POST(request(payload(assistantWorkspace())));
  expect(response.status).toBe(503);
  expect((await response.json()).error).toContain('202611100001');
  expect(mocks.rpc.mock.calls.filter((call) => call[0] === 'commit_workspace')).toHaveLength(0);
});

it('scopes moves to the authenticated workspace and never resolves a foreign item ID from request parameters', async () => {
  const w = assistantWorkspace();
  const foreign = crypto.randomUUID();
  const input = { ...payload(w), userId: foreign, items: [{ itemId: foreign }] };
  const response = await POST(request(input));
  const result = await response.json();
  expect(mocks.load).toHaveBeenCalledWith(owner);
  expect(result.successIds).toEqual([]);
  expect(result.failures).toEqual([{ itemId: foreign, message: 'Inventory item was not found.' }]);
  const commit = mocks.rpc.mock.calls.find((call) => call[0] === 'commit_workspace')!;
  expect(commit[1].p_user_id).toBe(owner);
  expect(commit[1].p_payload.items).toEqual(w.items);
});
it('rejects foreign private photo references before a pipeline commit', async () => {
  const w = assistantWorkspace();
  w.items[0].photos = [`${crypto.randomUUID()}/private.jpg`];
  mocks.load.mockResolvedValue(w);
  const response = await POST(request(payload(w)));
  expect(response.status).toBe(400);
  expect((await response.json()).error).toContain('photos must belong');
  expect(mocks.rpc.mock.calls.filter((call) => call[0] === 'commit_workspace')).toHaveLength(0);
});
