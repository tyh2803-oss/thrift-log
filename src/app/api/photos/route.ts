import { NextResponse } from 'next/server';
import { adminClient, checkOrigin, requireUser } from '@/lib/supabase/server';
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser(request);
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size > 5 * 1024 * 1024)
      throw new Error('Upload an image smaller than 5 MB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const png = [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v);
    const webp =
      new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
      new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
    const ext = jpg ? 'jpg' : png ? 'png' : webp ? 'webp' : null;
    if (!ext) throw new Error('Use a JPEG, PNG, or WebP image.');
    const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await adminClient()
      .storage.from('inventory-photos')
      .upload(path, bytes, {
        contentType: ext === 'jpg' ? 'image/jpeg' : `image/${ext}`,
        upsert: false,
      });
    if (error) throw new Error('Photo upload failed. Check the private storage bucket.');
    return NextResponse.json({ path }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Upload failed' },
      { status: 400 },
    );
  }
}
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const path = new URL(request.url).searchParams.get('path');
    if (
      !path ||
      !path.startsWith(`${user.id}/`) ||
      !/^[a-f0-9-]+\/[a-z0-9_-]+\.(jpg|png|webp)$/i.test(path)
    )
      throw new Error('Unauthorized');
    // Proxy private bytes rather than issuing bearer URLs that could outlive access revocation.
    const { data, error } = await adminClient().storage.from('inventory-photos').download(path);
    if (error || !data || data.size > 5 * 1024 * 1024) throw new Error('Unavailable');
    return new Response(await data.arrayBuffer(), {
      headers: {
        'Content-Type': /\.png$/i.test(path)
          ? 'image/png'
          : /\.webp$/i.test(path)
            ? 'image/webp'
            : 'image/jpeg',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
