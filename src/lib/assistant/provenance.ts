import 'server-only';
import { createHash } from 'node:crypto';
import { adminClient } from '../supabase/server';
import { IMAGE_LIMIT } from './schema';
import type { DraftBatch } from './drafts';
/** Optional private references must prove both ownership and byte identity before the commit. */
export async function verifyScreenshotReferences(
  owner: string,
  batch: DraftBatch,
  rowIds: string[],
) {
  const hashes = new Set(batch.rows.filter((r) => rowIds.includes(r.id)).map((r) => r.sourceHash));
  for (const screenshot of batch.screenshots) {
    if (!hashes.has(screenshot.hash) || !screenshot.reference) continue;
    const path = screenshot.reference;
    if (
      !path.startsWith(`${owner}/`) ||
      !new RegExp(`^[a-f0-9-]+/[a-f0-9-]+\\.(jpg|png|webp)$`, 'i').test(path)
    )
      throw new Error('Screenshot references must belong to this private workspace.');
    const { data, error } = await adminClient().storage.from('inventory-photos').download(path);
    if (error || !data || data.size > IMAGE_LIMIT)
      throw new Error('The private screenshot is unavailable. No business records were saved.');
    const hash = createHash('sha256')
      .update(new Uint8Array(await data.arrayBuffer()))
      .digest('hex');
    if (hash !== screenshot.hash)
      throw new Error(
        'The stored screenshot does not match this draft. Review the original attachment again.',
      );
  }
}
