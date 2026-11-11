import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminClient, requireUser, checkOrigin } from '@/lib/supabase/server';
import { commandSchema } from '@/lib/model';
import { ConfigurationError, DatabaseReadinessError } from '@/lib/supabase/config';
import { applyCommand } from '@/lib/commands';
import { loadWorkspace } from '@/lib/supabase/workspace';
export const dynamic = 'force-dynamic';
const options = { headers: { 'Cache-Control': 'no-store' } };
export async function GET(request: Request) {
  try {
    return NextResponse.json(await loadWorkspace((await requireUser(request)).id), options);
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser(request);
    const text = await request.text();
    if (text.length > 8_000_000) throw new Error('Import is too large.');
    const body = z
      .object({
        revision: z.number().int().min(0),
        commands: z.array(commandSchema).min(1).max(1000),
      })
      .parse(JSON.parse(text));
    const current = await loadWorkspace(user.id);
    if (current.revision !== body.revision)
      return NextResponse.json(
        { error: 'Your workspace changed in another tab. Refresh and try again.' },
        { status: 409, ...options },
      );
    const next = body.commands.reduce(applyCommand, current);
    if (
      next.items.some((item) =>
        item.photos.some(
          (path) =>
            !path.startsWith(`${user.id}/`) ||
            path.includes('..') ||
            !/\.(jpg|png|webp)$/.test(path),
        ),
      )
    )
      throw new Error(
        'Inventory photos must belong to this private workspace. Upload demo photos again before saving private records.',
      );
    const { data, error } = await adminClient().rpc('commit_workspace', {
      p_user_id: user.id,
      p_expected_revision: current.revision,
      p_payload: next,
    });
    if (error) {
      if (error.message.includes('revision_conflict'))
        return NextResponse.json(
          { error: 'Another change was saved. Refresh before trying again.' },
          { status: 409, ...options },
        );
      throw new Error('The database could not save this change. No records were committed.');
    }
    return NextResponse.json({ ...next, revision: data }, options);
  } catch (e) {
    return failure(e);
  }
}
function failure(e: unknown) {
  const unauthorized = e instanceof Error && e.message === 'Unauthorized';
  return NextResponse.json(
    {
      error: unauthorized
        ? 'Sign in to continue.'
        : e instanceof z.ZodError
          ? 'Invalid record. Check required fields and monetary values.'
          : e instanceof Error
            ? e.message
            : 'Request failed.',
    },
    {
      status: unauthorized
        ? 401
        : e instanceof ConfigurationError || e instanceof DatabaseReadinessError
          ? 503
          : 400,
      ...options,
    },
  );
}
