import 'server-only';
import sharp from 'sharp';
import { SOURCE_IMAGE_EDGE_LIMIT, SOURCE_IMAGE_PIXEL_LIMIT } from './schema';
export type VisionView = {
  label: string;
  width: number;
  height: number;
  mime: string;
  bytes: Uint8Array;
};
/** Full composition plus bounded overlapping detail windows for high-resolution screenshots. */
export async function visionImages(bytes: Uint8Array, mime: string) {
  const image = sharp(bytes, { limitInputPixels: SOURCE_IMAGE_PIXEL_LIMIT, failOn: 'error' });
  const meta = await image.metadata();
  if (
    !meta.width ||
    !meta.height ||
    meta.width > SOURCE_IMAGE_EDGE_LIMIT ||
    meta.height > SOURCE_IMAGE_EDGE_LIMIT ||
    (meta.pages ?? 1) > 1
  )
    throw new Error('Invalid image dimensions');
  const rotated = !!meta.orientation && meta.orientation !== 1;
  const normalized = rotated ? await image.rotate().png().toBuffer() : bytes;
  const dimensions = rotated ? await sharp(normalized).metadata() : meta;
  const width = dimensions.width!,
    height = dimensions.height!;
  const views: VisionView[] = [
    {
      label: 'Full screenshot. All card coordinates refer to this image.',
      width,
      height,
      bytes: normalized,
      mime: rotated ? 'image/png' : mime,
    },
  ];
  if (Math.max(width, height) > 2000 && Math.min(width, height) > 600) {
    const cropWidth = Math.ceil(width * 0.6),
      cropHeight = Math.ceil(height * 0.6);
    for (const top of [0, height - cropHeight])
      for (const left of [0, width - cropWidth]) {
        const cropped = await sharp(normalized)
          .extract({ left, top, width: cropWidth, height: cropHeight })
          .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
          .toBuffer();
        views.push({
          label: `Detail view of the SAME screenshot: x=${left}, y=${top}, width=${cropWidth}, height=${cropHeight}, full=${width}x${height}. Overlaps are not new products.`,
          width: cropWidth,
          height: cropHeight,
          bytes: cropped,
          mime: 'image/jpeg',
        });
      }
  }
  return { width, height, views };
}
