/** Opt-in synthetic API acceptance only. Never loads or changes a hosted business workspace. */
import { it, expect, vi } from 'vitest';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
vi.mock('server-only', () => ({}));
vi.mock('../src/lib/supabase/server', () => ({ adminClient: vi.fn() }));
const fileMocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../src/lib/assistant/chat-files', () => ({ readChatFile: fileMocks.read }));
import { runBusinessAssistant } from '../src/lib/assistant/business-agent';
import {
  extractDocument,
  extractScreenshot,
  clearExtractionCache,
} from '../src/lib/assistant/openai';
import { previewBatch, approvalCommands } from '../src/lib/assistant/planner';
import { applyCommand } from '../src/lib/commands';
import { businessWorkspace, emptyDrafts } from './helpers/business-assistant';
const enabled = process.env.RUN_LIVE_BUSINESS_ASSISTANT === '1';

// Cloud's credential proxy is supported by curl; this transport is test-only, with no keys in argv/files/logs.
const proxyFetch: typeof fetch = async (input, init) =>
  new Promise((resolve, reject) => {
    const child = spawn('curl', [
      '--silent',
      '--show-error',
      '--max-time',
      '140',
      '--config',
      '-',
      '--write-out',
      '\n%{http_code}',
    ]);
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.stderr.resume();
    const abort = () => child.kill();
    init?.signal?.addEventListener('abort', abort, { once: true });
    child.on('error', () => reject(new Error('Synthetic API test transport failed.')));
    child.on('close', (code) => {
      init?.signal?.removeEventListener('abort', abort);
      if (code !== 0) return reject(new Error('Synthetic API test transport failed.'));
      const last = out.lastIndexOf('\n');
      resolve(new Response(out.slice(0, last), { status: Number(out.slice(last + 1)) }));
    });
    const headers = new Headers(init?.headers);
    let config = `url = ${JSON.stringify(String(input))}\nrequest = ${JSON.stringify(init?.method || 'GET')}\n`;
    headers.forEach((value, name) => {
      config += `header = ${JSON.stringify(`${name}: ${value}`)}\n`;
    });
    if (init?.body) config += `data = ${JSON.stringify(String(init.body))}\n`;
    child.stdin.end(config);
  });
it.skipIf(!enabled)(
  'Sol searches records, distinguishes listing/sale dates, follows up naturally and prepares one exact-cost sale',
  async () => {
    expect(!!process.env.OPENAI_API_KEY).toBe(true);
    const w = businessWorkspace(),
      message = {
        id: crypto.randomUUID(),
        role: 'user' as const,
        text: 'I sold the Harley tee I listed on Depop yesterday for $35.',
      };
    const first = await runBusinessAssistant({
      userId: '11111111-1111-4111-8111-111111111111',
      workspace: w,
      messages: [message],
      drafts: emptyDrafts,
      selectedItemId: null,
      authorize: async () => {},
      fetcher: proxyFetch,
    });
    expect(first.model).toBe('gpt-6.1-sol');
    expect(first.tools).toContain('search_inventory');
    expect(first.drafts.batch?.rows).toHaveLength(1);
    const row = first.drafts.batch!.rows[0];
    expect(row.facts.date).toBeNull();
    expect(row.facts.fees).toBeNull();
    expect(row.facts.lines[0].price).toBe(3500);
    expect(row.matches[0].itemId).toBe(w.items[0].id);
    expect(row.matches[0].newItem).toBeNull();
    const second = await runBusinessAssistant({
      userId: '11111111-1111-4111-8111-111111111111',
      workspace: w,
      messages: [
        message,
        { id: crypto.randomUUID(), role: 'assistant', text: first.message },
        {
          id: crypto.randomUUID(),
          role: 'user',
          text: 'It sold today. Total seller fees were $2. There were no additional processing fees, seller-paid shipping, shipping received, discounts, refunds or other costs.',
        },
      ],
      drafts: first.drafts,
      selectedItemId: null,
      authorize: async () => {},
      fetcher: proxyFetch,
    });
    expect(second.drafts.batch?.rows).toHaveLength(1);
    expect(second.drafts.batch!.rows[0].id).toBe(row.id);
    const preview = previewBatch(w, second.drafts.batch!)[0];
    expect(preview.issues).toEqual([]);
    expect(preview.totals?.profit).toBe(2100);
    const saved = approvalCommands(w, second.drafts.batch!, [row.id]).reduce(applyCommand, w);
    expect(saved.items).toHaveLength(w.items.length);
    expect(saved.orders).toHaveLength(1);
    expect(w.orders).toHaveLength(0);
  },
  240000,
);

function syntheticPdf() {
  const stream =
    'BT /F1 14 Tf 50 730 Td (Synthetic completed Depop sale) Tj 0 -25 Td (Item: Harley tee) Tj 0 -25 Td (Actual merchandise sale price: $35.00 USD) Tj 0 -25 Td (Purchase cost: $12.00 USD) Tj 0 -25 Td (Total recorded seller fees: $2.00 USD) Tj 0 -25 Td (Sale date: 2026-11-12) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let text = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((value, i) => {
    offsets.push(Buffer.byteLength(text));
    text += `${i + 1} 0 obj\n${value}\nendobj\n`;
  });
  const xref = Buffer.byteLength(text);
  text += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => String(n).padStart(10, '0') + ' 00000 n ')
    .join('\n')}\ntrailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(text);
}
it.skipIf(!enabled)(
  'Sol accepts native PDF input and the existing structured screenshot contract with exact synthetic amounts',
  async () => {
    clearExtractionCache();
    const document = await extractDocument(
      'synthetic-model-verification',
      { kind: 'pdf', bytes: syntheticPdf() },
      '',
      proxyFetch,
    );
    expect(document.analysisModel).toBe('gpt-6.1-sol');
    expect(document.extraction.records).toHaveLength(1);
    const record = document.extraction.records[0];
    expect(record.lines[0].price).toBe(3500);
    expect(record.lines[0].purchaseCost).toBe(1200);
    expect((record.fees ?? 0) + (record.processing ?? 0)).toBe(200);
    const image = await sharp(
      Buffer.from(
        '<svg width="900" height="700"><rect width="900" height="700" fill="white"/><text x="30" y="60" font-family="Arial" font-size="28">DEPOP - Synthetic sale receipt</text><text x="30" y="120" font-family="Arial" font-size="26">Payment completed. Item: Harley tee.</text><text x="30" y="180" font-family="Arial" font-size="26">Actual item price: $35.00 USD</text><text x="30" y="240" font-family="Arial" font-size="26">Seller fee: $2.00 USD</text><text x="30" y="300" font-family="Arial" font-size="26">Sold 2026-11-12</text></svg>',
      ),
    )
      .png()
      .toBuffer();
    const screenshot = await extractScreenshot(
      'synthetic-model-verification',
      image,
      'image/png',
      proxyFetch,
    );
    expect(screenshot.processing.model).toBe('gpt-6.1-sol');
    expect(screenshot.extraction.records).toHaveLength(1);
    expect(screenshot.extraction.records[0].lines[0].price).toBe(3500);
  },
  240000,
);

it.skipIf(!enabled)(
  'Sol reads a private PDF through native tool output without forcing a question into a sale import',
  async () => {
    const id = crypto.randomUUID(),
      bytes = syntheticPdf(),
      file = {
        id,
        name: 'synthetic-receipt.pdf',
        mime: 'application/pdf' as const,
        size: bytes.length,
        hash: 'a'.repeat(64),
        path: `11111111-1111-4111-8111-111111111111/${id}.pdf`,
      };
    fileMocks.read.mockResolvedValue({ file, bytes });
    const result = await runBusinessAssistant({
      userId: '11111111-1111-4111-8111-111111111111',
      workspace: businessWorkspace(),
      messages: [
        {
          id: crypto.randomUUID(),
          role: 'user',
          text: `Read my attached synthetic-receipt.pdf (${id}) and tell me the recorded item price, purchase cost and total fees. This is only a document question; don't prepare any changes.`,
          fileIds: [id],
        },
      ],
      files: [file],
      drafts: emptyDrafts,
      selectedItemId: null,
      authorize: async () => {},
      fetcher: proxyFetch,
    });
    expect(result.tools).toContain('read_attachment');
    expect(result.tools).not.toContain('prepare_file_import');
    expect(result.message).toMatch(/35/);
    expect(result.message).toMatch(/12/);
    expect(result.message).toMatch(/2/);
    expect(result.drafts).toEqual(emptyDrafts);
  },
  240000,
);
