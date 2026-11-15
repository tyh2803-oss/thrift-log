import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { EbayError, errors } from './config';
export const json = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
  });
export async function body(request: Request) {
  if (Number(request.headers.get('content-length') || 0) > 120000)
    throw new EbayError('input', 'This request is too large.', 413);
  const reader = request.body?.getReader();
  let bytes = 0;
  const parts: Uint8Array[] = [];
  try {
    if (reader)
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        bytes += r.value.length;
        if (bytes > 120000) throw new EbayError('input', 'This request is too large.', 413);
        parts.push(r.value);
      }
  } finally {
    await reader?.cancel().catch(() => {});
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown;
  } catch {
    throw new EbayError('input', 'Use a valid request body.', 400);
  }
}
export function failure(e: unknown) {
  if (e instanceof Error && e.message === 'Unauthorized')
    return json({ error: 'Sign in to your approved private workspace.' }, 401);
  if (e instanceof Error && e.message === 'Invalid request origin')
    return json({ error: 'Open this action from Thrift Log.' }, 403);
  if (e instanceof EbayError) return json({ error: e.message, code: e.code }, e.status);
  if (e instanceof z.ZodError)
    return json({ error: 'Check the selected records and monetary values.', code: 'input' }, 400);
  return json({ error: errors.provider, code: 'provider' }, 502);
}
