import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { extractedSale, extractedLine, assistantWorkspace } from './helpers/assistant';
import { createBatch } from '../src/lib/assistant/drafts';
import { approvalCommands, alreadyApproved, previewBatch } from '../src/lib/assistant/planner';
import { correctBatch } from '../src/lib/assistant/corrections';
import { applyCommand } from '../src/lib/commands';
const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  checkOrigin: vi.fn(),
  rpc: vi.fn(),
  download: vi.fn(),
  load: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('../src/lib/supabase/server', () => ({
  requireUser: mocks.requireUser,
  checkOrigin: mocks.checkOrigin,
  adminClient: () => ({ rpc: mocks.rpc, storage: { from: () => ({ download: mocks.download }) } }),
}));
vi.mock('../src/lib/supabase/workspace', () => ({ loadWorkspace: mocks.load }));
import { POST } from '../src/app/api/assistant/approve/route';
const batch = () =>
  createBatch(
    [
      {
        hash: 'a'.repeat(64),
        name: 'sale.png',
        extraction: {
          records: [extractedSale({ lines: [extractedLine({ listingId: 'listing-1' })] })],
          message: '',
        },
      },
    ],
    assistantWorkspace(),
  );
const request = (body: unknown) =>
  new Request('https://thrift.test/api/assistant/approve', {
    method: 'POST',
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: 'owner' });
  mocks.checkOrigin.mockReturnValue(undefined);
  mocks.load.mockResolvedValue(assistantWorkspace());
  mocks.rpc.mockResolvedValue({ data: 1, error: null });
});
afterEach(() => vi.restoreAllMocks());
describe('editing and corrections', () => {
  it('edits pending records in place, recalculating without business writes', () => {
    const w = assistantWorkspace(),
      b = batch(),
      original = JSON.stringify(w);
    const result = correctBatch(b, 'Actually, the first item sold for $35.', w);
    expect(result.changed).toBe(true);
    expect(result.batch.rows[0].id).toBe(b.rows[0].id);
    expect(result.batch.rows).toHaveLength(1);
    expect(previewBatch(w, result.batch)[0].totals?.profit).toBe(1600);
    expect(JSON.stringify(w)).toBe(original);
    expect(b.rows[0].facts.lines[0].price).toBe(4500);
  });
  it('updates seller shipping and marketplace and asks about ambiguous records', () => {
    const w = assistantWorkspace(),
      b = batch();
    expect(
      correctBatch(b, 'The jacket shipping cost was $5, not $3.', w).batch.rows[0].facts.shipping,
    ).toBe(500);
    expect(correctBatch(b, 'That was Depop, not Vinted.', w).batch.rows[0].facts.marketplace).toBe(
      'Depop',
    );
    b.rows.push({ ...structuredClone(b.rows[0]), id: crypto.randomUUID() });
    expect(correctBatch(b, 'Change the jacket shipping to $5.', w).changed).toBe(false);
    expect(
      correctBatch(b, 'The second item sold for $35.', w).batch.rows[1].facts.lines[0].price,
    ).toBe(3500);
  });
  it('chooses only an explicit unique inventory description and never applies ambiguous matches', () => {
    const w = assistantWorkspace(),
      b = batch();
    w.items[0].title = 'blue Nike hoodie';
    expect(
      correctBatch(b, 'The first item is the blue Nike hoodie in my inventory.', w).changed,
    ).toBe(true);
    w.items.push({ ...w.items[0], id: crypto.randomUUID(), sku: 'NIKE-2' });
    expect(
      correctBatch(b, 'The first item is the blue Nike hoodie in my inventory.', w).changed,
    ).toBe(false);
  });
  it('excludes rows while preserving unresolved drafts and audit provenance', () => {
    const w = assistantWorkspace(),
      b = batch();
    b.rows.push({ ...structuredClone(b.rows[0]), id: crypto.randomUUID(), included: false });
    const commands = approvalCommands(w, b, [b.rows[0].id]);
    expect(commands.map((c) => c.type)).toEqual(['order', 'import']);
    const saved = commands.reduce(applyCommand, w);
    expect(alreadyApproved(saved, b, [b.rows[0].id])).toBe(true);
    expect(saved.imports[0].mapping.format).toBe('assistant-v1');
    const audit = JSON.parse(saved.imports[0].rawCsv);
    expect(audit.extracted.lines[0].price).toBe(4500);
    expect(audit.corrected.lines[0].price).toBe(4500);
    expect(() => approvalCommands(w, b, [b.rows[1].id])).toThrow();
  });
});
describe('server approval boundary', () => {
  it('revalidates current inventory and confirms only the transactional database result', async () => {
    const b = batch();
    const response = await POST(request({ batch: b, rowIds: [b.rows[0].id] }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.workspace.orders).toHaveLength(1);
    expect(body.workspace.revision).toBe(1);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls[0][0]).toBe('commit_workspace');
    expect(
      mocks.rpc.mock.calls[0][1].p_payload.listings.map((l: { status: string }) => l.status),
    ).toEqual(['Sold', 'Needs delisting']);
  });
  it('requires authentication and origin validation before touching records', async () => {
    mocks.requireUser.mockRejectedValue(new Error('Unauthorized'));
    expect((await POST(request({}))).status).toBe(401);
    expect(mocks.load).not.toHaveBeenCalled();
    mocks.checkOrigin.mockImplementation(() => {
      throw new Error('Invalid origin');
    });
    expect((await POST(request({}))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('handles stale previews and database revision races without saving', async () => {
    const b = batch(),
      w = assistantWorkspace();
    w.revision = 1;
    mocks.load.mockResolvedValue(w);
    expect((await POST(request({ batch: b, rowIds: [b.rows[0].id] }))).status).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.load.mockResolvedValue(assistantWorkspace());
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'revision_conflict' } });
    expect((await POST(request({ batch: b, rowIds: [b.rows[0].id] }))).status).toBe(409);
  });
  it('rejects changed cost basis, missing fees and duplicate rows during approval', async () => {
    const b = batch();
    b.rows[0].facts.fees = null;
    expect((await POST(request({ batch: b, rowIds: [b.rows[0].id] }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(
      (await POST(request({ batch: batch(), rowIds: [b.rows[0].id, b.rows[0].id] }))).status,
    ).toBe(400);
  });
  it('replays a durable receipt after a lost response without a second write', async () => {
    const w = assistantWorkspace(),
      b = batch(),
      ids = [b.rows[0].id];
    const saved = approvalCommands(w, b, ids).reduce(applyCommand, w);
    mocks.load.mockResolvedValue(saved);
    const response = await POST(request({ batch: b, rowIds: ids }));
    expect(response.status).toBe(200);
    expect((await response.json()).replayed).toBe(true);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('reports a failed/unconfirmed save and leaves the submitted draft intact', async () => {
    const b = batch(),
      before = JSON.stringify(b);
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'private database detail' } });
    const response = await POST(request({ batch: b, rowIds: [b.rows[0].id] }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).not.toContain('private database detail');
    expect(JSON.stringify(b)).toBe(before);
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect((await POST(request({ batch: b, rowIds: [b.rows[0].id] }))).status).toBe(400);
  });
});

it('verifies private screenshot ownership and hash before a financial write', async () => {
  const { createHash } = await import('node:crypto');
  const owner = '11111111-1111-4111-8111-111111111111';
  mocks.requireUser.mockResolvedValue({ id: owner });
  const b = batch();
  b.screenshots[0].reference = 'another-owner/file.jpg';
  expect((await POST(request({ batch: b, rowIds: [b.rows[0].id] }))).status).toBe(400);
  expect(mocks.download).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
  const data = new Blob(['private screenshot bytes']);
  const hash = createHash('sha256')
    .update(new Uint8Array(await data.arrayBuffer()))
    .digest('hex');
  b.screenshots[0].hash = hash;
  b.rows[0].sourceHash = hash;
  b.screenshots[0].reference = `${owner}/22222222-2222-4222-8222-222222222222.jpg`;
  mocks.download.mockResolvedValue({ data: new Blob(['wrong bytes']), error: null });
  expect((await POST(request({ batch: b, rowIds: [b.rows[0].id] }))).status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.download.mockResolvedValue({ data, error: null });
  expect((await POST(request({ batch: b, rowIds: [b.rows[0].id] }))).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
});

import { fiveUnknownListings } from './helpers/assistant';
import { emptyWorkspace } from '../src/lib/model';
import { changeListingCost } from '../src/lib/assistant/listing-review';
it('approves five unknown active listings in one Supabase RPC and replays without duplicating inventory', async () => {
  const w = emptyWorkspace(),
    b = fiveUnknownListings(w);
  const rowIds = b.rows.map((row) => row.id);
  mocks.load.mockResolvedValue(w);
  expect((await POST(request({ batch: b, rowIds }))).status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
  b.rows = b.rows.map((row, index) => changeListingCost(w, row, 0, String(index * 5)));
  for (const row of b.rows) {
    row.matches[0].newItem!.purchasedAt = '2026-10-01';
    row.matches[0].newItem!.confirmedDistinct = true;
  }
  const response = await POST(request({ batch: b, rowIds }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(mocks.rpc.mock.calls[0][0]).toBe('commit_workspace');
  expect(body.workspace.items).toHaveLength(5);
  expect(body.workspace.listings).toHaveLength(5);
  expect(body.workspace.imports).toHaveLength(5);
  mocks.load.mockResolvedValue(body.workspace);
  const replay = await POST(request({ batch: b, rowIds }));
  expect((await replay.json()).replayed).toBe(true);
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
});

import { applyBatchCost } from '../src/lib/assistant/review-bulk';
it('accepts four cost-only new listings through one Supabase transaction with no routine confirmation flags', async () => {
  const w = emptyWorkspace(),
    initial = fiveUnknownListings(w);
  initial.rows = initial.rows.slice(0, 4);
  const batch = applyBatchCost(w, initial, 'same', '5');
  mocks.load.mockResolvedValue(w);
  expect(batch.rows.every((r) => !r.matches[0].newItem!.confirmedDistinct)).toBe(true);
  const response = await POST(request({ batch, rowIds: batch.rows.map((r) => r.id) }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.workspace.items).toHaveLength(4);
  expect(body.workspace.listings).toHaveLength(4);
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
});
