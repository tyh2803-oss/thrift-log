import { beforeEach, it, expect, vi } from 'vitest';
import sharp from 'sharp';
vi.mock('server-only', () => ({}));
const m = vi.hoisted(() => ({
  user: vi.fn(),
  origin: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  update: vi.fn(),
  references: vi.fn(),
  storage: vi.fn(),
  items: vi.fn(),
  download: vi.fn(),
}));
vi.mock('../src/lib/supabase/server', () => ({
  requireUser: m.user,
  checkOrigin: m.origin,
  authClient: async () => ({ auth: { updateUser: m.update } }),
  adminClient: () => ({ storage: { from: m.storage }, from: m.items }),
}));
import { POST, DELETE } from '../src/app/api/profile/route';
import { GET as photo } from '../src/app/api/photos/route';
import { profilePhotoPath, PROFILE_PHOTO_KEY, demoProfilePhoto } from '../src/lib/profile';
const owner = '11111111-1111-4111-8111-111111111111',
  other = '22222222-2222-4222-8222-222222222222';
const old = `${owner}/profile-33333333-3333-4333-8333-333333333333.jpg`;
const metadata = { name: 'Original name', preferences: { keep: true }, [PROFILE_PHOTO_KEY]: old };
beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockResolvedValue({ id: owner, user_metadata: metadata });
  m.origin.mockReturnValue(undefined);
  m.upload.mockResolvedValue({ error: null });
  m.remove.mockResolvedValue({ error: null });
  m.update.mockImplementation(async ({ data }) => ({
    data: { user: { id: owner, user_metadata: { ...metadata, ...data } } },
    error: null,
  }));
  m.references.mockResolvedValue({ error: null, count: 0 });
  m.storage.mockImplementation(() => ({
    upload: m.upload,
    remove: m.remove,
    download: m.download,
  }));
  m.items.mockImplementation(() => ({
    select: () => ({ eq: () => ({ contains: m.references }) }),
  }));
});
async function request(extra?: [string, string], data?: Uint8Array, mime = 'image/png') {
  const bytes =
    data ||
    (await sharp({ create: { width: 800, height: 600, channels: 3, background: '#44775a' } })
      .png()
      .toBuffer());
  const form = new FormData();
  form.set('file', new File([Uint8Array.from(bytes)], 'portrait.png', { type: mime }));
  if (extra) form.set(...extra);
  return new Request('https://app.test/api/profile', { method: 'POST', body: form });
}
it('only accepts owned reserved profile paths, never foreign photos, inventory paths or external URLs', () => {
  expect(profilePhotoPath(owner, metadata)).toBe(old);
  for (const value of [
    old.replace(owner, other),
    `${owner}/${crypto.randomUUID()}.jpg`,
    'https://example.test/portrait.jpg',
    `${owner}/../profile-33333333-3333-4333-8333-333333333333.jpg`,
    null,
  ])
    expect(profilePhotoPath(owner, { [PROFILE_PHOTO_KEY]: value })).toBe(null);
  expect(demoProfilePhoto('https://example.test/x')).toBe(null);
  expect(demoProfilePhoto('data:image/svg+xml;base64,AAAA')).toBe(null);
});
it('normalizes the uploaded image, updates only the actor metadata field and cleans up only an unreferenced old profile photo', async () => {
  const result = await POST(await request());
  expect(result.status).toBe(200);
  const { path } = await result.json();
  expect(profilePhotoPath(owner, { [PROFILE_PHOTO_KEY]: path })).toBe(path);
  expect(m.storage).toHaveBeenCalledWith('inventory-photos');
  const [uploaded, bytes, options] = m.upload.mock.calls[0];
  expect(uploaded).toBe(path);
  expect(options).toEqual({ contentType: 'image/jpeg', upsert: false });
  const image = await sharp(bytes).metadata();
  expect(image.format).toBe('jpeg');
  expect(image.width).toBe(512);
  expect(image.height).toBe(512);
  expect(image.exif).toBeUndefined();
  expect(m.update).toHaveBeenCalledWith({ data: { [PROFILE_PHOTO_KEY]: path } });
  expect(m.remove).toHaveBeenCalledWith([old]);
  expect(m.references).toHaveBeenCalledWith('photos', [old]);
  expect(metadata.name).toBe('Original name');
  expect(result.headers.get('cache-control')).toBe('private, no-store');
});
it('denies unsigned, revoked, cross-site, injected-account and corrupt files before changing metadata', async () => {
  m.user.mockRejectedValueOnce(new Error('Unauthorized'));
  expect((await POST(await request())).status).toBe(401);
  m.origin.mockImplementationOnce(() => {
    throw new Error('Invalid request origin');
  });
  expect((await POST(await request())).status).toBe(400);
  expect((await POST(await request(['userId', other]))).status).toBe(400);
  expect(
    (await POST(await request(undefined, new TextEncoder().encode('<svg/>'), 'image/jpeg'))).status,
  ).toBe(400);
  expect(m.upload).not.toHaveBeenCalled();
  expect(m.update).not.toHaveBeenCalled();
  m.user
    .mockResolvedValueOnce({ id: owner, user_metadata: metadata })
    .mockRejectedValueOnce(new Error('Unauthorized'));
  expect((await POST(await request())).status).toBe(401);
  expect(m.update).not.toHaveBeenCalled();
});
it('retains a confirmed profile and never deletes referenced inventory images, including malformed metadata', async () => {
  m.references.mockResolvedValueOnce({ error: null, count: 1 });
  expect((await POST(await request())).status).toBe(200);
  expect(m.remove).not.toHaveBeenCalled();
  m.user.mockResolvedValue({
    id: owner,
    user_metadata: { [PROFILE_PHOTO_KEY]: old.replace(owner, other) },
  });
  expect(
    (await DELETE(new Request('https://app.test/api/profile', { method: 'DELETE' }))).status,
  ).toBe(200);
  expect(m.remove).not.toHaveBeenCalled();
  expect(m.update).toHaveBeenLastCalledWith({ data: { [PROFILE_PHOTO_KEY]: null } });
});
it('handles storage/Auth failures without deleting old photos or exposing diagnostics', async () => {
  m.upload.mockResolvedValueOnce({ error: { message: 'PRIVATE_STORAGE_DIAGNOSTIC' } });
  const failed = await POST(await request());
  expect(failed.status).toBe(503);
  expect(await failed.text()).not.toContain('PRIVATE_STORAGE_DIAGNOSTIC');
  expect(m.update).not.toHaveBeenCalled();
  m.update.mockResolvedValueOnce({ error: { message: 'PRIVATE_AUTH_DIAGNOSTIC' } });
  const uncertain = await POST(await request());
  expect(uncertain.status).toBe(503);
  expect(await uncertain.text()).not.toContain('PRIVATE_AUTH_DIAGNOSTIC');
  expect(m.remove).not.toHaveBeenCalled();
});
it('removes only the current actor profile and blocks foreign reads through the existing private proxy', async () => {
  expect(
    (await DELETE(new Request('https://app.test/api/profile', { method: 'DELETE', body: '' })))
      .status,
  ).toBe(200);
  m.update.mockClear();
  expect(
    (
      await DELETE(
        new Request('https://app.test/api/profile', {
          method: 'DELETE',
          body: JSON.stringify({ path: old }),
        }),
      )
    ).status,
  ).toBe(400);
  expect(m.update).not.toHaveBeenCalled();
  const result = await DELETE(new Request('https://app.test/api/profile', { method: 'DELETE' }));
  expect(await result.json()).toEqual({ path: null });
  expect(m.remove).toHaveBeenCalledWith([old]);
  m.update.mockClear();
  expect(
    (
      await DELETE(
        new Request('https://app.test/api/profile?userId=' + other, { method: 'DELETE' }),
      )
    ).status,
  ).toBe(400);
  expect(m.update).not.toHaveBeenCalled();
  expect(
    (
      await photo(
        new Request(
          'https://app.test/api/photos?path=' + encodeURIComponent(old.replace(owner, other)),
        ),
      )
    ).status,
  ).toBe(404);
  expect(m.download).not.toHaveBeenCalled();
});
it('bounds actual upload bytes and rejects duplicate files without any update', async () => {
  const big = new Request('https://app.test/api/profile', {
    method: 'POST',
    body: new Uint8Array(5 * 1024 * 1024 + 65537),
  });
  expect((await POST(big)).status).toBe(413);
  const form = new FormData();
  form.append('file', new File(['x'], 'one.png'));
  form.append('file', new File(['x'], 'two.png'));
  expect(
    (await POST(new Request('https://app.test/api/profile', { method: 'POST', body: form })))
      .status,
  ).toBe(400);
  expect(m.upload).not.toHaveBeenCalled();
  expect(m.update).not.toHaveBeenCalled();
});
