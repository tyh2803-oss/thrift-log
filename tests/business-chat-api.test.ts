import { beforeEach, afterEach, it, expect, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  origin: vi.fn(),
  load: vi.fn(),
  store: vi.fn(),
  agent: vi.fn(),
}));
vi.mock('../src/lib/supabase/server', () => ({
  requireUser: mocks.user,
  checkOrigin: mocks.origin,
}));
vi.mock('../src/lib/supabase/workspace', () => ({ loadWorkspace: mocks.load }));
vi.mock('../src/lib/assistant/chat-store', () => ({ chatStore: mocks.store }));
vi.mock('../src/lib/assistant/business-agent', () => ({ runBusinessAssistant: mocks.agent }));
vi.mock('../src/lib/assistant/chat-files', () => ({
  chatFiles: vi.fn().mockResolvedValue([]),
  clearChatFiles: vi.fn().mockResolvedValue(0),
}));
import { GET, POST, DELETE } from '../src/app/api/assistant/chat/route';
import { AssistantError } from '../src/lib/assistant/openai';
import { businessWorkspace, emptyDrafts } from './helpers/business-assistant';
import { chatFiles, clearChatFiles } from '../src/lib/assistant/chat-files';
const owner = '11111111-1111-4111-8111-111111111111',
  friend = '22222222-2222-4222-8222-222222222222',
  lease = '33333333-3333-4333-8333-333333333333';
const reply = {
  message: 'Your recorded revenue is $0.00.',
  choices: [],
  drafts: emptyDrafts,
  model: 'gpt-6.1-sol',
  workspaceRevision: 0,
  tools: ['business_summary'],
  usage: { inputTokens: 100, outputTokens: 20 },
};
const payload = () => ({
  requestId: crypto.randomUUID(),
  revision: 3,
  message: 'How much have I made?',
  selectedItemId: null,
  drafts: emptyDrafts,
});
const request = (data: unknown) =>
  new Request('https://app.test/api/assistant/chat', {
    method: 'POST',
    body: JSON.stringify(data),
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(chatFiles).mockResolvedValue([]);
  vi.mocked(clearChatFiles).mockResolvedValue(0);
  vi.stubEnv('OPENAI_API_KEY', 'fake-test-key');
  mocks.user.mockResolvedValue({ id: owner });
  mocks.origin.mockReturnValue(undefined);
  mocks.load.mockResolvedValue(businessWorkspace());
  mocks.agent.mockResolvedValue(reply);
  mocks.store.mockImplementation(async (_id, action) =>
    action === 'claim'
      ? { revision: 3, messages: [], lease }
      : action === 'finish'
        ? { revision: 4, messages: [], response: reply }
        : action === 'cancel'
          ? null
          : {
              revision: 3,
              messages: [
                {
                  id: crypto.randomUUID(),
                  role: 'user',
                  text: 'Private owner question',
                  context: 'HIDDEN_FILE_CONTEXT',
                },
              ],
              response: null,
            },
  );
});
afterEach(() => vi.unstubAllEnvs());
it('derives chat and read-tool identity from the authenticated user and never sends a business commit', async () => {
  const response = await POST(request(payload()));
  expect(response.status).toBe(200);
  expect(mocks.load).toHaveBeenCalledWith(owner);
  expect(mocks.store.mock.calls.map((c) => c[1])).toEqual(['claim', 'finish']);
  expect(mocks.store.mock.calls.every((c) => c[0] === owner)).toBe(true);
  expect(mocks.agent.mock.calls[0][0].workspace.items[0].title).toContain('Harley');
  expect((await response.json()).revision).toBe(4);
});
it('rejects unauthorized, cross-site, injected-actor and foreign-item requests before invoking the model', async () => {
  mocks.user.mockRejectedValueOnce(new Error('Unauthorized'));
  expect((await POST(request(payload()))).status).toBe(401);
  expect(mocks.load).not.toHaveBeenCalled();
  mocks.origin.mockImplementationOnce(() => {
    throw new Error('Origin denied');
  });
  expect((await POST(request(payload()))).status).toBe(400);
  expect((await POST(request({ ...payload(), userId: friend }))).status).toBe(400);
  expect((await POST(request({ ...payload(), selectedItemId: crypto.randomUUID() }))).status).toBe(
    400,
  );
  expect(mocks.agent).not.toHaveBeenCalled();
  expect(mocks.store).not.toHaveBeenCalled();
});
it('revalidates access during reasoning, releases a failed lease, and does not persist a late revoked response', async () => {
  mocks.agent.mockImplementationOnce(async ({ authorize }) => {
    mocks.user.mockRejectedValueOnce(new Error('Unauthorized'));
    await authorize();
    return reply;
  });
  expect((await POST(request(payload()))).status).toBe(401);
  expect(mocks.store.mock.calls.map((c) => c[1])).toEqual(['claim', 'cancel']);
});
it('replays confirmed turns without another model request and keeps context conflicts actionable', async () => {
  mocks.store.mockResolvedValueOnce({ revision: 4, replayed: true, response: reply });
  const replay = await POST(request(payload()));
  expect((await replay.json()).replayed).toBe(true);
  expect(mocks.agent).not.toHaveBeenCalled();
  mocks.store.mockRejectedValueOnce(new AssistantError('Conversation changed; refresh chat.', 409));
  expect((await POST(request(payload()))).status).toBe(409);
  expect(mocks.agent).not.toHaveBeenCalled();
});
it('restores only the signed-in account’s messages, omits raw file context, and isolates Clear chat', async () => {
  const loaded = await GET();
  const data = await loaded.json();
  expect(data.messages[0].text).toBe('Private owner question');
  expect(JSON.stringify(data)).not.toContain('HIDDEN_FILE_CONTEXT');
  mocks.user.mockResolvedValue({ id: friend });
  mocks.store.mockResolvedValueOnce({ revision: 1, messages: [], response: null });
  const cleared = await DELETE(
    new Request('https://app.test/api/assistant/chat?revision=0', { method: 'DELETE' }),
  );
  expect(cleared.status).toBe(200);
  expect(mocks.store.mock.calls.at(-1)?.slice(0, 2)).toEqual([friend, 'clear']);
});
it('gates the optional migration cleanly and bounds both request size and failed provider diagnostics', async () => {
  mocks.store.mockRejectedValueOnce(new AssistantError('Administrator migration needed.', 503));
  expect((await (await GET()).json()).ready).toBe(false);
  expect((await POST(request({ ...payload(), message: 'a'.repeat(3100000) }))).status).toBe(413);
  mocks.agent.mockRejectedValueOnce(new Error('PRIVATE_PROVIDER_DIAGNOSTIC'));
  const failed = await POST(request(payload()));
  expect((await failed.json()).error).not.toContain('PRIVATE_PROVIDER_DIAGNOSTIC');
});
it('rejects foreign attachment IDs before claiming a turn and restores only owned public attachment metadata', async () => {
  const id = crypto.randomUUID(),
    file = {
      id,
      name: 'owner.csv',
      mime: 'text/csv' as const,
      size: 20,
      hash: 'a'.repeat(64),
      path: `${owner}/${id}.csv`,
    };
  expect((await POST(request({ ...payload(), fileIds: [id] }))).status).toBe(404);
  expect(mocks.agent).not.toHaveBeenCalled();
  expect(mocks.store).not.toHaveBeenCalled();
  vi.mocked(chatFiles).mockResolvedValue([file]);
  const result = await POST(request({ ...payload(), fileIds: [id] }));
  expect(result.status).toBe(200);
  expect(mocks.agent.mock.calls[0][0].files).toEqual([file]);
  expect(mocks.store.mock.calls.find((c) => c[1] === 'finish')?.[2].messages[0].fileIds).toEqual([
    id,
  ]);
  mocks.store.mockResolvedValueOnce({
    revision: 4,
    response: null,
    messages: [{ id: crypto.randomUUID(), role: 'user', text: 'Read my file', fileIds: [id] }],
  });
  const restored = await (await GET()).json();
  expect(restored.messages[0].files).toEqual([{ id, name: file.name, mime: file.mime }]);
  expect(JSON.stringify(restored)).not.toContain(file.path);
});
it('reports a completed conversation clear separately from attachment cleanup failure', async () => {
  vi.mocked(clearChatFiles).mockRejectedValueOnce(new Error('Storage unavailable'));
  const result = await DELETE(
    new Request('https://app.test/api/assistant/chat?revision=3', { method: 'DELETE' }),
  );
  expect(result.status).toBe(200);
  const data = await result.json();
  expect(data.attachmentsCleared).toBe(false);
  expect(data.notice).toContain('Conversation cleared');
  expect(clearChatFiles).toHaveBeenCalledWith(owner);
});
