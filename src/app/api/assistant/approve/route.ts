import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser, checkOrigin, adminClient } from '@/lib/supabase/server';
import { loadWorkspace } from '@/lib/supabase/workspace';
import { ConfigurationError, DatabaseReadinessError } from '@/lib/supabase/config';
import { batchSchema } from '@/lib/assistant/drafts';
import { approvalCommands, alreadyApproved } from '@/lib/assistant/planner';
import { verifyScreenshotReferences } from '@/lib/assistant/provenance';
import { applyCommand } from '@/lib/commands';
export const dynamic = 'force-dynamic';
const options = { headers: { 'Cache-Control': 'no-store' } };
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser(request);
    const raw = await request.text();
    if (raw.length > 3_000_000)
      throw new Error('This draft is too large. Approve a smaller batch.');
    const { batch, rowIds } = z
      .object({ batch: batchSchema, rowIds: z.array(z.string().uuid()).min(1).max(300) })
      .parse(JSON.parse(raw));
    if (
      new Set(rowIds).size !== rowIds.length ||
      rowIds.some((id) => !batch.rows.some((r) => r.id === id && r.included))
    )
      throw new Error('Review the included records before approving.');
    const current = await loadWorkspace(user.id);
    // A lost HTTP response can be retried safely. A durable receipt proves completion.
    if (alreadyApproved(current, batch, rowIds))
      return NextResponse.json({ workspace: current, rowIds, replayed: true }, options);
    if (current.revision !== batch.revision)
      return NextResponse.json(
        {
          error: 'Your workspace changed. Refresh, review the updated preview, and approve again.',
        },
        { status: 409, ...options },
      );
    const commands = approvalCommands(current, batch, rowIds);
    await verifyScreenshotReferences(user.id, batch, rowIds);
    const next = commands.reduce(applyCommand, current);
    const { data, error } = await adminClient().rpc('commit_workspace', {
      p_user_id: user.id,
      p_expected_revision: current.revision,
      p_payload: next,
    });
    if (error) {
      if (error.message?.includes('revision_conflict'))
        return NextResponse.json(
          { error: 'Another change was saved. Refresh and review before approving again.' },
          { status: 409, ...options },
        );
      throw new Error(
        'The database did not confirm this import. Your draft is preserved; refresh before retrying.',
      );
    }
    if (typeof data !== 'number' || !Number.isInteger(data) || data <= current.revision)
      throw new Error(
        'The database returned an unexpected confirmation. Refresh to check the import before retrying.',
      );
    return NextResponse.json(
      { workspace: { ...next, revision: data }, rowIds, replayed: false },
      options,
    );
  } catch (e) {
    const unauthorized = e instanceof Error && e.message === 'Unauthorized';
    return NextResponse.json(
      {
        error: unauthorized
          ? 'Sign in to approve this import.'
          : e instanceof z.ZodError
            ? 'Invalid draft. Review required fields and amounts.'
            : e instanceof Error
              ? e.message
              : 'Approval failed; your draft is preserved.',
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
}
