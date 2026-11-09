import { IMAGE_LIMIT } from './schema';
export async function prepareImage(file: File): Promise<File> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('Use JPEG, PNG or WebP images. Export HEIC photos as JPEG first.');
  if (file.size > 20 * 1024 * 1024)
    throw new Error('The original image must be smaller than 20 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (image.width * image.height > 40_000_000)
      throw new Error('This image is too large. Crop it to the order or listing.');
    const scale = Math.min(1, 2000 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9),
    );
    if (!blob || blob.size > IMAGE_LIMIT)
      throw new Error('Crop this screenshot to reduce it below 5 MB.');
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } finally {
    URL.revokeObjectURL(url);
  }
}
