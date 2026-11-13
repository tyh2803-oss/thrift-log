import { beforeEach, it, expect, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ user: vi.fn(), origin: vi.fn(), read: vi.fn(), save: vi.fn() }));
vi.mock('../src/lib/supabase/server', () => ({
  requireUser: mocks.user,
  checkOrigin: mocks.origin,
}));
vi.mock('../src/lib/assistant/chat-files', () => ({
  readChatFile: mocks.read,
  saveChatFile: mocks.save,
}));
import { GET, POST } from '../src/app/api/assistant/files/route';
import { AssistantError } from '../src/lib/assistant/openai';
const owner = '11111111-1111-4111-8111-111111111111',
  friend = '22222222-2222-4222-8222-222222222222',
  id = '33333333-3333-4333-8333-333333333333';
const file = {
  id,
  name: 'private.csv',
  mime: 'text/csv',
  hash: 'a'.repeat(64),
  size: 18,
  path: `${owner}/${id}.csv`,
};
const url = `https://app.test/api/assistant/files?id=${id}`;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: owner });
  mocks.origin.mockReturnValue(undefined);
  mocks.read.mockResolvedValue({ file, bytes: new TextEncoder().encode('Item,Price\nTee,35') });
  mocks.save.mockResolvedValue(file);
});
function upload() {
  const body = new FormData();
  body.set('file', new File(['Item,Price\nTee,35'], 'private.csv', { type: 'text/csv' }));
  body.set('id', id);
  body.set('userId', friend);
  return new Request(url, { method: 'POST', body });
}
it('derives file ownership from the session, never trusts injected actors, and exposes no storage paths', async () => {
  const result = await POST(upload());
  expect(result.status).toBe(200);
  expect(mocks.save.mock.calls[0].slice(0, 2)).toEqual([owner, id]);
  expect(JSON.stringify(await result.json())).not.toContain(file.path);
  const read = await GET(new Request(url));
  expect(read.status).toBe(200);
  expect(mocks.read).toHaveBeenCalledWith(owner, id);
  expect(read.headers.get('Cache-Control')).toContain('no-store');
  expect(read.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(read.headers.get('Content-Disposition')).toContain('attachment;');
});
it('denies unauthenticated, revoked, foreign-file and cross-site requests before returning bytes', async () => {
  mocks.user.mockRejectedValueOnce(new Error('Unauthorized'));
  expect((await GET(new Request(url))).status).toBe(401);
  expect(mocks.read).not.toHaveBeenCalled();
  mocks.origin.mockImplementationOnce(() => {
    throw new Error('Wrong origin');
  });
  expect((await POST(upload())).status).toBe(400);
  expect(mocks.save).not.toHaveBeenCalled();
  mocks.user.mockResolvedValue({ id: friend });
  mocks.read.mockRejectedValueOnce(new AssistantError('Attachment not available.', 404));
  expect((await GET(new Request(url))).status).toBe(404);
  expect(mocks.read).toHaveBeenCalledWith(friend, id);
  mocks.read.mockRejectedValueOnce(new Error('Unauthorized'));
  expect((await GET(new Request(url))).status).toBe(401);
});
it('bounds uploads before parsing and sanitizes unexpected storage failures', async () => {
  const huge = new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv' },
    body: 'x'.repeat(5400000),
  });
  expect((await POST(huge)).status).toBe(413);
  expect(mocks.save).not.toHaveBeenCalled();
  mocks.read.mockRejectedValueOnce(new Error('PRIVATE_STORAGE_DIAGNOSTIC'));
  const result = await GET(new Request(url));
  expect(await result.text()).not.toContain('PRIVATE_STORAGE_DIAGNOSTIC');
});
