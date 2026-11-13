import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { WhatnotError, boundedText, errorMessages } from './client';
export const responseOptions = { headers: { 'Cache-Control': 'private, no-store' } };
export const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, ...responseOptions });
export async function body(request: Request, limit = 12000) {
  const raw = await boundedText(new Response(request.body), limit);
  try {
    return JSON.parse(raw);
  } catch {
    throw new WhatnotError('input', 'Use a valid request body.', 400);
  }
}
export function failure(error: unknown) {
  if (error instanceof Error && error.message === 'Unauthorized')
    return json({ error: 'Sign in to your approved private workspace.' }, 401);
  if (error instanceof WhatnotError)
    return json({ error: error.message, code: error.code }, error.status);
  if (error instanceof z.ZodError)
    return json(
      { error: 'Check the token, selected inventory and monetary values.', code: 'input' },
      400,
    );
  if (error instanceof Error && error.message === 'Invalid request origin')
    return json({ error: 'Open this action from Thrift Log.', code: 'origin' }, 403);
  return json(
    {
      error: 'Whatnot could not complete this action. Your saved records are preserved.',
      code: 'provider',
    },
    502,
  );
}
export const publicStatusError = (code: string | null | undefined) =>
  code
    ? errorMessages[code] || 'This connection needs attention. Refresh or replace its token.'
    : null;
