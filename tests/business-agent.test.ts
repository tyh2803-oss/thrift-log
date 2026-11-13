import { beforeEach, afterEach, it, expect, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const storage = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock('../src/lib/supabase/server', () => ({
  adminClient: () => ({ storage: { from: () => ({ download: storage.download }) } }),
}));
import { runBusinessAssistant, readOwnedPhoto } from '../src/lib/assistant/business-agent';
import { businessWorkspace, emptyDrafts } from './helpers/business-assistant';
const owner = '11111111-1111-4111-8111-111111111111';
const response = (output: unknown[], status = 'completed') =>
  Response.json({ status, output, usage: { input_tokens: 100, output_tokens: 20 } });
const answer = (message = 'Recorded revenue is $0.00.', choices: unknown[] = []) =>
  response([
    {
      type: 'message',
      content: [{ type: 'output_text', text: JSON.stringify({ message, choices }) }],
    },
  ]);
const call = (
  name = 'business_summary',
  args: unknown = { period: 'All time', from: null, to: null, marketplace: null },
) => ({
  type: 'function_call',
  call_id: crypto.randomUUID(),
  name,
  arguments: JSON.stringify(args),
});
beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', 'fake-agent-test-key');
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllEnvs());
const options = () => ({
  userId: owner,
  workspace: businessWorkspace(),
  messages: [{ id: crypto.randomUUID(), role: 'user' as const, text: 'How is my business doing?' }],
  drafts: emptyDrafts,
  selectedItemId: null,
  authorize: vi.fn().mockResolvedValue(undefined),
});
it('uses Sol reasoning and typed read tools, preserves reasoning items, and never asks a provider to store responses', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      response([{ type: 'reasoning', encrypted_content: 'opaque-test-reasoning' }, call()]),
    )
    .mockResolvedValueOnce(answer());
  const result = await runBusinessAssistant({ ...options(), fetcher });
  expect(result.tools).toEqual(['business_summary']);
  expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 40 });
  const first = JSON.parse(fetcher.mock.calls[0][1].body),
    second = JSON.parse(fetcher.mock.calls[1][1].body);
  expect(first).toMatchObject({
    model: 'gpt-6.1-sol',
    store: false,
    reasoning: { effort: 'medium' },
  });
  expect(first.tools.every((t: { strict: boolean }) => t.strict)).toBe(true);
  expect(
    second.input.some(
      (i: { encrypted_content?: string }) => i.encrypted_content === 'opaque-test-reasoning',
    ),
  ).toBe(true);
  expect(
    second.input.some(
      (i: { type: string; output?: string }) =>
        i.type === 'function_call_output' && JSON.parse(i.output!).revenue === 0,
    ),
  ).toBe(true);
});
it('rejects invented tools and foreign IDs and does not expose raw diagnostics or unsafe choice IDs', async () => {
  const foreign = crypto.randomUUID();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      response([
        call('execute_sql', { query: 'drop table items' }),
        call('get_record', { kind: 'item', id: foreign }),
      ]),
    )
    .mockResolvedValueOnce(
      answer('I need an owned record.', [{ itemId: foreign, label: 'Other user', text: 'Use it' }]),
    );
  const result = await runBusinessAssistant({ ...options(), fetcher });
  expect(result.choices).toEqual([]);
  const second = JSON.parse(fetcher.mock.calls[1][1].body);
  const outputs = second.input
    .filter((i: { type: string }) => i.type === 'function_call_output')
    .map((i: { output: string }) => JSON.parse(i.output));
  expect(outputs.map((o: { error: string }) => o.error)).toEqual([
    'This tool is not allowed.',
    'Record not available in this workspace.',
  ]);
  expect(result.drafts).toEqual(emptyDrafts);
});
it('bounds tool loops and aborts after revocation before returning any proposal', async () => {
  const endless = vi.fn().mockImplementation(async () => response([call(), call(), call()]));
  await expect(runBusinessAssistant({ ...options(), fetcher: endless })).rejects.toThrow(
    'too many analysis',
  );
  expect(endless.mock.calls.length).toBeLessThanOrEqual(6);
  const authorized = options();
  authorized.authorize
    .mockResolvedValueOnce(undefined)
    .mockRejectedValue(new Error('Unauthorized'));
  await expect(
    runBusinessAssistant({ ...authorized, fetcher: vi.fn().mockResolvedValue(response([call()])) }),
  ).rejects.toThrow('Unauthorized');
});
it('keeps private photos owner-scoped and inline instead of exposing public or arbitrary storage URLs', async () => {
  const item = businessWorkspace().items[0];
  item.photos = [`${crypto.randomUUID()}/${crypto.randomUUID()}.jpg`];
  await expect(readOwnedPhoto(owner, item, 0)).rejects.toThrow('not available');
  expect(storage.download).not.toHaveBeenCalled();
  item.photos = [`${owner}/${crypto.randomUUID()}.jpg`];
  storage.download.mockResolvedValue({
    data: new Blob([new Uint8Array([255, 216, 255])]),
    error: null,
  });
  const output = await readOwnedPhoto(owner, item, 0);
  expect(output[1]).toMatchObject({ type: 'input_image' });
  expect(JSON.stringify(output)).toContain('data:image/jpeg;base64,');
});
