/**
 * Photograph upload.
 *
 * ## Why the browser does the resizing
 *
 * The obvious design is multipart upload of the original file and a resize on
 * the server with sharp. This does the opposite: the console decodes the file,
 * draws it to a canvas at two widths, encodes WebP, and posts the results. The
 * API validates and stores.
 *
 * That inversion is a bandwidth decision, and bandwidth is the constraint this
 * whole product is designed around. A photograph off a modern phone is eight
 * to twelve megabytes. An operator standing in a resort's car park on a Libyan
 * mobile connection, uploading twelve of them, is uploading a hundred
 * megabytes — several minutes of a bar of signal, and a failure mode where the
 * eleventh upload dies and nobody knows which ones landed. Re-encoded to WebP
 * at 1600px, the same photograph is about 200KB. The listing looks identical
 * on every phone that will ever see it, and the field visit finishes.
 *
 * It also means no native image toolchain in the API image, which keeps the
 * container small and the build boring.
 *
 * The cost of trusting the client to encode is that the client could send
 * anything. So the server does not trust it: the declared type must be one it
 * allows, the *magic bytes* must agree with the declared type, the byte length
 * is capped, and the stored key is derived from a hash of the content we
 * actually received rather than from any name the client chose. An operator
 * cannot upload `evil.html` and have it served from our origin, because the
 * key, the extension and the content type are all decided here.
 *
 * ## Why keys are content-hashed
 *
 * Uploading the same photograph twice writes the same key twice, which is
 * free and idempotent. Nothing is ever replaced in place, so every object can
 * be cached forever, and a listing's media array can never point at a key
 * whose contents changed underneath it.
 */
import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db/client.js";
import { CiaoError } from "../../lib/errors.js";
import { config } from "../../config.js";
import { bizGuard } from "../business/guards.js";
import { track } from "../intelligence/events.js";
import {
  StorageError,
  configured,
  heroKey,
  listingKey,
  mediaBase,
  missingConfig,
  put,
} from "./storage.js";

/**
 * The formats we will store, and how to recognise each one without believing
 * the client. Keyed by the content type the client declares; the sniffer is
 * the authority.
 */
const FORMATS: Record<string, { ext: string; sniff: (b: Uint8Array) => boolean }> = {
  "image/webp": {
    ext: "webp",
    // "RIFF" .... "WEBP"
    sniff: (b) =>
      b.length > 12 &&
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
  "image/jpeg": {
    ext: "jpg",
    sniff: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  "image/png": {
    ext: "png",
    sniff: (b) =>
      b.length > 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
};

const UploadBody = z.object({
  /**
   * `listing` files hang off a listing and are keyed by their own content.
   * `hero` files are the home page rotation, are not attached to any listing,
   * and are keyed by a caller-supplied group so that the two encodings of one
   * photograph share a prefix — see `heroKey`.
   */
  kind: z.enum(["listing", "hero"]).default("listing"),
  listingId: z.string().uuid().optional(),
  group: z.string().max(64).optional(),
  contentType: z.string().max(40),
  width: z.number().int().min(64).max(6000),
  /** Base64, without a data: prefix — the console strips it. */
  data: z.string().min(16),
});

export async function mediaRoutes(app: FastifyInstance) {
  /**
   * Whether uploading is possible, and if not, precisely what is missing.
   *
   * Public to the console rather than inferred from a failed upload: the
   * operator who needs this information is not the person who can act on it,
   * so it has to be phrasable in a message to somebody else.
   */
  app.get("/v1/biz/media/config", async (req, reply) => {
    await bizGuard(req, "catalogue");
    return reply.send({
      uploads: configured(),
      missing: missingConfig(),
      maxBytes: config.media.maxBytes,
      base: mediaBase(),
    });
  });

  /**
   * Store one already-encoded image and return its URL.
   *
   * One variant per request rather than a batch: on a connection that drops,
   * eleven successful small requests and one retry beats one large request
   * that has to start again, and the console can show progress that means
   * something.
   */
  app.post(
    "/v1/biz/media/upload",
    {
      config: { rateLimit: { max: 120, timeWindow: "10 minutes" } },
      /*
       * The app-wide body limit is 1MB, which is right for every other route
       * and wrong for the only one that carries an image. Base64 costs a third
       * on top of the bytes, so the ceiling here is the image ceiling plus that
       * overhead plus a little slack for the JSON around it — raised for this
       * route alone rather than globally, so a 5MB body is still refused
       * everywhere it would be a bug.
       */
      bodyLimit: Math.ceil(config.media.maxBytes * 1.4) + 4096,
    },
    async (req, reply) => {
      const claims = await bizGuard(req, "catalogue");
      const body = UploadBody.parse(req.body);

      /*
       * The request is validated before the environment is. Both failures are
       * real, but only one of them is the operator's to fix, and being told
       * "photo storage is not configured" when the actual problem is that you
       * picked a PDF sends somebody to bother an engineer for no reason. The
       * unconfigured check is a backstop that sits immediately before the
       * write; the console already knows from `/media/config` and does not
       * offer the button.
       */
      const format = FORMATS[body.contentType];
      if (!format) throw new CiaoError("VALIDATION", "unsupported_image_type");

      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(Buffer.from(body.data, "base64"));
      } catch {
        throw new CiaoError("VALIDATION", "malformed_image_data");
      }
      if (bytes.byteLength === 0) throw new CiaoError("VALIDATION", "malformed_image_data");
      if (bytes.byteLength > config.media.maxBytes)
        throw new CiaoError("VALIDATION", "image_too_large");
      // The declared type is a hint; the bytes are the fact.
      if (!format.sniff(bytes)) throw new CiaoError("VALIDATION", "image_type_mismatch");

      /*
       * A hero image belongs to the home page rather than to any listing, and
       * changing what the whole country sees first is a `govern` decision, not
       * a catalogue one — the same capability that already gates writing the
       * hero setting itself. Uploading the file and choosing the rotation are
       * two halves of one act, and it would be incoherent for an operator to
       * be able to do the first but not the second.
       */
      if (body.kind === "hero") await bizGuard(req, "govern");

      let slug = "";
      if (body.kind === "listing") {
        if (!body.listingId) throw new CiaoError("VALIDATION", "listing_required");
        const [listing] = await db
          .select({ slug: schema.listings.slug })
          .from(schema.listings)
          .where(eq(schema.listings.id, body.listingId))
          .limit(1);
        if (!listing) throw new CiaoError("VALIDATION", "listing_not_found");
        slug = listing.slug;
      } else if (!body.group) {
        throw new CiaoError("VALIDATION", "group_required");
      }

      if (!configured()) throw new CiaoError("VALIDATION", "media_storage_unconfigured");

      const hash = createHash("sha256").update(bytes).digest("hex");
      const key =
        body.kind === "hero"
          ? heroKey(body.group!, body.width, format.ext)
          : listingKey(slug, hash, body.width, format.ext);

      let url: string;
      try {
        url = await put(key, bytes, body.contentType);
      } catch (e) {
        // Storage failing is an operations problem, not the operator's
        // mistake, so it is reported as one — with the provider's own words
        // kept in the log and out of the response.
        req.log.error({ err: e, key }, "media upload failed");
        if (e instanceof StorageError)
          throw new CiaoError("VALIDATION", "media_storage_failed");
        throw e;
      }

      await db.insert(schema.auditLog).values({
        actorId: claims.sub,
        action: body.kind === "hero" ? "media.hero.uploaded" : "media.uploaded",
        targetType: body.kind === "hero" ? "setting" : "listing",
        targetId: body.kind === "hero" ? "home.hero" : body.listingId!,
        detail: { key, bytes: bytes.byteLength, width: body.width },
      });
      track(
        "media.uploaded",
        {
          listingId: body.listingId ?? null,
          width: body.width,
          bytes: bytes.byteLength,
        },
        { userId: claims.sub, source: "api" },
      );

      /*
       * `base` is the URL with the width and extension stripped back off, so
       * the hero setting can store the one path it wants and let the apps
       * append `-800.webp` and `-1600.webp` as they already do. Only sent for
       * heroes; nothing else uses the convention.
       */
      return reply.send({
        url,
        key,
        bytes: bytes.byteLength,
        width: body.width,
        ...(body.kind === "hero"
          ? { base: url.replace(new RegExp(`-${body.width}\\.${format.ext}$`), "") }
          : {}),
      });
    },
  );
}
