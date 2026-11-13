import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkOrigin, requireUser } from '@/lib/supabase/server';
import { AssistantError } from '@/lib/assistant/openai';
import { readChatFile, saveChatFile } from '@/lib/assistant/chat-files';
import { IMAGE_LIMIT } from '@/lib/assistant/schema';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const options = { headers: { 'Cache-Control': 'private, no-store' } };
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser(request);
    if (!request.body) throw new AssistantError('Choose a file.');
    const reader = request.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > IMAGE_LIMIT + 65536) {
        await reader.cancel();
        throw new AssistantError('Use a file smaller than 5 MB.', 413);
      }
      chunks.push(value);
    }
    const form = await new Response(Buffer.concat(chunks), {
      headers: { 'Content-Type': request.headers.get('content-type') || '' },
    }).formData();
    const id = z.string().uuid().parse(form.get('id')).toLowerCase(),
      file = form.get('file');
    if (!(file instanceof File)) throw new AssistantError('Choose a file.');
    const saved = await saveChatFile(user.id, id, file);
    return NextResponse.json(
      {
        file: {
          id: saved.id,
          name: saved.name,
          mime: saved.mime,
          hash: saved.hash,
          size: saved.size,
        },
      },
      options,
    );
  } catch (error) {
    return failure(error);
  }
}
export async function GET(request: Request) {
  try {
    const user = await requireUser(request),
      id = z.string().uuid().parse(new URL(request.url).searchParams.get('id'));
    const { file, bytes } = await readChatFile(user.id, id);
    return new Response(Buffer.from(bytes), {
      headers: {
        ...options.headers,
        'Content-Type': file.mime,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return failure(error);
  }
}
function failure(error: unknown) {
  const unauthorized = error instanceof Error && error.message === 'Unauthorized';
  return NextResponse.json(
    {
      error: unauthorized
        ? 'Sign in to access private attachments.'
        : error instanceof AssistantError
          ? error.message
          : 'The private attachment is unavailable.',
    },
    {
      status: unauthorized ? 401 : error instanceof AssistantError ? error.status : 400,
      ...options,
    },
  );
}
