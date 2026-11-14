import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { adminClient, authClient, checkOrigin, requireUser } from '@/lib/supabase/server';
import { PROFILE_PHOTO_KEY, profilePhotoPath } from '@/lib/profile';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const options = { headers: { 'Cache-Control': 'private, no-store' } };
class ProfileError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

async function clearOldPhoto(userId: string, path: string | null) {
  if (!path) return;
  try {
    const admin = adminClient();
    // A profile photo may have been explicitly reused on an inventory item.
    const used = await admin
      .from('items')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .contains('photos', [path]);
    if (used.error || used.count !== 0) return;
    await admin.storage.from('inventory-photos').remove([path]);
  } catch {
    /* Cleanup never overrides a confirmed profile save or risks inventory photos. */
  }
}
async function writePhoto(request: Request, userId: string, path: string | null) {
  const actor = await requireUser(request);
  if (actor.id !== userId) throw new Error('Unauthorized');
  const client = await authClient({ writableCookies: true, request });
  const result = await client.auth.updateUser({ data: { [PROFILE_PHOTO_KEY]: path } });
  if (
    result.error ||
    result.data?.user?.id !== userId ||
    profilePhotoPath(userId, result.data?.user?.user_metadata) !== path
  )
    throw new ProfileError(
      'Profile photo save was not confirmed. Reopen your profile before retrying.',
      503,
    );
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser(request);
    if (new URL(request.url).searchParams.size)
      throw new ProfileError('Upload a photo for your signed-in account.');
    if (!request.body) throw new ProfileError('Choose a profile photo.');
    const reader = request.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 5 * 1024 * 1024 + 65536) {
        await reader.cancel();
        throw new ProfileError('Use a photo smaller than 5 MB.', 413);
      }
      chunks.push(value);
    }
    let form: FormData;
    try {
      form = await new Response(Buffer.concat(chunks), {
        headers: { 'Content-Type': request.headers.get('content-type') || '' },
      }).formData();
    } catch {
      throw new ProfileError('Choose a JPEG, PNG or WebP photo.');
    }
    if ([...form.keys()].some((key) => key !== 'file') || form.getAll('file').length !== 1)
      throw new ProfileError('Upload one profile photo for your signed-in account.');
    const file = form.get('file');
    if (!(file instanceof File) || !file.size || file.size > 5 * 1024 * 1024)
      throw new ProfileError('Choose a photo smaller than 5 MB.');
    let bytes: Buffer;
    try {
      const input = Buffer.from(await file.arrayBuffer());
      const jpeg = input[0] === 255 && input[1] === 216 && input[2] === 255;
      const png = input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const webp =
        input.subarray(0, 4).toString() === 'RIFF' && input.subarray(8, 12).toString() === 'WEBP';
      if (!jpeg && !png && !webp) throw new Error('Invalid signature');
      const image = sharp(input, {
        limitInputPixels: 16777216,
        failOn: 'error',
      });
      const meta = await image.metadata();
      if (!['jpeg', 'png', 'webp'].includes(meta.format || '') || (meta.pages ?? 1) > 1)
        throw new Error('Invalid format');
      bytes = await image
        .rotate()
        .resize(512, 512, { fit: 'cover', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 85 })
        .toBuffer();
    } catch {
      throw new ProfileError('Use a valid, non-animated JPEG, PNG or WebP photo.');
    }
    const path = `${user.id}/profile-${crypto.randomUUID()}.jpg`;
    const upload = await adminClient()
      .storage.from('inventory-photos')
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
    if (upload.error) throw new ProfileError('Photo upload was not confirmed. Try again.', 503);
    // Recheck access before changing metadata. An unconfirmed save keeps private
    // bytes so a lost Auth response cannot break a successfully saved photo.
    await writePhoto(request, user.id, path);
    await clearOldPhoto(user.id, profilePhotoPath(user.id, user.user_metadata));
    return NextResponse.json({ path }, options);
  } catch (error) {
    return failure(error);
  }
}
export async function DELETE(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser(request);
    if (new URL(request.url).searchParams.size)
      throw new ProfileError('This action only removes your current profile photo.');
    // Next may represent a bodyless browser DELETE as an empty stream.
    // Reject actual caller-supplied data without buffering an unbounded body.
    const reader = request.body?.getReader();
    if (reader) {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (chunk.value.byteLength) {
          await reader.cancel();
          throw new ProfileError('This action only removes your current profile photo.');
        }
      }
    }
    await writePhoto(request, user.id, null);
    await clearOldPhoto(user.id, profilePhotoPath(user.id, user.user_metadata));
    return NextResponse.json({ path: null }, options);
  } catch (error) {
    return failure(error);
  }
}
function failure(error: unknown) {
  const unauthorized = error instanceof Error && error.message === 'Unauthorized';
  return NextResponse.json(
    {
      error: unauthorized
        ? 'Sign in to update your profile photo.'
        : error instanceof ProfileError
          ? error.message
          : 'Profile photo could not be saved. Try again.',
    },
    { status: unauthorized ? 401 : error instanceof ProfileError ? error.status : 400, ...options },
  );
}
