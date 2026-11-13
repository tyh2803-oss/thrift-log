import 'server-only';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { adminClient } from '../supabase/server';
import { documentType, prepareDocument } from './documents';
import { IMAGE_LIMIT, SOURCE_IMAGE_PIXEL_LIMIT, SOURCE_IMAGE_EDGE_LIMIT } from './schema';
import { AssistantError } from './openai';
export const storedChatFileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().max(200),
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/csv']),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().min(1).max(IMAGE_LIMIT),
  path: z.string(),
});
export type StoredChatFile = z.infer<typeof storedChatFileSchema>;
const extension = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'text/csv': 'csv',
} as const;
export async function fileStore(
  owner: string,
  action: 'list' | 'create' | 'delete',
  data: unknown = {},
) {
  const { data: result, error } = await adminClient().rpc('assistant_file', {
    p_action: action,
    p_user_id: owner,
    p_data: data,
  });
  if (error) {
    if (error.message?.includes('workspace_access_denied')) throw new Error('Unauthorized');
    if (error.message?.includes('assistant_security_not_ready'))
      throw new AssistantError(
        'Private attachment security needs administrator verification.',
        503,
      );
    if (['PGRST202', '42883'].includes(error.code || ''))
      throw new AssistantError(
        'Private assistant files need the optional conversation migration.',
        503,
      );
    if (error.message?.includes('files_limit'))
      throw new AssistantError(
        'This workspace has 200 retained assistant files. Clear chat to remove its private attachments before adding more.',
        429,
      );
    throw new AssistantError(
      'The private attachment could not be confirmed. Retry without changing business records.',
      409,
    );
  }
  return result;
}
export async function chatFiles(owner: string, ids?: string[]) {
  const files = storedChatFileSchema
    .array()
    .parse(await fileStore(owner, 'list', ids ? { ids } : {}));
  for (const file of files)
    if (file.path !== `${owner}/${file.id}.${extension[file.mime]}`)
      throw new AssistantError('Private attachment identity could not be verified.', 403);
  return files;
}
export async function readChatFile(owner: string, id: string) {
  const file = (await chatFiles(owner, [id]))[0];
  if (!file) throw new AssistantError('That attachment is not available in this workspace.', 404);
  const { data, error } = await adminClient().storage.from('assistant-files').download(file.path);
  if (error || !data || data.size !== file.size || data.size > IMAGE_LIMIT)
    throw new AssistantError(
      'This private attachment is unavailable. Reattach the original file.',
      404,
    );
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== file.hash)
    throw new AssistantError(
      'The attachment does not match its saved source. Reattach the original.',
      409,
    );
  return { file, bytes };
}
export async function saveChatFile(owner: string, id: string, file: File) {
  if (!file.size || file.size > IMAGE_LIMIT)
    throw new AssistantError('Use an image, PDF or CSV smaller than 5 MB.', 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = documentType(file);
  let mime: StoredChatFile['mime'];
  if (kind) {
    try {
      prepareDocument(bytes, kind, { groupOrders: false, maxRows: 5000, preserveSummaries: true });
    } catch (error) {
      throw new AssistantError(error instanceof Error ? error.message : 'Check this document.');
    }
    mime = kind === 'pdf' ? 'application/pdf' : 'text/csv';
  } else {
    try {
      const image = sharp(bytes, { limitInputPixels: SOURCE_IMAGE_PIXEL_LIMIT, failOn: 'error' }),
        meta = await image.metadata();
      if (
        !meta.width ||
        !meta.height ||
        meta.width > SOURCE_IMAGE_EDGE_LIMIT ||
        meta.height > SOURCE_IMAGE_EDGE_LIMIT ||
        (meta.pages ?? 1) > 1 ||
        !['jpeg', 'png', 'webp'].includes(meta.format || '')
      )
        throw new Error('Image format');
      await image.resize(1, 1).toBuffer();
      mime =
        meta.format === 'jpeg' ? 'image/jpeg' : meta.format === 'png' ? 'image/png' : 'image/webp';
    } catch {
      throw new AssistantError('Use a readable JPEG, PNG, WebP, PDF or CSV file.');
    }
  }
  const hash = createHash('sha256').update(bytes).digest('hex'),
    path = `${owner}/${id}.${extension[mime]}`;
  const existing = (await chatFiles(owner, [id]))[0];
  if (existing && (existing.hash !== hash || existing.mime !== mime))
    throw new AssistantError('This attachment changed. Add it as a new file.', 409);
  // Reserve ownership/quota before storing bytes; retries reuse this exact source identity.
  const saved = storedChatFileSchema.parse(
    await fileStore(owner, 'create', {
      id,
      name: file.name.slice(0, 200) || 'attachment',
      mime,
      hash,
      size: bytes.length,
    }),
  );
  if (existing) {
    try {
      await readChatFile(owner, id);
      return saved;
    } catch (error) {
      if (error instanceof AssistantError && error.status !== 404) throw error;
    }
  }
  const uploaded = await adminClient()
    .storage.from('assistant-files')
    .upload(path, bytes, { contentType: mime, upsert: false });
  if (uploaded.error) {
    // A previous upload may have succeeded before a response was lost. Verify bytes, never overwrite.
    const retained = await adminClient().storage.from('assistant-files').download(path);
    if (
      retained.error ||
      !retained.data ||
      retained.data.size > IMAGE_LIMIT ||
      createHash('sha256')
        .update(new Uint8Array(await retained.data.arrayBuffer()))
        .digest('hex') !== hash
    )
      throw new AssistantError(
        'Private file upload failed. Your business records are unchanged.',
        502,
      );
  }
  return saved;
}
export async function clearChatFiles(owner: string) {
  const files = await chatFiles(owner);
  for (let i = 0; i < files.length; i += 100) {
    const batch = files.slice(i, i + 100);
    const removed = await adminClient()
      .storage.from('assistant-files')
      .remove(batch.map((f) => f.path));
    if (removed.error)
      throw new AssistantError(
        'Conversation cleared, but some private attachments could not be removed. Retry Clear chat.',
        502,
      );
    await fileStore(owner, 'delete', { ids: batch.map((f) => f.id) });
  }
  return files.length;
}
