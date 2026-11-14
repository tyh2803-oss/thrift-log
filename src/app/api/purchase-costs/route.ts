import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminClient, requireUser, checkOrigin } from '@/lib/supabase/server';
import { loadWorkspace } from '@/lib/supabase/workspace';
import { purchaseCostsSchema, purchaseCostCommands } from '@/lib/purchase-costs';
import { applyCommand } from '@/lib/commands';
export const dynamic = 'force-dynamic';
const options = { headers: { 'Cache-Control': 'private, no-store' } };
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser(request);
    if (!request.body)
      return NextResponse.json({ error: 'Choose purchase costs.' }, { status: 400, ...options });
    const reader = request.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 100000) {
        await reader.cancel();
        return NextResponse.json(
          { error: 'Apply costs to at most 200 physical items.' },
          { status: 413, ...options },
        );
      }
      chunks.push(value);
    }
    const input = z
      .strictObject({ revision: z.number().int().nonnegative(), batch: purchaseCostsSchema })
      .parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    const current = await loadWorkspace(user.id),
      commands = purchaseCostCommands(current, input.batch);
    if (!commands.length) return NextResponse.json({ saved: true, replayed: true }, options);
    if (current.revision !== input.revision)
      return NextResponse.json(
        { error: 'Records changed during this review. Refresh, check the costs and retry.' },
        { status: 409, ...options },
      );
    if (commands.some((c) => c.type === 'financialEvent')) {
      const readiness = await adminClient().rpc('purchase_costs_ready');
      if (readiness.error || readiness.data !== true)
        return NextResponse.json(
          {
            error:
              'Saved sale costs need migration 202611130002_purchase_cost_corrections.sql. Existing records are unchanged.',
          },
          { status: 503, ...options },
        );
    }
    const next = commands.reduce(applyCommand, current);
    const { data, error } = await adminClient().rpc('commit_workspace', {
      p_user_id: user.id,
      p_expected_revision: current.revision,
      p_payload: next,
    });
    if (error)
      return NextResponse.json(
        {
          error: error.message?.includes('revision_conflict')
            ? 'Another save or sync finished first. Refresh, review and retry this cost batch.'
            : 'The database did not confirm the cost batch. Refresh to check it before retrying; original sales are preserved.',
        },
        { status: error.message?.includes('revision_conflict') ? 409 : 503, ...options },
      );
    if (!Number.isSafeInteger(data) || data <= current.revision)
      throw new Error('The save confirmation was invalid. Refresh before retrying.');
    return NextResponse.json(
      { saved: true, replayed: false, items: input.batch.entries.length },
      options,
    );
  } catch (error) {
    const unauthorized = error instanceof Error && error.message === 'Unauthorized';
    return NextResponse.json(
      {
        error: unauthorized
          ? 'Sign in to change purchase costs.'
          : error instanceof z.ZodError
            ? 'Check purchase costs, selected items and correction confirmation.'
            : error instanceof Error
              ? error.message
              : 'The cost batch could not be saved.',
      },
      { status: unauthorized ? 401 : 400, ...options },
    );
  }
}
