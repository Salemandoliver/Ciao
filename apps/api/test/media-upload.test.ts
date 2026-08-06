/**
 * Photograph upload — the guard rails, not the happy path.
 *
 * The happy path needs a real bucket and is therefore not a unit test; what is
 * worth pinning down here is everything the endpoint refuses, because this is
 * the one route in the platform that takes bytes from a browser and puts them
 * somewhere the public can read. Each of these tests corresponds to a way that
 * could go wrong:
 *
 *  - an operator's session is not enough — it has to be a *console* session
 *    with the catalogue capability, or the marketplace could upload;
 *  - the declared content type is a hint, not a fact, so a PNG header
 *    announced as WebP is refused rather than stored under a `.webp` key
 *    somebody else's browser will then sniff;
 *  - the size ceiling holds even though the console re-encodes before sending,
 *    because "the client shrinks it first" is not a security property;
 *  - and when storage is not configured the answer is a clean validation
 *    error, not a 500 — that is the state the platform ships in, and it has to
 *    be a state the console can render a sentence about.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, pool, schema } from "../src/db/client.js";
import { signAccessToken } from "../src/lib/auth.js";
import { config } from "../src/config.js";
import { configured, listingKey, mediaBase, missingConfig } from "../src/modules/media/storage.js";

let app: FastifyInstance;
let opsToken: string;
let guestToken: string;
let listingId: string;

const run = Date.now().toString().slice(-6);
const phoneFor = (tag: string) => `+21809${tag}${run}`;

/** A real, minimal PNG — eight bytes of signature is all the sniffer reads. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0]);
/** A real, minimal WebP container: "RIFF" ---- "WEBP". */
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("WEBP"),
  Buffer.alloc(16),
]);

async function tokenFor(phone: string, role: "ops" | "guest") {
  const e164 = phone;
  let [user] = await db.select().from(schema.users).where(eq(schema.users.phone, e164)).limit(1);
  if (!user) [user] = await db.insert(schema.users).values({ phone: e164, role }).returning();
  else {
    await db.update(schema.users).set({ role }).where(eq(schema.users.id, user.id));
    user = { ...user, role };
  }
  return signAccessToken(
    { sub: user!.id, role, phone: e164 },
    role === "guest" ? "app" : "biz",
  );
}

function upload(token: string, body: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/v1/biz/media/upload",
    headers: { authorization: `Bearer ${token}` },
    payload: body,
  });
}

beforeAll(async () => {
  app = await buildApp();
  opsToken = await tokenFor(phoneFor("41"), "ops");
  guestToken = await tokenFor(phoneFor("42"), "guest");
  const [listing] = await db.select({ id: schema.listings.id }).from(schema.listings).limit(1);
  listingId = listing!.id;
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("media storage configuration", () => {
  it("reports itself unconfigured when the credentials are absent", () => {
    // The suite runs without R2 credentials, which is also how the platform
    // ships on day one. That state has to be legible rather than fatal.
    expect(configured()).toBe(false);
    expect(missingConfig().length).toBeGreaterThan(0);
    expect(missingConfig()).toContain("R2_BUCKET");
  });

  it("resolves legacy relative paths against the marketplace origin", () => {
    // The bug this fixes: the console rendered `/media/x/1.webp` against its
    // own origin, where nothing is served, so every thumbnail was broken.
    expect(mediaBase()).toBe(config.webBaseUrl.replace(/\/+$/, ""));
    expect(mediaBase().endsWith("/")).toBe(false);
  });

  it("derives object keys from content, not from the name the client sent", () => {
    const key = listingKey("lancaster-chalet", "a".repeat(64), 1600, "webp");
    expect(key).toBe("listings/lancaster-chalet/aaaaaaaaaaaaaaaa-1600.webp");
    // A slug full of traversal and separators cannot escape the prefix.
    expect(listingKey("../../etc/passwd", "b".repeat(64), 640, "webp")).toBe(
      "listings/etcpasswd/bbbbbbbbbbbbbbbb-640.webp",
    );
    // An empty slug still yields a usable key rather than a double slash.
    expect(listingKey("!!!", "c".repeat(64), 640, "webp")).toBe(
      "listings/listing/cccccccccccccccc-640.webp",
    );
  });

  it("tells the console exactly what is missing", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/biz/media/config",
      headers: { authorization: `Bearer ${opsToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.uploads).toBe(false);
    expect(body.missing).toContain("R2_ACCESS_KEY_ID");
    expect(body.maxBytes).toBe(config.media.maxBytes);
  });
});

describe("media upload guards", () => {
  it("refuses a marketplace session outright", async () => {
    const res = await upload(guestToken, {
      listingId,
      contentType: "image/webp",
      width: 1600,
      data: WEBP.toString("base64"),
    });
    // A guest token is the wrong audience, so it never reaches the handler.
    expect([401, 403]).toContain(res.statusCode);
  });

  it("refuses a content type it does not store", async () => {
    const res = await upload(opsToken, {
      listingId,
      contentType: "image/svg+xml",
      width: 1600,
      data: Buffer.from("<svg onload=alert(1)>").toString("base64"),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.detail).toBe("unsupported_image_type");
  });

  it("refuses bytes that disagree with the declared type", async () => {
    // A PNG announced as WebP. Believing the declaration is how a file ends up
    // stored under an extension that misrepresents what a browser will do
    // with it.
    const res = await upload(opsToken, {
      listingId,
      contentType: "image/webp",
      width: 1600,
      data: PNG.toString("base64"),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.detail).toBe("image_type_mismatch");
  });

  it("accepts each declared type only with its own magic bytes", async () => {
    const res = await upload(opsToken, {
      listingId,
      contentType: "image/png",
      width: 1600,
      data: PNG.toString("base64"),
    });
    // Passes the sniffer and falls at the next gate — storage — which is the
    // proof that the sniffer let the right bytes through.
    expect(res.json().error.detail).toBe("media_storage_unconfigured");
  });

  it("refuses an image over the ceiling even though the client shrinks first", async () => {
    const big = Buffer.concat([WEBP, Buffer.alloc(config.media.maxBytes + 1024)]);
    const res = await upload(opsToken, {
      listingId,
      contentType: "image/webp",
      width: 1600,
      data: big.toString("base64"),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.detail).toBe("image_too_large");
  });

  it("refuses an unknown listing before it touches storage", async () => {
    const res = await upload(opsToken, {
      listingId: "00000000-0000-4000-8000-000000000000",
      contentType: "image/webp",
      width: 1600,
      data: WEBP.toString("base64"),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.detail).toBe("listing_not_found");
  });

  it("fails as a validation error, not a crash, when storage is unconfigured", async () => {
    const res = await upload(opsToken, {
      listingId,
      contentType: "image/webp",
      width: 1600,
      data: WEBP.toString("base64"),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.detail).toBe("media_storage_unconfigured");
  });
});

describe("the media surfaces the console reads", () => {
  it("hands back the base a relative path has to be resolved against", async () => {
    const [listing] = await db
      .select({ id: schema.listings.id })
      .from(schema.listings)
      .limit(1);
    const res = await app.inject({
      method: "GET",
      url: `/v1/biz/listings/${listing!.id}/media`,
      headers: { authorization: `Bearer ${opsToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().base).toBe(mediaBase());
  });

  it("accepts a media item carrying a thumbnail, and keeps it", async () => {
    const [listing] = await db
      .select({ id: schema.listings.id, media: schema.listings.media, status: schema.listings.status })
      .from(schema.listings)
      .where(eq(schema.listings.status, "draft"))
      .limit(1);
    if (!listing) return; // no draft in this dataset; nothing to assert safely
    const res = await app.inject({
      method: "PUT",
      url: `/v1/biz/listings/${listing.id}/media`,
      headers: { authorization: `Bearer ${opsToken}` },
      payload: {
        media: [
          { url: "https://img.example/full-1600.webp", thumbUrl: "https://img.example/t-640.webp" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().media[0].thumbUrl).toBe("https://img.example/t-640.webp");
    // Put the listing back as it was, so this test does not shape the others.
    await db
      .update(schema.listings)
      .set({ media: listing.media })
      .where(eq(schema.listings.id, listing.id));
  });
});
