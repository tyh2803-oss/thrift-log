import { z } from 'zod';
import { requireUser } from '@/lib/supabase/server';
import { readRecords } from '@/lib/integrations/whatnot/store';
import { json, failure } from '@/lib/integrations/whatnot/http';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request),
      id = z
        .string()
        .uuid()
        .parse((await context.params).id);
    const rows = await readRecords(user.id, { kind: 'show', localId: id, limit: 1 });
    const row = rows.find((r) => r.local_id === id);
    if (!row) return json({ analytics: null });
    const payload = row.payload as { analytics?: unknown; source?: { status?: string } };
    return json({
      analytics: payload.analytics || null,
      sourceStatus: payload.source?.status || null,
    });
  } catch (e) {
    return failure(e);
  }
}
