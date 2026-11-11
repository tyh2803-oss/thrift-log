import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { requireUser, checkOrigin } from '@/lib/supabase/server';
import { ConfigurationError } from '@/lib/supabase/config';
import { assistantConfig, AssistantError, extractScreenshot } from '@/lib/assistant/openai';
import {
  IMAGE_LIMIT,
  BATCH_BYTES_LIMIT,
  SOURCE_IMAGE_EDGE_LIMIT,
  SOURCE_IMAGE_PIXEL_LIMIT,
  type Screenshot,
} from '@/lib/assistant/schema';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
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
    if (!assistantConfig().enabled)
      throw new AssistantError(
        'Add OPENAI_API_KEY to the server environment to analyze screenshots. Your manual workflows still work.',
        503,
      );
    // Bound actual streamed bytes, not only the untrusted Content-Length header.
    if (!request.body) throw new AssistantError('Choose a screenshot.');
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
    const files = form.getAll('images');
    if (!files.length || files.length > assistantConfig().batchLimit)
      throw new AssistantError(`Choose 1–${assistantConfig().batchLimit} screenshots.`);
    const prepared: { file: File; bytes: Uint8Array; mime: string }[] = [];
    for (const file of files) {
      if (!(file instanceof File) || !file.size || file.size > IMAGE_LIMIT)
        throw new AssistantError('Each screenshot must be smaller than 5 MB.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const png = [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v);
      const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      const webp =
        new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
        new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
      const mime = png ? 'image/png' : jpg ? 'image/jpeg' : webp ? 'image/webp' : '';
      if (!mime) throw new AssistantError('Unsupported image. Use JPEG, PNG, or WebP screenshots.');
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
    // Sequential requests cap provider load; the cache also collapses identical screenshots.
    const screenshots: Screenshot[] = [];
    for (const { file, bytes, mime } of prepared) {
      const result = await extractScreenshot(user.id, bytes, mime);
      if (!screenshots.some((s) => s.hash === result.hash))
        screenshots.push({ ...result, name: file.name.slice(0, 200) });
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
        ? 'Sign in to your private workspace to analyze screenshots.'
        : e instanceof AssistantError
          ? e.message
          : e instanceof ConfigurationError
            ? e.message
            : 'Screenshot request failed. No business records changed.',
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
