import { beforeEach, it, expect, vi } from 'vitest';
import sharp from 'sharp';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  download: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  from: vi.fn(),
}));
vi.mock('../src/lib/supabase/server', () => ({
  adminClient: () => ({ rpc: mocks.rpc, storage: { from: mocks.from } }),
}));
import {
  chatFiles,
  readChatFile,
  saveChatFile,
  clearChatFiles,
} from '../src/lib/assistant/chat-files';
import {
  readAttachment,
  attachmentRows,
  attachmentColumnSummary,
  prepareAttachmentImport,
} from '../src/lib/assistant/attachment-analysis';
const owner = '11111111-1111-4111-8111-111111111111',
  friend = '22222222-2222-4222-8222-222222222222';
let records: Record<string, unknown>[], objects: Map<string, Uint8Array>;
beforeEach(() => {
  vi.clearAllMocks();
  records = [];
  objects = new Map();
  mocks.from.mockReturnValue({
    download: mocks.download,
    upload: mocks.upload,
    remove: mocks.remove,
  });
  mocks.rpc.mockImplementation(async (_name, { p_action, p_user_id, p_data }) => {
    const owned = records.filter((r) => r.owner === p_user_id);
    if (p_action === 'list')
      return { data: owned.filter((r) => !p_data.ids || p_data.ids.includes(r.id)), error: null };
    if (p_action === 'create') {
      const existing = owned.find((r) => r.id === p_data.id);
      if (existing) return { data: existing, error: null };
      const ext =
        p_data.mime === 'image/png' ? 'png' : p_data.mime === 'application/pdf' ? 'pdf' : 'csv';
      const f = { ...p_data, owner: p_user_id, path: `${p_user_id}/${p_data.id}.${ext}` };
      records.push(f);
      return { data: f, error: null };
    }
    records = records.filter((r) => r.owner !== p_user_id || !p_data.ids.includes(r.id));
    return { data: { deleted: true }, error: null };
  });
  mocks.upload.mockImplementation(async (path, bytes) => {
    objects.set(path, bytes);
    return { error: null };
  });
  mocks.download.mockImplementation(async (path) => ({
    data: objects.has(path) ? new Blob([Buffer.from(objects.get(path)!)]) : null,
    error: null,
  }));
  mocks.remove.mockImplementation(async (paths: string[]) => {
    paths.forEach((p) => objects.delete(p));
    return { error: null };
  });
});
async function csv(text: string) {
  return saveChatFile(
    owner,
    crypto.randomUUID(),
    new File([text], 'sheet.csv', { type: 'text/csv' }),
  );
}
it('stores source identity privately, makes upload retries idempotent, and denies foreign IDs before storage access', async () => {
  const f = await csv('Item,Sold Price\nTee,35');
  expect(f.path).toBe(`${owner}/${f.id}.csv`);
  expect(mocks.from).toHaveBeenCalledWith('assistant-files');
  expect((await readChatFile(owner, f.id)).bytes.length).toBe(f.size);
  const writes = mocks.upload.mock.calls.length;
  await saveChatFile(
    owner,
    f.id,
    new File(['Item,Sold Price\nTee,35'], 'sheet.csv', { type: 'text/csv' }),
  );
  expect(mocks.upload).toHaveBeenCalledTimes(writes);
  await expect(
    saveChatFile(owner, f.id, new File(['Item,Sold Price\nTee,99'], 'sheet.csv')),
  ).rejects.toThrow('changed');
  const downloads = mocks.download.mock.calls.length;
  await expect(readChatFile(friend, f.id)).rejects.toThrow('not available');
  expect(mocks.download).toHaveBeenCalledTimes(downloads);
});
it('rejects corrupt source bytes, foreign storage paths, revoked access and invalid formats', async () => {
  const f = await csv('Item,Price\nTee,35');
  objects.set(f.path, new TextEncoder().encode('Item,Price\nTee,99'));
  await expect(readChatFile(owner, f.id)).rejects.toThrow('does not match');
  records[0].path = `${friend}/${f.id}.csv`;
  await expect(chatFiles(owner)).rejects.toThrow('identity');
  mocks.rpc.mockResolvedValueOnce({ error: { message: 'workspace_access_denied' }, data: null });
  await expect(chatFiles(owner)).rejects.toThrow('Unauthorized');
  await expect(
    saveChatFile(
      owner,
      crypto.randomUUID(),
      new File(['<script>bad</script>'], 'fake.png', { type: 'image/png' }),
    ),
  ).rejects.toThrow('readable');
  await expect(
    saveChatFile(
      owner,
      crypto.randomUUID(),
      new File(['%PDF-1.4\n/Encrypt true\n%%EOF'], 'locked.pdf'),
    ),
  ).rejects.toThrow('Password-protected');
});
it('reads general CSV questions in bounded parts, strips contact columns, and computes exact literal amounts without formulas or guessed costs', async () => {
  const f = await csv(
    'Personal spreadsheet\nItem,Purchased Price,Sold Price,Buyer Email\nTee,0,35,private@example.test\nCoat,,12.34,secret@example.test\nHat,=SUM(2),bad,hidden@example.test\nTotal,999,9999,',
  );
  const output = await readAttachment(owner, f.id, 0);
  expect(JSON.stringify(output)).not.toContain('@example.test');
  expect(JSON.stringify(output)).toContain('Personal spreadsheet');
  const summary = await attachmentColumnSummary(owner, f.id, 'Purchased Price');
  expect(summary).toMatchObject({
    rows: 3,
    known: 1,
    missing: 1,
    invalid: 1,
    confirmedZeros: 1,
    sumOfKnownCents: 0,
    complete: false,
  });
  expect(await attachmentColumnSummary(owner, f.id, 'Sold Price')).toMatchObject({
    rows: 3,
    known: 2,
    invalid: 1,
    sumOfKnownCents: 4734,
    complete: false,
  });
  await expect(attachmentColumnSummary(owner, f.id, 'Buyer Email')).rejects.toThrow('non-contact');
  expect((await attachmentRows(owner, f.id, 'Coat', 0)).rows).toHaveLength(1);
  expect((await attachmentRows(owner, f.id, 'private@example.test', 0)).rows).toHaveLength(0);
  const many = await csv(
    'Item,Sold Price\n' + Array.from({ length: 333 }, (_, i) => `Tee ${i},1`).join('\n'),
  );
  const part = JSON.parse((await readAttachment(owner, many.id, 0))[0].text!);
  expect(part.totalRows).toBe(333);
  expect(part.parts).toBe(12);
  expect(part.data.split('\n').length).toBeLessThanOrEqual(32);
  await expect(prepareAttachmentImport(owner, [many], 'Import these sales', 'UTC')).rejects.toThrow(
    '300',
  );
});
it('preserves native image/PDF input and rejects invalid part indexes', async () => {
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#123456' } })
    .png()
    .toBuffer();
  const f = await saveChatFile(owner, crypto.randomUUID(), new File([image], 'photo.png'));
  expect((await readAttachment(owner, f.id, 0))[1]).toMatchObject({ type: 'input_image' });
  await expect(readAttachment(owner, f.id, 1)).rejects.toThrow('one part');
  const pdf = await saveChatFile(
    owner,
    crypto.randomUUID(),
    new File(['%PDF-1.4\n%%EOF'], 'source.pdf'),
  );
  expect((await readAttachment(owner, pdf.id, 0))[1]).toMatchObject({ type: 'input_file' });
});
it('prepares irregular sales as review drafts, retains private file identity and never calls the provider for known CSVs', async () => {
  const f = await csv('Item,Purchased Price,Sold Price\nTee,12,35\nHat,0,10');
  const fetcher = vi.fn();
  const result = await prepareAttachmentImport(
    owner,
    [f],
    'Import these sales from Depop on 2026-11-12',
    'America/New_York',
    fetcher,
  );
  expect(fetcher).not.toHaveBeenCalled();
  expect(result[0].chatFileId).toBe(f.id);
  expect(result[0].originalHash).toBe(f.hash);
  expect(result[0].extraction.records).toHaveLength(2);
  expect(result[0].extraction.records[0]).toMatchObject({
    marketplace: 'Depop',
    date: '2026-11-12',
    fees: null,
  });
  expect(result[0].extraction.records[1].lines[0].purchaseCost).toBe(0);
  const stock = await csv('Item,Price\nUnsold tee,35');
  await expect(
    prepareAttachmentImport(owner, [stock], 'Import my unsold inventory', 'UTC', fetcher),
  ).rejects.toThrow('Inventory');
  expect(fetcher).not.toHaveBeenCalled();
});
it('clears only owned assistant sources and never removes approved inventory photos or another user’s files', async () => {
  const f = await csv('Item,Price\nTee,35');
  const other = {
    ...records[0],
    id: crypto.randomUUID(),
    owner: friend,
    path: `${friend}/other.csv`,
  };
  records.push(other);
  objects.set(`${owner}/approved.jpg`, new Uint8Array([1, 2]));
  expect(await clearChatFiles(owner)).toBe(1);
  expect(objects.has(f.path)).toBe(false);
  expect(objects.has(`${owner}/approved.jpg`)).toBe(true);
  expect(records).toContainEqual(other);
  expect(mocks.from.mock.calls.every(([bucket]) => bucket === 'assistant-files')).toBe(true);
});
