/** Opt-in only. Sends real image pixels to OpenAI. Never touches business records. */
import { it, vi, expect } from 'vitest';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
vi.mock('server-only', () => ({}));
import { extractScreenshot, assistantConfig } from '../src/lib/assistant/openai';
import { createBatch } from '../src/lib/assistant/drafts';
import { previewBatch } from '../src/lib/assistant/planner';
import { emptyWorkspace } from '../src/lib/model';
import type { ExtractedLine } from '../src/lib/assistant/schema';
const enabled = process.env.RUN_LIVE_VISION === '1';
type Expected = {
  label: string;
  count: number;
  kind?: string;
  eventType?: string;
  marketplace?: string | null;
  confidence?: string;
  items: Record<string, string | number>[];
};
it.skipIf(!enabled)(
  'benchmarks actual image extraction field by field without database writes',
  async () => {
    process.loadEnvFile('.env.local');
    const imagePath = process.env.VISION_SCREENSHOT_PATH;
    const expectedPath = process.env.VISION_EXPECTED_PATH;
    if (!imagePath || !expectedPath)
      throw new Error(
        'Set VISION_SCREENSHOT_PATH and VISION_EXPECTED_PATH to actual local files. No generated image substitutes for marketplace acceptance.',
      );
    const expected = JSON.parse(await readFile(resolve(expectedPath), 'utf8')) as Expected;
    const bytes = await readFile(resolve(imagePath));
    const meta = await sharp(bytes).metadata();
    const mime =
      meta.format === 'jpeg'
        ? 'image/jpeg'
        : meta.format === 'png'
          ? 'image/png'
          : meta.format === 'webp'
            ? 'image/webp'
            : null;
    if (!mime) throw new Error('Use a supported JPEG, PNG or WebP image.');
    const result = await extractScreenshot('local-vision-benchmark', bytes, mime);
    const checks: {
      item: number | string;
      field: string;
      expected: unknown;
      actual: unknown;
      pass: boolean;
    }[] = [];
    const check = (
      item: number | string,
      field: string,
      wanted: unknown,
      actual: unknown,
      pass: boolean,
    ) => checks.push({ item, field, expected: wanted, actual, pass });
    const records = result.extraction.records;
    const lines = records.flatMap((r) => r.lines);
    if (expected.eventType)
      for (const [i, r] of records.entries())
        check(
          i + 1,
          'lifecycle event',
          expected.eventType,
          r.event?.type,
          r.event?.type === expected.eventType,
        );
    if (expected.kind) {
      check(
        'screenshot',
        'record count',
        expected.count,
        records.length,
        records.length === expected.count,
      );
      for (const [i, record] of records.entries()) {
        check(i + 1, 'record kind', expected.kind, record.kind, record.kind === expected.kind);
        if (expected.kind === 'listing')
          check(
            i + 1,
            'independent listing card',
            1,
            record.lines.length,
            record.lines.length === 1,
          );
      }
    }
    check(
      'screenshot',
      'product count',
      expected.count,
      lines.length,
      lines.length === expected.count,
    );
    if ('marketplace' in expected)
      for (const [i, record] of records.entries())
        check(
          i + 1,
          'marketplace',
          expected.marketplace,
          record.marketplace,
          record.marketplace === expected.marketplace,
        );
    if (expected.confidence)
      check(
        'screenshot',
        'marketplace confidence',
        expected.confidence,
        result.extraction.identification?.confidence,
        result.extraction.identification?.confidence === expected.confidence,
      );
    for (const [index, fields] of expected.items.entries()) {
      // Associate by expected visible brand, then check every field on THAT item, including its price.
      const line = fields.brand
        ? lines.find((l) => new RegExp(String(fields.brand), 'i').test(l.brand || ''))
        : lines[index];
      for (const [field, wanted] of Object.entries(fields)) {
        const actual =
          field === 'vintage'
            ? line?.clothing?.vintage.classification
            : (line?.[field as keyof ExtractedLine] ??
              line?.clothing?.[field as keyof NonNullable<ExtractedLine['clothing']>]);
        check(
          index + 1,
          field,
          wanted,
          actual ?? null,
          typeof wanted === 'number'
            ? actual === wanted
            : new RegExp(wanted, 'i').test(String(actual ?? '')),
        );
      }
    }
    check(
      'screenshot',
      'no unverified vintage confirmation',
      true,
      true,
      lines.every((l) => l.clothing?.vintage.classification !== 'Vintage confirmed'),
    );
    const w = emptyWorkspace();
    const before = JSON.stringify(w);
    const batch = createBatch(
      [
        {
          hash: result.hash,
          name: 'private-benchmark',
          extraction: result.extraction,
          processing: result.processing,
        },
      ],
      w,
    );
    previewBatch(w, batch);
    check(
      'draft',
      'no business mutation during prepare',
      true,
      JSON.stringify(w) === before,
      JSON.stringify(w) === before,
    );
    check(
      'draft',
      'editable record count',
      records.length,
      batch.rows.length,
      batch.rows.length === records.length,
    );
    const report = {
      label: expected.label,
      model: assistantConfig().model,
      processing: result.processing,
      checks,
      extraction: result.extraction,
    };
    await mkdir('test-results/vision-live', { recursive: true });
    await writeFile('test-results/vision-live/report.json', JSON.stringify(report, null, 2));
    console.log(
      `LIVE ${expected.label}; model=${assistantConfig().model}; views=${result.processing.views.length}; pixels=${result.processing.width}x${result.processing.height}`,
    );
    for (const c of checks)
      console.log(
        `${c.pass ? 'PASS' : 'FAIL'} item ${c.item} / ${c.field}: ${JSON.stringify(c.actual)}`,
      );
    expect(
      checks.filter((c) => !c.pass),
      'See ignored test-results/vision-live/report.json for field-level failures',
    ).toEqual([]);
  },
  180_000,
);
