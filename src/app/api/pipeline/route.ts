import { z } from 'zod';
import { NextResponse } from 'next/server';
import { requireUser, checkOrigin, adminClient } from '@/lib/supabase/server';
import { loadWorkspace } from '@/lib/supabase/workspace';
import { applyPipelineMove, pipelineMoveSchema, replayPipelineMove } from '@/lib/pipeline-moves';

export const dynamic = 'force-dynamic';
const options = { headers: { 'Cache-Control': 'no-store' } };
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser(request);
    const raw = await request.text();
    if (raw.length > 1_000_000) throw new Error('Move at most 200 items at once.');
    const input = pipelineMoveSchema.parse(JSON.parse(raw)),
      current = await loadWorkspace(user.id);
    const replay = replayPipelineMove(current, input);
    if (replay) return NextResponse.json(replay, options);
    if (current.revision !== input.revision)
      return NextResponse.json(
        { error: 'Workspace changed. Refresh and review before retrying.' },
        { status: 409, ...options },
      );
    const readiness = await adminClient().rpc('verify_thrift_log');
    if (readiness.error || !readiness.data?.pipelineMoves || readiness.data.schemaVersion < 5)
      return NextResponse.json(
        {
          error:
            'Pipeline moves need migration 202611100001, applied and verified by your database administrator. Existing records are unchanged.',
        },
        { status: 503, ...options },
      );
    const result = await applyPipelineMove(current, input);
    if (
      result.workspace.items.some((i) =>
        i.photos.some(
          (p) => !p.startsWith(`${user.id}/`) || p.includes('..') || !/\.(jpg|png|webp)$/.test(p),
        ),
      )
    )
      throw new Error('Inventory photos must belong to this workspace.');
    const { data, error } = await adminClient().rpc('commit_workspace', {
      p_user_id: user.id,
      p_expected_revision: current.revision,
      p_payload: result.workspace,
    });
    if (
      error ||
      typeof data !== 'number' ||
      !Number.isSafeInteger(data) ||
      data <= current.revision
    )
      return NextResponse.json(
        { error: 'Save was not confirmed. Your selection is preserved; refresh and retry safely.' },
        { status: error?.message?.includes('revision_conflict') ? 409 : 400, ...options },
      );
    return NextResponse.json(
      { ...result, workspace: { ...result.workspace, revision: data } },
      options,
    );
  } catch (error) {
    const unauthorized = error instanceof Error && error.message === 'Unauthorized';
    return NextResponse.json(
      {
        error: unauthorized
          ? 'Sign in before moving inventory.'
          : error instanceof z.ZodError
            ? 'Check the move date, stage and monetary values (maximum 200 items per move).'
            : error instanceof Error
              ? error.message
              : 'Move failed.',
      },
      { status: unauthorized ? 401 : 400, ...options },
    );
  }
}
