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
import { readDocumentCsv, decodeSpreadsheet } from '../src/lib/assistant/document-csv';
import { documentContext, contextSaleDate } from '../src/lib/assistant/document-context';
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
                ignoredRows: [],
                records: records.map((record, index) => ({
                  ...record,
                  lines: record.lines.map((line) => ({
                    ...line,
                    purchaseCost: line.purchaseCost ?? null,
                  })),
                  sourceRows: [index + 1],
                })),
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
  vi.useRealTimers();
});
it('finds an informal spreadsheet table after titles, keeps blank columns distinct, and handles UTF-16 exports', () => {
  const text =
    'My stock\n2026,,,,,,,\nItem,Purchased Price,Sold Price,,Total Spent,Total Made,,Profit\nJacket,$1.00,$25.00,,"$1,000.00","$2,000.00",,$999.00\nItem,Purchased Price,Sold Price,,Total Spent,Total Made,,Profit\nBoots,$0.00,$0.00,,,,,';
  const parsed = readDocumentCsv(text);
  expect(parsed.rows).toHaveLength(2);
  expect(new Set(parsed.columns).size).toBe(8);
  expect(parsed.rows[0]['Purchased Price']).toBe('$1.00');
  expect(parsed.note).toContain('2 title/heading rows');
  expect(parsed.note).toContain('1 repeated headings');
  const utf16 = Buffer.concat([Buffer.from([255, 254]), Buffer.from(text, 'utf16le')]);
  expect(readDocumentCsv(decodeSpreadsheet(utf16)).rows).toEqual(parsed.rows);
  expect(() => readDocumentCsv('Name,Price\n"unterminated,5')).toThrow('CSV could not');
});
it('prepares all 133 informal spreadsheet items without AI, preserving missing fees/prices and timezone-aware user dates', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-13T02:00:00Z'));
  const text =
    'My spreadsheet\n2026,,,,,,,\nItem,Purchased Price,Sold Price,,Total Spent,Total Made,,Profit\n' +
    Array.from(
      { length: 133 },
      (_, i) =>
        `Garment ${i},${i === 0 ? '$0.00' : '$1.25'},${i === 1 ? '' : '$25.00'},,${i === 0 ? '$999.00' : ''},,,`,
    ).join('\n');
  const form = new FormData();
  form.append('files', new File([text], 'thrifts.csv', { type: 'text/csv' }));
  form.set('message', 'These were sold on Depop yesterday');
  form.set('timeZone', 'America/New_York');
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const response = await POST(
    new Request('https://app.test/api/assistant/extract', { method: 'POST', body: form }),
  );
  const data = await response.json();
  expect(response.status, JSON.stringify(data)).toBe(200);
  const records = data.screenshots.flatMap(
    (s: { extraction: { records: unknown[] } }) => s.extraction.records,
  );
  expect(records).toHaveLength(133);
  expect(records[0]).toMatchObject({
    marketplace: 'Depop',
    date: '2026-11-11',
    fees: null,
    lines: [{ title: 'Garment 0', price: 2500, purchaseCost: 0 }],
  });
  expect(records[1].lines[0].price).toBe(null);
  expect(records.every((r: { fees: number | null }) => r.fees === null)).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();
});
it('preserves explicit source dates and marketplaces over user defaults and keeps invalid amounts unresolved', async () => {
  const text =
    'Item,Sold Price,Purchased Price,Date,Fees,Marketplace\nJacket,not-money,12,2026-10-01,0,eBay';
  const response = await POST(
    request([new File([text], 'history.csv')], 'Sold on Depop yesterday'),
  );
  const data = await response.json();
  expect(response.status).toBe(200);
  expect(data.screenshots[0].extraction.records[0]).toMatchObject({
    marketplace: 'eBay',
    date: '2026-10-01',
    fees: 0,
    lines: [{ price: null, purchaseCost: 1200 }],
  });
});
it('resolves relative dates in the workspace timezone without guessing conflicting context', () => {
  const clock = documentContext('America/New_York', new Date('2026-11-13T02:00:00Z'));
  expect(contextSaleDate('Sold yesterday', clock)).toBe('2026-11-11');
  expect(contextSaleDate('Sold today', clock)).toBe('2026-11-12');
  expect(contextSaleDate('not yesterday', clock)).toBeNull();
  expect(contextSaleDate('today or yesterday', clock)).toBeNull();
  expect(contextSaleDate('2026-10-01 and 2026-10-02', clock)).toBeNull();
});
it('accounts for every repeated CSV section even when identical parts share a cached AI result', async () => {
  const text =
    'Garment,Amount,When,Charges\n' +
    Array.from({ length: 60 }, () => 'Jacket,25,2026-10-01,1').join('\n');
  const fetcher = vi.fn().mockImplementation(async (_url, init) => {
    const body = JSON.parse(init.body);
    const count = JSON.parse(body.input[0].content[0].text).expectedDataRows;
    return result(
      Array.from({ length: count }, () =>
        extractedSale({ lines: [extractedLine({ purchaseCost: null })] }),
      ),
      { rowsAccountedFor: count },
    );
  });
  vi.stubGlobal('fetch', fetcher);
  const response = await POST(request([new File([text], 'unfamiliar.csv')]));
  const data = await response.json();
  expect(response.status, JSON.stringify(data)).toBe(200);
  expect(data.screenshots).toHaveLength(2);
  expect(new Set(data.screenshots.map((s: { hash: string }) => s.hash)).size).toBe(2);
  expect(
    data.screenshots.flatMap((s: { extraction: { records: unknown[] } }) => s.extraction.records),
  ).toHaveLength(60);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('does not accept an AI claim that an incomplete physical item is a summary row', async () => {
  await expect(
    extractDocument(
      'owner',
      { kind: 'csv', bytes: csv, rows: 1 },
      '',
      vi.fn().mockResolvedValue(result([], { ignoredRows: [{ row: 1, reason: 'summary' }] })),
    ),
  ).rejects.toThrow('mistaken for a heading');
});
it('excludes clearly labeled footer totals without manufacturing an extra physical item', () => {
  const table = readDocumentCsv('Item,Purchased Price,Sold Price\nJacket,1,25\nGrand Total,1,25');
  expect(table.rows).toHaveLength(1);
  expect(table.note).toContain('1 summary-total rows');
});
it('retains refund reconciliation checks when preparing incomplete spreadsheets', async () => {
  const response = await POST(
    request(
      [new File(['Item,Sold Price,Refund\nJacket,25,not-an-amount'], 'history.csv')],
      'These sold on Depop yesterday',
    ),
  );
  expect(response.status).toBe(400);
  expect((await response.json()).error).not.toContain('File analysis failed');
});
it('rejects repeated or skipped AI source-row references even when a model claims complete coverage', async () => {
  const records = [
    extractedSale({ lines: [extractedLine({ purchaseCost: null })] }),
    extractedSale({ lines: [extractedLine({ purchaseCost: null })] }),
  ];
  const reply = result(records, {
    rowsAccountedFor: 2,
    records: records.map((r) => ({ ...r, sourceRows: [1] })),
  });
  await expect(
    extractDocument(
      'owner',
      { kind: 'csv', bytes: csv, rows: 2 },
      '',
      vi.fn().mockResolvedValue(reply),
    ),
  ).rejects.toThrow('skipped or repeated');
});
it.skipIf(!process.env.THRIFT_CSV_ACCEPTANCE_FILE)(
  'accepts the actual user-supplied spreadsheet without changing or uploading business records',
  async () => {
    const text = await readFile(process.env.THRIFT_CSV_ACCEPTANCE_FILE!, 'utf8');
    const response = await POST(
      request([new File([text], 'thrifts.csv')], 'They were sold on Depop yesterday'),
    );
    const data = await response.json();
    expect(response.status, JSON.stringify(data)).toBe(200);
    const records = data.screenshots.flatMap(
      (s: { extraction: { records: unknown[] } }) => s.extraction.records,
    );
    expect(records).toHaveLength(133);
    expect(records[0]).toMatchObject({
      marketplace: 'Depop',
      fees: null,
      lines: [{ purchaseCost: 100, price: 0 }],
    });
    expect(
      records.filter((r: { lines: { price: number | null }[] }) => r.lines[0].price === null),
    ).toHaveLength(1);
  },
);
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
