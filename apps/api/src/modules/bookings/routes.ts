import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../../db/client.js";
import { CiaoError } from "../../lib/errors.js";
import { authenticate, requireRole } from "../../lib/guards.js";
import { consumeActionToken } from "../../lib/auth.js";
import { withIdempotency } from "../../lib/idempotency.js";
import { maskContacts } from "../../lib/masking.js";
import * as svc from "./service.js";
import { track } from "../intelligence/events.js";

export async function bookingRoutes(app: FastifyInstance) {
  // Create a stay booking request + deposit intent (§6.1 steps 3–4).
  app.post("/v1/bookings", async (req, reply) => {
    const claims = await authenticate(req);
    const body = z
      .object({
        listingId: z.string().uuid(),
        checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        guestCount: z.number().int().positive().optional(),
        rail: z.enum(["sadad", "adfali", "local_card", "tlync", "mpgs"]),
        sadad: z.object({ mobile: z.string(), birthYear: z.string() }).optional(),
      })
      .refine((b) => b.checkOut > b.checkIn, { message: "checkOut must be after checkIn" })
      .parse(req.body);

    const idemKey = req.headers["idempotency-key"] as string | undefined;
    const result = await withIdempotency(idemKey, body, async () => {
      const r = await svc.createStayRequest({ ...body, guestId: claims.sub });
      return {
        status: 201,
        body: {
          bookingId: r.booking.id,
          code: r.booking.code,
          state: r.booking.state,
          quote: {
            total: r.quote.total,
            deposit: r.quote.deposit,
            balanceOnArrival: r.quote.balanceOnArrival,
          },
          payment: r.intent,
        },
      };
    });
    return reply.status(result.status).send(result.body);
  });

  // Booking detail by code — address/host phone only post-deposit (§7.1).
  app.get("/v1/bookings/:code", async (req, reply) => {
    const claims = await authenticate(req);
    const { code } = z.object({ code: z.string() }).parse(req.params);
    const [b] = await db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.code, code))
      .limit(1);
    if (!b) throw new CiaoError("BOOKING_NOT_FOUND");
    const isParty =
      b.guestId === claims.sub || b.hostId === claims.sub || claims.role !== "guest";
    if (!isParty) throw new CiaoError("AUTH_FORBIDDEN");

    const [venue] = await db
      .select()
      .from(schema.venues)
      .where(eq(schema.venues.id, b.venueId))
      .limit(1);
    const [listing] = await db
      .select()
      .from(schema.listings)
      .where(eq(schema.listings.id, b.listingId))
      .limit(1);
    const [host] = b.hostId
      ? await db.select().from(schema.users).where(eq(schema.users.id, b.hostId)).limit(1)
      : [undefined];

    const events = await db
      .select()
      .from(schema.bookingEvents)
      .where(eq(schema.bookingEvents.bookingId, b.id))
      .orderBy(schema.bookingEvents.seq);

    return reply.send({
      id: b.id,
      code: b.code,
      state: b.state,
      type: b.type,
      checkIn: b.checkIn,
      checkOut: b.checkOut,
      totalAmount: b.totalAmount,
      depositAmount: b.depositAmount,
      balanceOnArrival: b.balanceOnArrival,
      cancellationTier: b.cancellationTier,
      confirmationDeadline: b.confirmationDeadline,
      listing: listing
        ? { slug: listing.slug, titleAr: listing.titleAr, media: listing.media }
        : null,
      venue: venue
        ? {
            nameAr: venue.nameAr,
            city: venue.city,
            area: venue.area,
            // Voucher data — revealed post-deposit only (§6.1 step 5)
            ...(b.contactRevealed
              ? {
                  addressAr: venue.addressAr,
                  exactLocation: { lat: venue.exactLat, lng: venue.exactLng },
                  hostPhone: host?.phone,
                }
              : {}),
          }
        : null,
      timeline: events.map((e) => ({
        seq: e.seq,
        to: e.toState,
        actor: e.actor,
        at: e.createdAt,
      })),
    });
  });

  app.get("/v1/my/bookings", async (req, reply) => {
    const claims = await authenticate(req);
    const rows = await db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.guestId, claims.sub))
      .orderBy(desc(schema.bookings.createdAt))
      .limit(50);
    return reply.send({
      items: rows.map((b) => ({
        code: b.code,
        state: b.state,
        checkIn: b.checkIn,
        checkOut: b.checkOut,
        depositAmount: b.depositAmount,
        balanceOnArrival: b.balanceOnArrival,
      })),
    });
  });

  // Host confirm/decline via signed one-tap action token — no login (§9.4, §12.4).
  app.post("/v1/actions/host-response", async (req, reply) => {
    const body = z
      .object({ token: z.string(), decision: z.enum(["confirm", "decline"]) })
      .parse(req.body);
    const { scope, userId } = await consumeActionToken(body.token, "host_confirm:");
    const bookingId = scope.split(":")[1]!;
    const booking =
      body.decision === "confirm"
        ? await svc.hostConfirm(bookingId, userId)
        : await svc.hostDecline(bookingId, userId, "declined_via_link");
    return reply.send({ ok: true, state: booking.state, code: booking.code });
  });

  // Authenticated host confirm/decline (host PWA path).
  app.post("/v1/bookings/:id/host-response", async (req, reply) => {
    const claims = await authenticate(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ decision: z.enum(["confirm", "decline"]) }).parse(req.body);
    const [b] = await db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, id))
      .limit(1);
    if (!b) throw new CiaoError("BOOKING_NOT_FOUND");
    if (b.hostId !== claims.sub && claims.role === "guest")
      throw new CiaoError("AUTH_FORBIDDEN");
    const booking =
      body.decision === "confirm"
        ? await svc.hostConfirm(id, claims.sub)
        : await svc.hostDecline(id, claims.sub);
    return reply.send({ ok: true, state: booking.state });
  });

  app.post("/v1/bookings/:id/cancel", async (req, reply) => {
    const claims = await authenticate(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const result = await svc.guestCancel(id, claims.sub);
    return reply.send({
      ok: true,
      state: result.booking.state,
      refundFraction: result.refundFraction,
    });
  });

  app.post("/v1/bookings/:id/checkin", async (req, reply) => {
    const claims = await authenticate(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [b] = await db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, id))
      .limit(1);
    if (!b) throw new CiaoError("BOOKING_NOT_FOUND");
    const isHost = b.hostId === claims.sub;
    if (!isHost) requireRole(claims, "ops");
    const r = await svc.checkIn(id, isHost ? "host" : "ops", claims.sub);
    if (r.applied) track("booking.checked_in", { bookingId: id }, { userId: b.guestId });
    return reply.send({ ok: true, state: r.booking.state });
  });

  app.post("/v1/bookings/:id/no-show", async (req, reply) => {
    const claims = await authenticate(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [b] = await db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, id))
      .limit(1);
    if (!b) throw new CiaoError("BOOKING_NOT_FOUND");
    if (b.hostId !== claims.sub) requireRole(claims, "ops");
    // Attestation only valid T+24h after missed check-in (§10.6).
    if (b.checkIn) {
      const gate = new Date(`${b.checkIn}T14:00:00Z`).getTime() + 24 * 3600 * 1000;
      if (Date.now() < gate) throw new CiaoError("BOOKING_ILLEGAL_TRANSITION", "no_show_gate");
    }
    const booking = await svc.markNoShow(id, claims.sub);
    return reply.send({ ok: true, state: booking.state });
  });

  // In-app chat with pre-deposit contact masking (§8.7).
  app.post("/v1/bookings/:id/messages", async (req, reply) => {
    const claims = await authenticate(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ text: z.string().min(1).max(2000) }).parse(req.body);
    const [b] = await db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, id))
      .limit(1);
    if (!b) throw new CiaoError("BOOKING_NOT_FOUND");
    if (b.guestId !== claims.sub && b.hostId !== claims.sub)
      throw new CiaoError("AUTH_FORBIDDEN");

    const toUserId = b.guestId === claims.sub ? b.hostId : b.guestId;
    const { masked } = maskContacts(body.text);
    const stored = b.contactRevealed ? body.text : masked;
    const [msg] = await db
      .insert(schema.messages)
      .values({
        bookingId: b.id,
        kind: "chat",
        channel: "inapp",
        fromUserId: claims.sub,
        toUserId,
        body: stored,
        maskedBody: b.contactRevealed ? null : masked,
        deliveryStatus: "sent",
        sentAt: new Date(),
      })
      .returning();
    return reply.send({ id: msg!.id, body: stored, at: msg!.createdAt });
  });

  app.get("/v1/bookings/:id/messages", async (req, reply) => {
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
    const msgs = await db
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.bookingId, id), eq(schema.messages.kind, "chat")))
      .orderBy(schema.messages.createdAt);
    return reply.send({
      items: msgs.map((m) => ({
        id: m.id,
        fromUserId: m.fromUserId,
        body: m.body,
        at: m.createdAt,
      })),
    });
  });

  // Retry payment on a pending/failed booking (§10.8 pay-by-link).
  app.post("/v1/bookings/:id/retry-payment", async (req, reply) => {
    const claims = await authenticate(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        rail: z.enum(["sadad", "adfali", "local_card", "tlync", "mpgs"]),
        sadad: z.object({ mobile: z.string(), birthYear: z.string() }).optional(),
      })
      .parse(req.body);
    const [b] = await db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, id))
      .limit(1);
    if (!b || b.guestId !== claims.sub) throw new CiaoError("BOOKING_NOT_FOUND");
    if (b.state !== "payment_pending" && b.state !== "payment_failed")
      throw new CiaoError("BOOKING_ILLEGAL_TRANSITION");
    if (b.state === "payment_failed") {
      const { transition } = await import("./machine.js");
      await transition({
        bookingId: b.id,
        to: "payment_pending",
        actor: "guest",
        actorId: claims.sub,
        idempotencyKey: `retry:${b.id}:${Date.now()}`,
      });
    }
    const intent = await svc.createDepositIntent(b, body.rail, body.sadad);
    return reply.send({ payment: intent });
  });
}
