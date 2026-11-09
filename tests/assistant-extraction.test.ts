import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractionSchema } from '../src/lib/assistant/schema';
import { extractedSale } from './helpers/assistant';
vi.mock('server-only', () => ({}));
const auth = vi.hoisted(() => ({ requireUser: vi.fn(), checkOrigin: vi.fn() }));
vi.mock('../src/lib/supabase/server', () => auth);
import {
  assistantConfig,
  clearExtractionCache,
  extractScreenshot,
} from '../src/lib/assistant/openai';
import { GET, POST } from '../src/app/api/assistant/extract/route';
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const extraction = () => ({ records: [extractedSale()], message: 'One sale found.' });
const result = (data: unknown) =>
  new Response(
    JSON.stringify({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] }],
    }),
    { status: 200 },
  );
const request = (files: File[] = [new File([png], 'sale.png', { type: 'image/png' })]) => {
  const form = new FormData();
  files.forEach((f) => form.append('images', f));
  return new Request('https://thrift.test/api/assistant/extract', { method: 'POST', body: form });
};
beforeEach(() => {
  vi.clearAllMocks();
  clearExtractionCache();
  vi.stubEnv('OPENAI_API_KEY', 'test-key-never-real');
  auth.requireUser.mockResolvedValue({ id: 'owner' });
  auth.checkOrigin.mockReturnValue(undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe('structured extraction', () => {
  it('keeps missing costs unknown and rejects fabricated schema values', () => {
    expect(
      extractionSchema.parse({ records: [extractedSale({ fees: null })], message: '' }).records[0]
        .fees,
    ).toBeNull();
    expect(() =>
      extractionSchema.parse({ records: [extractedSale({ fees: -1 })], message: '' }),
    ).toThrow();
  });
  it('uses the Responses vision contract, Zod output, and no remote storage', async () => {
    const fetcher = vi.fn().mockResolvedValue(result(extraction()));
    const actual = await extractScreenshot('owner', png, 'image/png', fetcher);
    expect(actual.extraction.records[0].lines[0].price).toBe(4500);
    expect(actual.hash).toMatch(/^[a-f0-9]{64}$/);
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body).toMatchObject({
      store: false,
      text: { format: { type: 'json_schema', strict: true } },
    });
    expect(body.input[0].content[1].image_url).toMatch(/^data:image\/png;base64,/);
    expect(fetcher.mock.calls[0][0]).toBe('https://api.openai.com/v1/responses');
  });
  it('deduplicates repeated images within an owner, never across owners', async () => {
    const fetcher = vi.fn().mockImplementation(async () => result(extraction()));
    await Promise.all([
      extractScreenshot('a', png, 'image/png', fetcher),
      extractScreenshot('a', png, 'image/png', fetcher),
    ]);
    await extractScreenshot('b', png, 'image/png', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([429, 401, 500])(
    'handles provider HTTP %s without exposing payloads or keys',
    async (status) => {
      const fetcher = vi.fn().mockResolvedValue(new Response('private diagnostic', { status }));
      await expect(extractScreenshot('owner', png, 'image/png', fetcher)).rejects.toThrow(/OpenAI/);
    },
  );
  it('preserves a retry after invalid output, refusal, truncation, or network failure', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(result({ records: [{ invalid: true }] }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'incomplete' })))
      .mockRejectedValueOnce(new Error('internal secret'))
      .mockResolvedValueOnce(result(extraction()));
    for (let i = 0; i < 3; i++)
      await expect(extractScreenshot('owner', png, 'image/png', fetcher)).rejects.toThrow();
    expect(
      (await extractScreenshot('owner', png, 'image/png', fetcher)).extraction.records,
    ).toHaveLength(1);
  });
});
describe('authenticated screenshot route', () => {
  it('supports multiple screenshots and drops byte-identical attachments', async () => {
    const fetcher = vi.fn().mockImplementation(async () => result(extraction()));
    vi.stubGlobal('fetch', fetcher);
    const response = await POST(
      request([
        new File([png], 'a.png'),
        new File([png], 'b.png'),
        new File([png, new Uint8Array([1])], 'c.png'),
      ]),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).screenshots).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('requires authentication and origin checks before API spending', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    auth.requireUser.mockRejectedValue(new Error('Unauthorized'));
    expect((await POST(request())).status).toBe(401);
    expect((await GET()).status).toBe(401);
    auth.checkOrigin.mockImplementation(() => {
      throw new Error('Invalid request origin');
    });
    expect((await POST(request())).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('explains a missing API key without inventing an extraction', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain('OPENAI_API_KEY');
    expect(await (await GET()).json()).toMatchObject({ enabled: false });
  });
  it('validates formats, empty batches, count and configurable limits', async () => {
    expect((await POST(request([new File(['<svg/>'], 'pretend.png')]))).status).toBe(400);
    expect((await POST(request([]))).status).toBe(400);
    expect(
      (await POST(request(Array.from({ length: 11 }, () => new File([png], 'x.png'))))).status,
    ).toBe(400);
    vi.stubEnv('ASSISTANT_BATCH_LIMIT', '2');
    expect(assistantConfig().batchLimit).toBe(2);
    vi.stubEnv('ASSISTANT_BATCH_LIMIT', '1000');
    expect(assistantConfig().batchLimit).toBe(10);
  });
});
