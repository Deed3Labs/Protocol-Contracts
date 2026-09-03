/** Decode a data URL into an image, so callers can measure or draw it. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image failed'));
    image.src = src;
  });
}

/**
 * Turn a picked image file into a small square-ish data URL.
 *
 * Downscaled to 256px and re-encoded as JPEG before it goes anywhere: an avatar
 * is rendered at 28px in the header, and shipping a 4MB phone photo to the
 * backend to draw it that size is bandwidth nobody agreed to spend.
 *
 * Returns the original data URL if a canvas isn't available, so a member on an
 * unusual browser still gets a picture rather than an error.
 */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

export async function fileToAvatarDataUrl(file: File, max = 256): Promise<string> {
  const dataUrl = await readFileAsDataUrl(file);

  const img = await loadImage(dataUrl);

  const scale = Math.min(1, max / Math.max(img.width, img.height || 1));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;

  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.82);
}


/**
 * Render exactly what the crop mask was showing, at `out` pixels square.
 *
 * The Adjust step draws the image at `stage` height, scaled and translated; this
 * repeats that transform on a canvas and reads back only the masked circle's
 * bounding box. Same arithmetic, so what you positioned is what you get.
 *
 * Async because it has to be: an <img> is not decoded on the line after its src
 * is set, and a synchronous version silently returns the original — a whole
 * uncropped phone photo, megabytes wide, which is worse than doing nothing.
 */
export async function cropToDataUrl(
  src: string,
  {
    stage,
    mask,
    zoom,
    offset,
    out = 256,
  }: { stage: number; mask: number; zoom: number; offset: { x: number; y: number }; out?: number },
): Promise<string> {
  const img = await loadImage(src);

  const canvas = document.createElement('canvas');
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext('2d');
  if (!ctx || !img.naturalWidth) return src;

  // The stage renders the image at a fixed height, centred, then transformed.
  const drawnH = stage * zoom;
  const drawnW = (img.naturalWidth / img.naturalHeight) * drawnH;
  const centreX = stage / 2 + offset.x;
  const centreY = stage / 2 + offset.y;

  const scale = out / mask;
  ctx.translate(out / 2, out / 2);
  ctx.scale(scale, scale);
  ctx.drawImage(
    img,
    centreX - drawnW / 2 - stage / 2,
    centreY - drawnH / 2 - stage / 2,
    drawnW,
    drawnH,
  );

  return canvas.toDataURL('image/jpeg', 0.85);
}
