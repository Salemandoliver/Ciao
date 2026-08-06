/**
 * Where photographs live.
 *
 * Until now the answer was "in the web app's `public/` directory", which meant
 * a photograph could only be added by committing a file and shipping a
 * release. That is a fine answer for the eight seeded demo listings and an
 * impossible one for a supply team signing up a resort on a Thursday: the
 * pictures arrive on WhatsApp during the field visit and have to be on the
 * listing before the operator leaves the car park.
 *
 * So photographs now go to object storage — Cloudflare R2, addressed through
 * the S3 API. Three properties matter and all three are why R2 rather than a
 * disk:
 *
 *  - **It survives deploys.** A Railway container's filesystem does not, and a
 *    listing that loses its photographs on a routine deploy is worse than one
 *    that never had any, because nobody will notice until a guest does.
 *  - **Egress is free.** Every photograph on this platform is served to a
 *    phone on a Libyan mobile connection, repeatedly. Per-gigabyte egress
 *    pricing on a photo-heavy marketplace is a tax on the thing the product is
 *    for.
 *  - **It is somebody else's uptime.** The API going down should cost us
 *    bookings, not the appearance of every image in the catalogue.
 *
 * Everything here is deliberately behind one small interface — `configured`,
 * `put`, `remove`, `publicUrl` — because the *choice* of R2 should be worth
 * one file if it is ever wrong. The rest of the codebase only ever sees a URL.
 *
 * ## The unconfigured case is a first-class case
 *
 * R2 needs a bucket and four secrets, and on the day this ships they do not
 * exist yet. The tempting shape is to throw on boot, or worse, to let the
 * upload button appear and fail with a 500 when an operator finally presses
 * it. Instead `configured()` is public, the API reports it, and the console
 * shows the operator the older path-and-library workflow with a plain sentence
 * about what is missing. A tool that explains why it cannot do something is
 * still a working tool; one that offers a button that throws is not.
 */
import { AwsClient } from "aws4fetch";
import { config } from "../../config.js";

/**
 * The origin that legacy relative media paths (`/media/<slug>/1.webp`) resolve
 * against.
 *
 * Those files are static assets of the *marketplace* build, so they are only
 * ever present on the web app's origin. The console and the partner app render
 * the same URLs and would resolve them against themselves, where nothing is
 * served — which is precisely why every thumbnail in the business console was
 * a broken image icon. Handing the base back from the API rather than baking
 * it into each front-end at build time also means the day ciao.ly is bought,
 * one variable changes and three products follow.
 */
export function mediaBase(): string {
  return config.webBaseUrl.replace(/\/+$/, "");
}

/** Whether object storage is usable right now. */
export function configured(): boolean {
  const m = config.media;
  return Boolean(m.bucket && m.accountId && m.accessKeyId && m.secretAccessKey);
}

/**
 * What is missing, in the order somebody setting this up would fix it. Sent to
 * the console so an operator can tell their founder exactly what to go and do,
 * rather than filing "photos are broken".
 */
export function missingConfig(): string[] {
  const m = config.media;
  return [
    ["R2_BUCKET", m.bucket],
    ["R2_ACCOUNT_ID", m.accountId],
    ["R2_ACCESS_KEY_ID", m.accessKeyId],
    ["R2_SECRET_ACCESS_KEY", m.secretAccessKey],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k as string);
}

/**
 * The public URL of a stored object.
 *
 * `R2_PUBLIC_BASE_URL` is separate from the credentials on purpose: it is
 * whatever the bucket is actually published under, which starts as an
 * `r2.dev` development address and later becomes `img.ciao.ly` without any
 * credential changing. When it is unset we fall back to the S3 endpoint, which
 * is wrong for a *public* URL but at least diagnostic rather than blank.
 */
export function publicUrl(key: string): string {
  const base = config.media.publicBaseUrl || endpoint();
  return `${base.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
}

function endpoint(): string {
  return `https://${config.media.accountId}.r2.cloudflarestorage.com/${config.media.bucket}`;
}

let client: AwsClient | null = null;
function aws(): AwsClient {
  client ??= new AwsClient({
    accessKeyId: config.media.accessKeyId,
    secretAccessKey: config.media.secretAccessKey,
    service: "s3",
    // R2 ignores the region but SigV4 requires one in the credential scope,
    // and "auto" is what Cloudflare's own documentation signs with.
    region: "auto",
  });
  return client;
}

export class StorageError extends Error {}

/**
 * Store an object and return its public URL.
 *
 * `immutable` caching is safe because keys carry a content hash — a photograph
 * is never replaced in place, it is uploaded under a new key and the listing
 * points at it. That is also what makes deletion safe to skip on failure: an
 * orphan is a few kilobytes, whereas deleting a key a live listing still
 * points at is a hole in the catalogue.
 */
export async function put(
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<string> {
  if (!configured()) throw new StorageError("media_storage_unconfigured");
  const res = await aws().fetch(`${endpoint()}/${key.replace(/^\/+/, "")}`, {
    method: "PUT",
    // Copied into its own ArrayBuffer because a Uint8Array view may be a
    // window onto a larger pooled buffer, and `fetch` would send the whole
    // pool. `Buffer.from(...).buffer` is the classic way to upload a
    // megabyte of somebody else's memory.
    body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
  if (!res.ok) {
    // The body carries S3's XML error code, which is the difference between
    // "the bucket name is wrong" and "the key is wrong" when somebody is
    // setting this up for the first time.
    const detail = await res.text().catch(() => "");
    throw new StorageError(
      `r2_put_failed_${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
    );
  }
  return publicUrl(key);
}

/** Best-effort delete. Callers treat failure as "leave the orphan". */
export async function remove(key: string): Promise<boolean> {
  if (!configured()) return false;
  const res = await aws()
    .fetch(`${endpoint()}/${key.replace(/^\/+/, "")}`, { method: "DELETE" })
    .catch(() => null);
  return Boolean(res?.ok);
}

/**
 * The object key for a listing photograph.
 *
 * Grouped by listing slug so a human can browse the bucket and recognise what
 * they are looking at, and suffixed with a content hash so re-uploading the
 * same photograph is idempotent and every key can be cached forever. The width
 * is in the name because the same photograph is stored at several sizes and
 * the marketplace picks by name rather than by asking.
 */
export function listingKey(
  slug: string,
  hash: string,
  width: number,
  ext: string,
): string {
  const safeSlug = slug.replace(/[^a-z0-9-]/gi, "").slice(0, 60) || "listing";
  return `listings/${safeSlug}/${hash.slice(0, 16)}-${width}.${ext}`;
}
