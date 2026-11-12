import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { documentType, prepareDocument, type DocumentPart } from '@/lib/assistant/documents';
import { historyCsvSources, historyMapping, isDepopReport } from '@/lib/assistant/csv-history';
import { readCsv } from '@/lib/csv';
import { marketplaceContextFromText } from '@/lib/assistant/vision';
import { requireUser, checkOrigin } from '@/lib/supabase/server';
import { ConfigurationError } from '@/lib/supabase/config';
import {
  assistantConfig,
  AssistantError,
  extractScreenshot,
  extractDocument,
} from '@/lib/assistant/openai';
import {
  IMAGE_LIMIT,
  BATCH_BYTES_LIMIT,
  SOURCE_IMAGE_EDGE_LIMIT,
  SOURCE_IMAGE_PIXEL_LIMIT,
  type Screenshot,
} from '@/lib/assistant/schema';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const options = { headers: { 'Cache-Control': 'no-store' } };
export async function GET() {
  try {
    await requireUser();
    return NextResponse.json(assistantConfig(), options);
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser(request);
    // Bound actual streamed bytes, not only the untrusted Content-Length header.
    if (!request.body) throw new AssistantError('Choose screenshots, a PDF or a CSV file.');
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > BATCH_BYTES_LIMIT) {
        await reader.cancel();
        throw new AssistantError('Use a batch smaller than 16 MB.', 413);
      }
      chunks.push(value);
    }
    const form = await new Response(Buffer.concat(chunks), {
      headers: { 'Content-Type': request.headers.get('content-type') || '' },
    }).formData();
    const files = [...form.getAll('images'), ...form.getAll('files')];
    const context = String(form.get('message') || '').slice(0, 2000);
    if (!files.length || files.length > assistantConfig().batchLimit)
      throw new AssistantError(`Choose 1–${assistantConfig().batchLimit} files.`);
    const prepared: (
      | { file: File; bytes: Uint8Array; mime: string }
      | { file: File; part: DocumentPart; originalHash: string; partIndex: number; parts: number }
      | { sources: Screenshot[] }
    )[] = [];
    for (const file of files) {
      if (!(file instanceof File) || !file.size || file.size > IMAGE_LIMIT)
        throw new AssistantError('Each image, PDF or CSV must be smaller than 5 MB.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const kind = documentType(file);
      if (kind) {
        const originalHash = createHash('sha256').update(bytes).digest('hex');
        if (kind === 'csv') {
          let text: string;
          try {
            text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          } catch {
            throw new AssistantError('Save the CSV as UTF-8 and try again.');
          }
          const parsed = readCsv(text),
            mapping = historyMapping(parsed.columns),
            depop = isDepopReport(parsed.columns);
          if (depop || ['title', 'price', 'date', 'fees'].every((key) => mapping[key])) {
            const platform = depop ? 'Depop' : marketplaceContextFromText(context) || '';
            let sources: Screenshot[];
            try {
              sources = await historyCsvSources(text, file.name, {
                mapping,
                marketplace: platform,
                dateFormat: 'auto',
                depop,
              });
            } catch (e) {
              throw new AssistantError(e instanceof Error ? e.message : 'Check the CSV columns.');
            }
            sources = sources.map((source) => ({ ...source, originalHash }));
            prepared.push({ sources });
            continue;
          }
        }
        let parts: DocumentPart[];
        try {
          parts = prepareDocument(bytes, kind);
        } catch (e) {
          throw new AssistantError(e instanceof Error ? e.message : 'Invalid document.');
        }
        parts.forEach((part, index) =>
          prepared.push({ file, part, originalHash, partIndex: index + 1, parts: parts.length }),
        );
        continue;
      }

      const png = [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v);
      const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      const webp =
        new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
        new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
      const mime = png ? 'image/png' : jpg ? 'image/jpeg' : webp ? 'image/webp' : '';
      if (!mime) throw new AssistantError('Use JPEG, PNG, WebP, PDF or UTF-8 CSV files.');
      try {
        const image = sharp(bytes, { limitInputPixels: SOURCE_IMAGE_PIXEL_LIMIT, failOn: 'error' });
        const metadata = await image.metadata();
        if (
          !metadata.width ||
          !metadata.height ||
          metadata.width > SOURCE_IMAGE_EDGE_LIMIT ||
          metadata.height > SOURCE_IMAGE_EDGE_LIMIT ||
          (metadata.pages ?? 1) > 1
        )
          throw new Error('Image limit');
        // Decode before spending API tokens; a valid signature alone is insufficient.
        await image.resize(1, 1).toBuffer();
      } catch {
        throw new AssistantError(
          'This image is corrupt, animated or too large. Reattach it using the app’s image picker.',
        );
      }
      prepared.push({ file, bytes, mime });
    }
    const units = prepared.reduce(
      (count, source) => count + ('sources' in source ? source.sources.length : 1),
      0,
    );
    if (units > assistantConfig().batchLimit)
      throw new AssistantError(
        'Use a smaller batch: at most 10 analysis parts or 300 CSV sale records. No files were processed.',
      );
    // Sequential, owner-isolated requests. CSV source facts contain no buyer contact information.
    const screenshots: Screenshot[] = [];
    for (const source of prepared) {
      let results: Screenshot[];
      if ('sources' in source) results = source.sources;
      else if ('part' in source) {
        const result = await extractDocument(user.id, source.part, context);
        results = [
          {
            ...result,
            sourceType: source.part.kind,
            originalHash: source.originalHash,
            name: source.file.name.slice(0, 200),
            part: source.partIndex,
            parts: source.parts,
          },
        ];
      } else
        results = [
          {
            ...(await extractScreenshot(user.id, source.bytes, source.mime)),
            name: source.file.name.slice(0, 200),
          },
        ];
      for (const result of results)
        if (!screenshots.some((s) => s.hash === result.hash)) screenshots.push(result);
    }
    return NextResponse.json({ screenshots }, options);
  } catch (e) {
    return failure(e);
  }
}
function failure(e: unknown) {
  const unauthorized = e instanceof Error && e.message === 'Unauthorized';
  return NextResponse.json(
    {
      error: unauthorized
        ? 'Sign in to your private workspace to analyze files.'
        : e instanceof AssistantError
          ? e.message
          : e instanceof ConfigurationError
            ? e.message
            : 'File analysis failed. No business records changed.',
    },
    {
      status: unauthorized
        ? 401
        : e instanceof AssistantError
          ? e.status
          : e instanceof ConfigurationError
            ? 503
            : 400,
      ...options,
    },
  );
}
