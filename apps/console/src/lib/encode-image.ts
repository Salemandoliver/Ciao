/**
 * Re-encode a photograph in the browser before it is uploaded.
 *
 * The naive shape is to POST the file the operator selected. A photograph off
 * a current phone is eight to twelve megabytes; a resort's twelve photographs
 * are well over a hundred. Uploaded from a car park in Sabratha on a mobile
 * connection, that is several minutes during which any drop loses the lot, and
 * it buys nothing — nothing in this product ever displays an image wider than
 * about 1600 pixels.
 *
 * So the browser decodes the file, draws it to a canvas at the sizes we
 * actually serve, and encodes WebP. The same twelve photographs become roughly
 * two megabytes, upload in seconds, and look identical on every phone that
 * will ever see them. The server does no image processing at all, which keeps
 * a native image toolchain out of the API container.
 *
 * Two sizes are produced. The wide one is the photograph; the narrow one is
 * what gets drawn in a 96-pixel box on a search card, where sending the wide
 * one would waste ninety percent of a guest's data on pixels their screen
 * cannot show.
 */

/** What the marketplace actually displays at full size. */
export const FULL_WIDTH = 1600;
/** Card and thumbnail size — the common case, and the one that must be small. */
export const THUMB_WIDTH = 640;

/**
 * WebP quality.
 *
 * 0.82 is the point where side-by-side comparison of a resort photograph stops
 * showing a difference on a phone screen, and is about a third of the bytes of
 * 0.95. Photographs of buildings and water are forgiving; text in an image is
 * not, which is one more reason price lists belong in the rate card and not in
 * a photograph.
 */
const QUALITY = 0.82;

export interface EncodedImage {
  blob: Blob;
  width: number;
  contentType: string;
}

/** Reject obvious non-images early, with a message the operator can act on. */
export function isSupportedImage(file: File): boolean {
  return /^image\/(jpeg|png|webp|avif|gif|bmp|tiff?)$/i.test(file.type);
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  // createImageBitmap handles EXIF orientation in every browser that has it,
  // which matters because a phone photograph taken in portrait is stored
  // landscape with a rotation flag, and drawing it without honouring that flag
  // is how a resort's beach ends up sideways in the catalogue.
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* fall through to the <img> path */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("decode_failed"));
      img.src = url;
    });
  } finally {
    // Revoked on the next tick so the decode that is already in flight keeps
    // its source alive.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function dimensions(src: ImageBitmap | HTMLImageElement): { w: number; h: number } {
  return src instanceof HTMLImageElement
    ? { w: src.naturalWidth, h: src.naturalHeight }
    : { w: src.width, h: src.height };
}

async function encodeAt(
  src: ImageBitmap | HTMLImageElement,
  targetWidth: number,
): Promise<EncodedImage> {
  const { w, h } = dimensions(src);
  if (!w || !h) throw new Error("decode_failed");
  // Never upscale: a small photograph enlarged to 1600 is a bigger file of the
  // same picture, which is the exact opposite of the point.
  const width = Math.min(targetWidth, w);
  const height = Math.max(1, Math.round((h / w) * width));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", QUALITY),
  );
  // Every browser this console supports encodes WebP. If one does not, JPEG is
  // a larger but correct answer, and the API accepts both.
  if (blob && blob.type === "image/webp")
    return { blob, width, contentType: "image/webp" };

  const jpeg = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", QUALITY),
  );
  if (!jpeg) throw new Error("encode_failed");
  return { blob: jpeg, width, contentType: "image/jpeg" };
}

/** Encode one file at both sizes. */
export async function encodeImage(
  file: File,
): Promise<{ full: EncodedImage; thumb: EncodedImage }> {
  const src = await loadBitmap(file);
  try {
    const full = await encodeAt(src, FULL_WIDTH);
    const thumb = await encodeAt(src, THUMB_WIDTH);
    return { full, thumb };
  } finally {
    if (!(src instanceof HTMLImageElement)) src.close();
  }
}

/** Base64 without the `data:` prefix, which is what the upload endpoint wants. */
export async function toBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  // Chunked because String.fromCharCode(...millions) overflows the call stack,
  // and a four-megabyte photograph is exactly that many arguments.
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
