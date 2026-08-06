/**
 * "Tell me when it frees up."
 *
 * Until now a fully-booked unit simply disappeared from a dated search. That
 * threw away two things at once: the scarcity that sells the units still
 * available — Lancaster prints *Sold out* beside its VVIP duplex and leaves it
 * on the sheet on purpose — and the single cleanest demand signal a
 * marketplace can collect, which is a named person who wanted a specific place
 * on a specific date and could not have it.
 *
 * It is also the only honest thing to say to a family whose dates are gone.
 * Not a shrug and six alternatives, but a promise to ring them.
 *
 * The phone is confirmed by code for the same reason the partner-lead form
 * confirms it: an unverified queue is a queue the team stops working, and the
 * whole value of this list is that someone will actually call it.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { isValidPhoneInput, normalizePhone } from "@ciao/shared";
import { db, schema } from "../../db/client.js";
import { CiaoError } from "../../lib/errors.js";
import { consumeOtp } from "../auth/routes.js";
import { track } from "../intelligence/events.js";
import { authenticate } from "../../lib/guards.js";
import { bizGuard } from "../business/guards.js";

const phoneSchema = z
  .string()
  .refine(isValidPhoneInput, "invalid phone")
  .transform(normalizePhone);

export async function waitlistRoutes(app: FastifyInstance) {
  /**
   * Join the list. Public, code-confirmed, one live row per person per unit.
   *
   * A signed-in member skips the code — they proved the number when they
   * joined, and asking a returning guest to re-verify a number we already
   * hold is friction with nothing behind it.
   */
  app.post("/v1/waitlist", {
    config: { rateLimit: { max: 10, timeWindow: "10 minutes" } },
    handler: async (req, reply) => {
      const body = z
        .object({
          listingId: z.string().uuid(),
          phone: phoneSchema,
          code: z.string().length(6).optional(),
          checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          guests: z.number().int().min(1).max(60).optional(),
        })
        .parse(req.body);

      let userId: string | null = null;
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        try {
          userId = (await authenticate(req, "app")).sub;
        } catch {
          userId = null;
        }
      }

      if (!userId) {
        if (!body.code) throw new CiaoError("AUTH_OTP_INVALID");
        await consumeOtp(body.phone, body.code);
      }

      const [listing] = await db
        .select({ id: schema.listings.id, venueId: schema.listings.venueId })
        .from(schema.listings)
        .where(eq(schema.listings.id, body.listingId))
        .limit(1);
      if (!listing) throw new CiaoError("VALIDATION", "listing_not_found");

      await db
        .insert(schema.waitlist)
        .values({
          listingId: listing.id,
          userId,
          phone: body.phone,
          checkIn: body.checkIn ?? null,
          checkOut: body.checkOut ?? null,
          guests: body.guests ?? null,
        })
        .onConflictDoUpdate({
          target: [schema.waitlist.listingId, schema.waitlist.phone, schema.waitlist.checkIn],
          set: { status: "waiting", checkOut: body.checkOut ?? null, guests: body.guests ?? null },
        });

      /*
       * The shape of the unmet demand, never who wanted it. Which unit and how
       * far ahead is what tells us where supply is short; the number belongs in
       * the table under RBAC and nowhere else (intelligence guardrail 2).
       */
      track(
        "waitlist.joined",
        {
          listingId: listing.id,
          leadDays: body.checkIn
            ? Math.max(
                0,
                Math.round(
                  (new Date(`${body.checkIn}T00:00:00Z`).getTime() - Date.now()) / 86_400_000,
                ),
              )
            : null,
          guests: body.guests ?? null,
        },
        { source: "api", ...(userId ? { userId } : {}) },
      );

      return reply.status(201).send({ ok: true });
    },
  });

  /**
   * What people wanted and could not have — ops' side of the same list.
   *
   * `catalogue`-capable, because unmet demand is a supply fact before it is
   * anything else: it says which venue to sign next and which owner to ring
   * about opening more dates.
   */
  app.get("/v1/biz/waitlist", async (req, reply) => {
    await bizGuard(req, "catalogue");
    const q = z
      .object({ status: z.enum(["waiting", "notified", "converted", "cancelled"]).optional() })
      .parse(req.query ?? {});

    const rows = await db
      .select({
        id: schema.waitlist.id,
        phone: schema.waitlist.phone,
        checkIn: schema.waitlist.checkIn,
        checkOut: schema.waitlist.checkOut,
        guests: schema.waitlist.guests,
        status: schema.waitlist.status,
        createdAt: schema.waitlist.createdAt,
        listingId: schema.waitlist.listingId,
        titleAr: schema.listings.titleAr,
        venueNameAr: schema.venues.nameAr,
        city: schema.venues.city,
      })
      .from(schema.waitlist)
      .leftJoin(schema.listings, eq(schema.listings.id, schema.waitlist.listingId))
      .leftJoin(schema.venues, eq(schema.venues.id, schema.listings.venueId))
      .where(q.status ? eq(schema.waitlist.status, q.status) : undefined)
      .limit(300);

    return reply.send({ items: rows });
  });

  app.patch("/v1/biz/waitlist/:id", async (req, reply) => {
    const ctx = await bizGuard(req, "catalogue");
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({ status: z.enum(["waiting", "notified", "converted", "cancelled"]) })
      .parse(req.body);

    await db
      .update(schema.waitlist)
      .set({
        status: body.status,
        ...(body.status === "notified" ? { notifiedAt: new Date() } : {}),
      })
      .where(eq(schema.waitlist.id, id));

    await db.insert(schema.auditLog).values({
      actorId: ctx.sub,
      action: "waitlist.updated",
      targetType: "waitlist",
      targetId: id,
      detail: { status: body.status },
    });
    track("waitlist.status_changed", { status: body.status }, { source: "ops" });
    return reply.send({ ok: true });
  });
}
