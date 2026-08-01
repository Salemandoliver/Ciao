import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../../db/client.js";
import { CiaoError } from "../../lib/errors.js";
import { authenticate } from "../../lib/guards.js";
import { issueCredit } from "../bookings/service.js";
import { track } from "../intelligence/events.js";

/**
 * Reviews — §8.8: double-blind, verified-stay-only, 14-day window.
 * Neither side sees the other's until both submit or the window closes
 * (worker job `review_window_close` publishes singles).
 */
export async function reviewRoutes(app: FastifyInstance) {
  app.post("/v1/bookings/:id/reviews", async (req, reply) => {
    const claims = await authenticate(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        scores: z.record(z.string(), z.number().min(1).max(5)),
        text: z.string().max(3000).optional(),
      })
      .parse(req.body);

    const [b] = await db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, id))
      .limit(1);
    if (!b) throw new CiaoError("BOOKING_NOT_FOUND");
    // Verified stays only (§8.8): booking must be completed/reviewed.
    if (!["completed", "reviewed"].includes(b.state))
      throw new CiaoError("BOOKING_ILLEGAL_TRANSITION", "review_requires_completed_stay");

    const authorRole =
      b.guestId === claims.sub ? "guest" : b.hostId === claims.sub ? "host" : null;
    if (!authorRole) throw new CiaoError("AUTH_FORBIDDEN");

    // 14-day window from completion.
    if (b.completedAt && Date.now() - b.completedAt.getTime() > 14 * 24 * 3600 * 1000)
      throw new CiaoError("BOOKING_ILLEGAL_TRANSITION", "review_window_closed");

    const [review] = await db
      .insert(schema.reviews)
      .values({
        bookingId: b.id,
        listingId: b.listingId,
        authorRole,
        authorId: claims.sub,
        scores: body.scores,
        text: body.text,
      })
      .onConflictDoNothing()
      .returning();
    if (!review) throw new CiaoError("VALIDATION", "already_reviewed");

    // Double-blind publish: if the counterpart already submitted, publish both.
    const counterpart = authorRole === "guest" ? "host" : "guest";
    const [other] = await db
      .select()
      .from(schema.reviews)
      .where(
        and(
          eq(schema.reviews.bookingId, b.id),
          eq(schema.reviews.authorRole, counterpart),
        ),
      )
      .limit(1);
    if (other) {
      const now = new Date();
      await db
        .update(schema.reviews)
        .set({ publishedAt: now })
        .where(eq(schema.reviews.bookingId, b.id));
    }

    // Guest review unlocks small loyalty credit (§6.1 step 8): 10 LYD, plus
    // membership points — the review corpus is the product (§8.8), so it is
    // worth paying for in both currencies.
    if (authorRole === "guest") {
      await issueCredit(claims.sub, 10_000, b.id, "review_loyalty_credit");
      const loyalty = await import("../accounts/loyalty.js");
      await loyalty.awardPoints(claims.sub, "review_written", b.id, "booking");
      const { transition } = await import("../bookings/machine.js");
      await transition({
        bookingId: b.id,
        to: "reviewed",
        actor: "guest",
        actorId: claims.sub,
        expectedFrom: ["completed"],
        idempotencyKey: `reviewed:${b.id}`,
      });
    }

    track("booking.reviewed", { bookingId: b.id, scores: body.scores }, { userId: claims.sub });
    return reply.status(201).send({ ok: true, published: Boolean(other) });
  });

  // Host single reply (§8.8).
  app.post("/v1/reviews/:id/reply", async (req, reply) => {
    const claims = await authenticate(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ text: z.string().min(1).max(1000) }).parse(req.body);
    const [review] = await db
      .select()
      .from(schema.reviews)
      .where(eq(schema.reviews.id, id))
      .limit(1);
    if (!review) throw new CiaoError("BOOKING_NOT_FOUND");
    const [b] = await db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, review.bookingId))
      .limit(1);
    if (b?.hostId !== claims.sub) throw new CiaoError("AUTH_FORBIDDEN");
    if (review.hostReply) throw new CiaoError("VALIDATION", "reply_exists");
    await db
      .update(schema.reviews)
      .set({ hostReply: body.text })
      .where(eq(schema.reviews.id, id));
    return reply.send({ ok: true });
  });
}
