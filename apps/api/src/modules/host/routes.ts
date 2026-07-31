import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../../db/client.js";
import { authenticate } from "../../lib/guards.js";
import { CiaoError } from "../../lib/errors.js";
import * as calendarSvc from "../calendar/service.js";

/** Host PWA API — §8.3: calendar, bookings, payout statements. */
export async function hostRoutes(app: FastifyInstance) {
  async function myListingIds(hostId: string): Promise<string[]> {
    const rows = await db
      .select({ id: schema.listings.id })
      .from(schema.listings)
      .innerJoin(schema.venues, eq(schema.listings.venueId, schema.venues.id))
      .where(eq(schema.venues.hostId, hostId));
    return rows.map((r) => r.id);
  }

  app.get("/v1/host/listings", async (req, reply) => {
    const claims = await authenticate(req);
    const rows = await db
      .select({ listing: schema.listings, venue: schema.venues })
      .from(schema.listings)
      .innerJoin(schema.venues, eq(schema.listings.venueId, schema.venues.id))
      .where(eq(schema.venues.hostId, claims.sub));
    return reply.send({
      items: rows.map(({ listing, venue }) => ({
        id: listing.id,
        slug: listing.slug,
        titleAr: listing.titleAr,
        status: listing.status,
        baseNightly: listing.baseNightly,
        verified: Boolean(venue.verifiedAt) && !venue.badgeRevoked,
      })),
    });
  });

  app.get("/v1/host/bookings", async (req, reply) => {
    const claims = await authenticate(req);
    const rows = await db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.hostId, claims.sub))
      .orderBy(desc(schema.bookings.createdAt))
      .limit(100);
    return reply.send({
      items: rows.map((b) => ({
        id: b.id,
        code: b.code,
        state: b.state,
        checkIn: b.checkIn,
        checkOut: b.checkOut,
        depositAmount: b.depositAmount,
        balanceOnArrival: b.balanceOnArrival,
        confirmationDeadline: b.confirmationDeadline,
        // Host sees payout amount, not commission arithmetic (§9.1).
        payoutAmount: b.depositAmount - b.commissionAmount,
      })),
    });
  });

  app.get("/v1/host/payouts", async (req, reply) => {
    const claims = await authenticate(req);
    const rows = await db
      .select()
      .from(schema.payouts)
      .where(eq(schema.payouts.hostId, claims.sub))
      .orderBy(desc(schema.payouts.createdAt))
      .limit(100);
    return reply.send({ items: rows });
  });

  app.get("/v1/host/reliability", async (req, reply) => {
    const claims = await authenticate(req);
    const [row] = await db
      .select()
      .from(schema.reliabilityScores)
      .where(eq(schema.reliabilityScores.hostId, claims.sub))
      .limit(1);
    // Plain-language coaching (§11.4).
    const score = row?.score ?? 50;
    const coaching =
      score >= 80
        ? "ممتاز — استمر في الرد السريع وتحديث التقويم."
        : score >= 60
          ? "جيد — الرد الأسرع على طلبات التأكيد يرفع ترتيبك."
          : "انتبه: فوّت تأكيدات أو ألغيت حجوزات — ترتيبك في البحث انخفض.";
    return reply.send({ score, coaching, detail: row ?? null });
  });

  app.post("/v1/host/listings/:id/block", async (req, reply) => {
    const claims = await authenticate(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const ids = await myListingIds(claims.sub);
    if (!ids.includes(id)) throw new CiaoError("AUTH_FORBIDDEN");
    const body = z
      .object({
        days: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(120),
        action: z.enum(["block", "open"]).default("block"),
      })
      .parse(req.body);
    if (body.action === "block") await calendarSvc.blockDays(id, body.days);
    else await calendarSvc.openDays(id, body.days);
    return reply.send({ ok: true });
  });

  /** Pricing updates — future unbooked dates only; booked dates locked (§9.6). */
  app.post("/v1/host/listings/:id/pricing", async (req, reply) => {
    const claims = await authenticate(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const ids = await myListingIds(claims.sub);
    if (!ids.includes(id)) throw new CiaoError("AUTH_FORBIDDEN");
    const body = z
      .object({
        baseNightly: z.number().int().positive().optional(),
        weekendMultiplierBps: z.number().int().min(10000).max(30000).optional(),
        thursdayMultiplierBps: z.number().int().min(10000).max(30000).optional(),
        upliftBps: z.number().int().min(0).max(5000).optional(), // devaluation-week one-tap uplift
      })
      .parse(req.body);
    const [listing] = await db
      .select()
      .from(schema.listings)
      .where(eq(schema.listings.id, id))
      .limit(1);
    if (!listing) throw new CiaoError("BOOKING_NOT_FOUND");
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.baseNightly) patch.baseNightly = body.baseNightly;
    if (body.weekendMultiplierBps) patch.weekendMultiplierBps = body.weekendMultiplierBps;
    if (body.thursdayMultiplierBps) patch.thursdayMultiplierBps = body.thursdayMultiplierBps;
    if (body.upliftBps) {
      patch.baseNightly = Math.round(
        (listing.baseNightly * (10000 + body.upliftBps)) / 10000,
      );
    }
    await db.update(schema.listings).set(patch).where(eq(schema.listings.id, id));
    return reply.send({ ok: true });
  });

  /** Weekly calendar attestation confirmation (§9.5). */
  app.post("/v1/host/attest-calendar", async (req, reply) => {
    const claims = await authenticate(req);
    const body = z
      .object({
        blocks: z
          .array(
            z.object({
              listingId: z.string().uuid(),
              days: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
            }),
          )
          .default([]),
      })
      .parse(req.body);
    const ids = await myListingIds(claims.sub);
    for (const blk of body.blocks) {
      if (!ids.includes(blk.listingId)) throw new CiaoError("AUTH_FORBIDDEN");
      await calendarSvc.blockDays(blk.listingId, blk.days);
    }
    // Attestation streak rewards ranking (§9.5, §11.4).
    const [row] = await db
      .select()
      .from(schema.reliabilityScores)
      .where(eq(schema.reliabilityScores.hostId, claims.sub))
      .limit(1);
    const next = {
      hostId: claims.sub,
      score: Math.min(100, (row?.score ?? 50) + 1),
      attestationStreakWeeks: (row?.attestationStreakWeeks ?? 0) + 1,
      updatedAt: new Date(),
    };
    await db
      .insert(schema.reliabilityScores)
      .values(next)
      .onConflictDoUpdate({ target: schema.reliabilityScores.hostId, set: next });
    return reply.send({ ok: true, streak: next.attestationStreakWeeks });
  });
}
