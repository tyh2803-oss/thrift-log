import { prepareImage } from './assistant/images';

/** Reuse existing picker validation, then produce a small square, metadata-free photo. */
export async function prepareProfileImage(original: File) {
  const file = await prepareImage(original);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const edge = Math.min(image.width, image.height);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.min(edge, 512);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to prepare this photo. Try another image.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(
      image,
      (image.width - edge) / 2,
      (image.height - edge) / 2,
      edge,
      edge,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85),
    );
    if (!blob || blob.size > 512000) throw new Error('Choose a smaller profile photo.');
    return new File([blob], 'profile.jpg', { type: 'image/jpeg' });
  } finally {
    URL.revokeObjectURL(url);
  }
}
