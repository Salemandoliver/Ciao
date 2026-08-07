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

/**
 * Hero quality, which is deliberately higher.
 *
 * 0.82 is right for a card 300 pixels wide, where nobody is looking closely
 * and there are twelve of them on a search page. A hero is one image, drawn
 * the full width of the screen, and it is the first thing anyone sees of
 * Ciao — the place where softness reads as "this company is not serious"
 * rather than as a saved kilobyte. 0.92 costs roughly 40% more bytes on one
 * image per page load, which is the cheapest quality this product can buy.
 */
const HERO_QUALITY = 0.92;

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
  quality: number = QUALITY,
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
    canvas.toBlob(resolve, "image/webp", quality),
  );
  // Every browser this console supports encodes WebP. If one does not, JPEG is
  // a larger but correct answer, and the API accepts both.
  if (blob && blob.type === "image/webp")
    return { blob, width, contentType: "image/webp" };

  const jpeg = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
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

/**
 * Encode one file at an arbitrary set of widths, decoding it only once.
 *
 * The hero rotator needs 800 and 1600 rather than the catalogue's 640 and
 * 1600, because it is a full-bleed photograph rather than a card — and it
 * ships both to the browser in a `srcSet`, so a phone picks the small one and
 * a laptop picks the large one without us guessing.
 */
export async function encodeWidths(
  file: File,
  widths: number[],
  quality: number = HERO_QUALITY,
): Promise<EncodedImage[]> {
  const src = await loadBitmap(file);
  try {
    const out: EncodedImage[] = [];
    const seen = new Set<number>();
    for (const w of widths) {
      const enc = await encodeAt(src, w, quality);
      /*
       * Two requested widths can collapse into one encoding, because we never
       * enlarge: a 760px screenshot asked for 1600 and for 800 comes back at
       * 760 both times. Uploading it twice writes the same object twice and
       * then records two "different" variants that are the same file — which
       * is how the hero ended up with a path claiming widths that did not
       * exist. One encoding per actual width, and the caller records what it
       * got rather than what it asked for.
       */
      if (seen.has(enc.width)) continue;
      seen.add(enc.width);
      out.push(enc);
    }
    return out;
  } finally {
    if (!(src instanceof HTMLImageElement)) src.close();
  }
}

/**
 * A stable identifier for "these encodings are the same photograph".
 *
 * The hero stores one path per image and the app appends `-800.webp` and
 * `-1600.webp` itself, so the two encodings must share a key prefix. Content
 * hashes cannot supply it — the 800px and 1600px files have different bytes
 * and therefore different hashes — so the prefix is derived once from the
 * original file and sent with both uploads.
 */
export async function fileFingerprint(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
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
