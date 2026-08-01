/**
 * Trust surface — ratings, reviews, and the dispute record.
 *
 * Ciao's whole thesis is that the market fails on trust, not on inventory.
 * So the trust data is public and specific: what guests scored, what the
 * complaint history looks like, and how fast we resolved it.
 *
 * WHAT IS PUBLIC (and why):
 *  - rating value/count/histogram/dimension averages — the familiar signal
 *  - published review text + host reply — double-blind, verified stays only
 *  - dispute COUNTS and OUTCOMES with a denominator, never the statements
 *    (statements/evidence identify people and invite defamation; the
 *    trustworthy fact is "3 cases, all resolved, 2 within 48h" — see the
 *    ciao-trust skill for the full rule).
 * Reviewer identity follows §11.5: public initials, never full names.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "../../db/client.js";
import { CiaoError } from "../../lib/errors.js";
import { authenticate } from "../../lib/guards.js";
import { verifyAccessToken } from "../../lib/auth.js";
import { track } from "../intelligence/events.js";

/** Booking states that count as a delivered stay/service (dispute denominator). */
const DELIVERED_STATES = ["checked_in", "completed", "reviewed", "no_show", "disputed", "resolved"];

/** §11.5 — never expose a full name publicly. */
function publicAuthor(u: { publicName: string | null; displayName: string | null } | undefined) {
  if (!u) return "ضيف";
  if (u.publicName) return u.publicName;
  if (u.displayName) {
    return u.displayName
      .split(/\s+/)
      .map((w) => w[0])
      .filter(Boolean)
      .join(". ");
  }
  return "ضيف";
}

function overallOf(scores: Record<string, number>): number {
  const vals = Object.values(scores);
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export async function trustRoutes(app: FastifyInstance) {
  /**
   * Everything the trust dialog needs, in one round trip (3G budget §12.3).
   * Auth is optional: with a token we also answer "can this person review?".
   */
  app.get("/v1/listings/:id/trust", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const [listing] = await db
      .select({ listing: schema.listings, venue: schema.venues })
      .from(schema.listings)
      .innerJoin(schema.venues, eq(schema.listings.venueId, schema.venues.id))
      .where(eq(schema.listings.id, id))
      .limit(1);
    if (!listing) throw new CiaoError("BOOKING_NOT_FOUND");

    // ---- reviews (published guest reviews only)
    const reviewRows = await db
      .select({
        review: schema.reviews,
        author: { publicName: schema.users.publicName, displayName: schema.users.displayName },
      })
      .from(schema.reviews)
      .leftJoin(schema.users, eq(schema.reviews.authorId, schema.users.id))
      .where(
        and(
          eq(schema.reviews.listingId, id),
          eq(schema.reviews.authorRole, "guest"),
          isNotNull(schema.reviews.publishedAt),
        ),
      )
      .orderBy(desc(schema.reviews.createdAt))
      .limit(50);

    const count = reviewRows.length;
    const histogram: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
    const dimSums: Record<string, { s: number; n: number }> = {};
    let overallSum = 0;
    for (const { review } of reviewRows) {
      const scores = review.scores as Record<string, number>;
      const overall = overallOf(scores);
      overallSum += overall;
      histogram[String(Math.min(5, Math.max(1, Math.round(overall))))]!++;
      for (const [k, v] of Object.entries(scores)) {
        dimSums[k] = { s: (dimSums[k]?.s ?? 0) + v, n: (dimSums[k]?.n ?? 0) + 1 };
      }
    }
    // §8.8: the guest aggregate only becomes the headline at >= 3 reviews.
    const guestAggregate = count >= 3 ? Number((overallSum / count).toFixed(1)) : null;
    const dimensions =
      count >= 3
        ? Object.fromEntries(
            Object.entries(dimSums).map(([k, { s, n }]) => [k, Number((s / n).toFixed(1))]),
          )
        : null;

    // ---- dispute record (counts + outcomes only)
    const [deliveredRow] = await db
      .select({ n: sql<string>`count(*)` })
      .from(schema.bookings)
      .where(
        and(eq(schema.bookings.listingId, id), inArray(schema.bookings.state, DELIVERED_STATES)),
      );
    const deliveredBookings = Number(deliveredRow?.n ?? 0);

    const disputeRows = await db
      .select({
        status: schema.disputes.status,
        remedy: schema.disputes.remedy,
        createdAt: schema.disputes.createdAt,
        resolvedAt: schema.disputes.resolvedAt,
        dueAt: schema.disputes.dueAt,
      })
      .from(schema.disputes)
      .innerJoin(schema.bookings, eq(schema.disputes.bookingId, schema.bookings.id))
      .where(eq(schema.bookings.listingId, id));

    const resolved = disputeRows.filter((d) => d.status === "resolved");
    const resolutionHours = resolved
      .filter((d) => d.resolvedAt)
      .map((d) => (d.resolvedAt!.getTime() - d.createdAt.getTime()) / 3600_000);
    resolutionHours.sort((a, b) => a - b);
    const medianHours =
      resolutionHours.length > 0
        ? Math.round(resolutionHours[Math.floor(resolutionHours.length / 2)]!)
        : null;
    const remedyCounts: Record<string, number> = {};
    for (const d of resolved) {
      const key = d.remedy ?? "none";
      remedyCounts[key] = (remedyCounts[key] ?? 0) + 1;
    }

    // ---- can the caller write a review?
    let canReview: { eligible: boolean; bookingCode?: string; reason?: string } = {
      eligible: false,
      reason: "sign_in",
    };
    const auth = req.headers.authorization;
    let viewerId: string | undefined;
    if (auth?.startsWith("Bearer ")) {
      try {
        viewerId = (await verifyAccessToken(auth.slice(7))).sub;
      } catch {
        /* anonymous */
      }
    }
    if (viewerId) {
      const [eligible] = await db
        .select({ id: schema.bookings.id, code: schema.bookings.code })
        .from(schema.bookings)
        .leftJoin(
          schema.reviews,
          and(
            eq(schema.reviews.bookingId, schema.bookings.id),
            eq(schema.reviews.authorRole, "guest"),
          ),
        )
        .where(
          and(
            eq(schema.bookings.listingId, id),
            eq(schema.bookings.guestId, viewerId),
            inArray(schema.bookings.state, ["completed", "reviewed"]),
            sql`${schema.reviews.id} is null`,
          ),
        )
        .limit(1);
      canReview = eligible
        ? { eligible: true, bookingCode: eligible.code }
        : { eligible: false, reason: "no_completed_stay" };
    }

    return reply.send({
      rating: {
        value: guestAggregate,
        count,
        histogram,
        dimensions,
        // Until 3 real reviews exist the listing shows the Ciao inspection score;
        // the client already has it from the listing payload.
        source: guestAggregate != null ? "guests" : "ciao",
      },
      reviews: reviewRows.slice(0, 12).map(({ review, author }) => ({
        id: review.id,
        author: publicAuthor(author ?? undefined),
        overall: Number(overallOf(review.scores as Record<string, number>).toFixed(1)),
        scores: review.scores,
        text: review.text,
        hostReply: review.hostReply,
        at: review.publishedAt ?? review.createdAt,
      })),
      disputes: {
        deliveredBookings,
        opened: disputeRows.length,
        resolved: resolved.length,
        open: disputeRows.filter((d) => d.status !== "resolved").length,
        resolvedWithinSla: resolved.filter((d) => d.resolvedAt && d.resolvedAt <= d.dueAt).length,
        medianHours,
        remedies: remedyCounts,
      },
      canReview,
    });
  });

  /**
   * Open a dispute (guest or host). The state machine owns the transition;
   * ops adjudicate within 48h (§11.6). Statements stay private forever.
   */
  app.post("/v1/bookings/:id/disputes", async (req, reply) => {
    const claims = await authenticate(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        category: z.enum([
          "misrepresentation",
          "double_booking",
          "no_show",
          "cash_mismatch",
          "other",
        ]),
        statement: z.string().min(10).max(3000),
      })
      .parse(req.body);

    const [b] = await db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, id))
      .limit(1);
    if (!b) throw new CiaoError("BOOKING_NOT_FOUND");
    if (b.guestId !== claims.sub && b.hostId !== claims.sub && claims.role === "guest")
      throw new CiaoError("AUTH_FORBIDDEN");

    const [existing] = await db
      .select({ id: schema.disputes.id })
      .from(schema.disputes)
      .where(eq(schema.disputes.bookingId, id))
      .limit(1);
    if (existing) throw new CiaoError("VALIDATION", "dispute_already_open");

    const [dispute] = await db
      .insert(schema.disputes)
      .values({
        bookingId: id,
        openedById: claims.sub,
        category: body.category,
        statement: body.statement,
        status: "open",
        dueAt: new Date(Date.now() + 48 * 3600 * 1000), // §11.6 SLA
      })
      .returning();

    const { transition } = await import("../bookings/machine.js");
    await transition({
      bookingId: id,
      to: "disputed",
      actor: b.guestId === claims.sub ? "guest" : "host",
      actorId: claims.sub,
      reason: body.category,
      idempotencyKey: `dispute:${dispute!.id}`,
    });

    track(
      "dispute.opened",
      { bookingId: id, listingId: b.listingId, category: body.category },
      { userId: claims.sub },
    );

    return reply.status(201).send({
      ok: true,
      disputeId: dispute!.id,
      dueAt: dispute!.dueAt,
      message:
        "استلمنا شكواك. فريق تشاو سيتواصل معك خلال ٤٨ ساعة كحد أقصى، ولن يُنشر نص شكواك للعامة.",
    });
  });

  /** The guest's own dispute view (private detail — only the parties + ops). */
  app.get("/v1/bookings/:id/dispute", async (req, reply) => {
    const claims = await authenticate(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [b] = await db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, id))
      .limit(1);
    if (!b) throw new CiaoError("BOOKING_NOT_FOUND");
    if (b.guestId !== claims.sub && b.hostId !== claims.sub && claims.role === "guest")
      throw new CiaoError("AUTH_FORBIDDEN");
    const [d] = await db
      .select()
      .from(schema.disputes)
      .where(eq(schema.disputes.bookingId, id))
      .limit(1);
    return reply.send({ dispute: d ?? null });
  });
}
