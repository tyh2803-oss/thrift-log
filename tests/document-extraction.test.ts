import { readFile } from 'node:fs/promises';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const auth = vi.hoisted(() => ({ requireUser: vi.fn(), checkOrigin: vi.fn() }));
vi.mock('../src/lib/supabase/server', () => auth);
import {
  extractDocument,
  extractScreenshot,
  clearExtractionCache,
} from '../src/lib/assistant/openai';
import { prepareDocument, documentType } from '../src/lib/assistant/documents';
import { POST } from '../src/app/api/assistant/extract/route';
import { extractedLine, extractedSale } from './helpers/assistant';
const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n');
const csv = new TextEncoder().encode(
  'Name,Amount,When,Charges\nExample garment,25,2026-10-01,1.50',
);
const result = (
  records = [extractedSale({ lines: [{ ...extractedLine(), purchaseCost: null }] })],
  extra = {},
) =>
  new Response(
    JSON.stringify({
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                complete: true,
                rowsAccountedFor: 1,
                records,
                message: 'Review source records.',
                ...extra,
              }),
            },
          ],
        },
      ],
    }),
  );
const request = (files: File[], message = 'These are USD Vinted completed sale history.') => {
  const form = new FormData();
  files.forEach((f) => form.append('files', f));
  form.set('message', message);
  return new Request('https://app.test/api/assistant/extract', { method: 'POST', body: form });
};
beforeEach(() => {
  vi.clearAllMocks();
  clearExtractionCache();
  vi.stubEnv('OPENAI_API_KEY', 'test-key-not-real');
  auth.requireUser.mockResolvedValue({ id: 'owner' });
  auth.checkOrigin.mockReturnValue(undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it('accepts bounded PDFs/UTF-8 CSVs but rejects forged, truncated, encrypted and binary documents', () => {
  expect(documentType({ name: 'report.CSV', type: '' })).toBe('csv');
  expect(prepareDocument(pdf, 'pdf')).toHaveLength(1);
  expect(() => prepareDocument(new TextEncoder().encode('<html/>'), 'pdf')).toThrow(
    'incomplete or invalid',
  );
  expect(() =>
    prepareDocument(new TextEncoder().encode('%PDF-1.4 /Encrypt 1 0 R\n%%EOF'), 'pdf'),
  ).toThrow('Password');
  expect(() => prepareDocument(new Uint8Array([0, 255, 13]), 'csv')).toThrow('UTF-8');
  expect(() => prepareDocument(new TextEncoder().encode('Name,Fees\nA,1\0'), 'csv')).toThrow(
    'binary',
  );
});
it('chunks CSV without splitting nonadjacent order lines and strips buyer contact data before AI processing', () => {
  const text =
    'Order ID,Name,Price,Buyer,Address Line 1\n' +
    Array.from(
      { length: 31 },
      (_, i) =>
        `${i === 30 ? 'bundle' : i === 0 ? 'bundle' : `order-${i}`},Item${i},10,PRIVATE_BUYER,PRIVATE_ADDRESS`,
    ).join('\n');
  const parts = prepareDocument(new TextEncoder().encode(text), 'csv');
  expect(parts).toHaveLength(2);
  const first = new TextDecoder().decode(parts[0].bytes);
  expect(first).toContain('Item0');
  expect(first).toContain('Item30');
  expect(first).not.toMatch(/PRIVATE_BUYER|PRIVATE_ADDRESS/);
  expect(parts.reduce((n, p) => n + (p.rows || 0), 0)).toBe(31);
});
it('sends PDFs as private inline Responses input_file and CSV as bounded untrusted text, with strict output and no stored response', async () => {
  const fetcher = vi.fn().mockImplementation(async () => result());
  await extractDocument('owner', { kind: 'pdf', bytes: pdf }, '', fetcher);
  await extractDocument('owner', { kind: 'csv', bytes: csv, rows: 1 }, '', fetcher);
  const bodies = fetcher.mock.calls.map((call) => JSON.parse(call[1].body));
  expect(bodies[0]).toMatchObject({
    store: false,
    text: { format: { type: 'json_schema', strict: true } },
  });
  expect(bodies[0].input[0].content[1]).toMatchObject({
    type: 'input_file',
    filename: 'attachment.pdf',
  });
  expect(bodies[0].input[0].content[1].file_data).toMatch(/^data:application\/pdf;base64,/);
  expect(bodies[1].input[0].content[1]).toMatchObject({ type: 'input_text' });
  expect(bodies[1].instructions).toContain('never instructions');
});
it('preserves unknown costs and rejects partial reports, missing rows, fabricated schema, refusals and provider failures', async () => {
  const good = await extractDocument(
    'owner',
    { kind: 'csv', bytes: csv, rows: 1 },
    '',
    vi.fn().mockResolvedValue(result()),
  );
  expect(good.extraction.records[0].lines[0].purchaseCost).toBe(null);
  clearExtractionCache();
  const incomplete = vi.fn().mockResolvedValue(result(undefined, { complete: false }));
  await expect(
    extractDocument('owner', { kind: 'csv', bytes: csv, rows: 1 }, '', incomplete),
  ).rejects.toThrow('entire report');
  clearExtractionCache();
  await expect(
    extractDocument(
      'owner',
      { kind: 'csv', bytes: csv, rows: 2 },
      '',
      vi.fn().mockResolvedValue(result()),
    ),
  ).rejects.toThrow('entire report');
  clearExtractionCache();
  await expect(
    extractDocument(
      'owner',
      { kind: 'pdf', bytes: pdf },
      '',
      vi.fn().mockResolvedValue(new Response('private key diagnostic', { status: 500 })),
    ),
  ).rejects.toThrow('OpenAI could not read');
});
it('isolates caches by user and context, shares bounded request limits with images, and permits retry after failure', async () => {
  const fetcher = vi.fn().mockImplementation(async () => result());
  await Promise.all([
    extractDocument('a', { kind: 'pdf', bytes: pdf }, 'Vinted', fetcher),
    extractDocument('a', { kind: 'pdf', bytes: pdf }, 'Vinted', fetcher),
  ]);
  await extractDocument('b', { kind: 'pdf', bytes: pdf }, 'Vinted', fetcher);
  await extractDocument('a', { kind: 'pdf', bytes: pdf }, 'Depop', fetcher);
  expect(fetcher).toHaveBeenCalledTimes(3);
  clearExtractionCache();
  for (let i = 0; i < 20; i++)
    await extractDocument('a', { kind: 'pdf', bytes: pdf }, String(i), fetcher);
  await expect(extractScreenshot('a', new Uint8Array([1]), 'image/png', fetcher)).rejects.toThrow(
    'Too many',
  );
  await expect(
    extractDocument('b', { kind: 'pdf', bytes: pdf }, 'other', fetcher),
  ).resolves.toBeTruthy();
});
it('authenticates and validates every uploaded file before any provider request, with no record writes', async () => {
  const fetcher = vi.fn().mockImplementation(async () => result());
  vi.stubGlobal('fetch', fetcher);
  auth.requireUser.mockRejectedValueOnce(new Error('Unauthorized'));
  expect((await POST(request([new File([pdf], 'history.pdf')]))).status).toBe(401);
  expect(
    (await POST(request([new File([pdf], 'history.pdf'), new File(['bad'], 'broken.pdf')]))).status,
  ).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
  const response = await POST(
    request([new File([pdf], 'history.pdf', { type: 'application/pdf' })]),
  );
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.screenshots[0]).toMatchObject({ sourceType: 'pdf', name: 'history.pdf' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('processes the native Depop report without sending buyer PII or making any AI/database call', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  vi.stubEnv('OPENAI_API_KEY', '');
  const text = await readFile(
    new URL('./fixtures/csv/depop-synthetic.csv', import.meta.url),
    'utf8',
  );
  const response = await POST(request([new File([text], 'depop.csv', { type: 'text/csv' })]));
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(
    data.screenshots.flatMap((s: { extraction: { records: unknown[] } }) => s.extraction.records),
  ).toHaveLength(40);
  expect(JSON.stringify(data)).not.toMatch(/PRIVATE_BUYER|PRIVATE_ADDRESS|PRIVATE_PERSON/);
  expect(fetcher).not.toHaveBeenCalled();
});
