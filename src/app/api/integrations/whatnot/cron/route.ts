import { z } from 'zod';
import { equalSecret } from '@/lib/integrations/whatnot/crypto';
import { whatnotRpc } from '@/lib/integrations/whatnot/store';
import { runSync } from '@/lib/integrations/whatnot/sync';
import { json } from '@/lib/integrations/whatnot/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32)
    return json({ error: 'Background sync is not configured.' }, 503);
  if (!equalSecret(request.headers.get('authorization') || '', `Bearer ${secret}`))
    return json({ error: 'Unauthorized' }, 401);
  try {
    const users = z
      .array(z.string().uuid())
      .max(5)
      .parse(await whatnotRpc('due', null));
    let completed = 0,
      failed = 0,
      continued = 0;
    const pending = [...users],
      deadline = Date.now() + 240_000;
    while (pending.length && Date.now() < deadline - 30_000) {
      const id = pending.shift()!;
      try {
        const result = await runSync(id);
        if (result.hasMore && !result.busy) {
          pending.push(id);
          continued++;
          await new Promise((resolve) => setTimeout(resolve, 2100));
        } else completed++;
      } catch {
        failed++;
      }
    }
    return json({ completed, failed, continued, remaining: pending.length });
  } catch {
    return json({ error: 'Whatnot background sync setup is unavailable.' }, 503);
  }
}
