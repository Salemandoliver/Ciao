import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { BOOKING_STATES, normalizePhone, type BookingState } from "@ciao/shared";
import { db, schema } from "../../db/client.js";
import { authenticate, requireRole } from "../../lib/guards.js";
import { CiaoError } from "../../lib/errors.js";
import { transition } from "../bookings/machine.js";
import * as bookingSvc from "../bookings/service.js";
import * as calendarSvc from "../calendar/service.js";
import * as ledger from "../payments/ledger.js";
import { markRail } from "../payments/registry.js";
import { receiptNo } from "../../lib/ids.js";

/**
 * Ops console API — §8.1(4): bookings ledger, state overrides, disputes,
 * refunds, host reliability, content moderation, rail health.
 * Every action lands in audit_log (§13.8).
 */
export async function opsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (req) => {
    // All /v1/ops/* and venue/listing management requires ops (agents get a
    // subset registered elsewhere).
    if (req.routeOptions.url?.startsWith("/v1/ops")) {
      const claims = await authenticate(req);
      requireRole(claims, "ops");
    }
  });

  async function audit(actorId: string, action: string, targetType: string, targetId: string, detail?: object) {
    await db.insert(schema.auditLog).values({ actorId, action, targetType, targetId, detail });
  }

  // ---------------- venues & listings management (Phase A supply pipeline)
  app.post("/v1/ops/venues", async (req, reply) => {
    const body = z
      .object({
        type: z.enum(["coast", "hall"]),
        nameAr: z.string(),
        nameEn: z.string().optional(),
        city: z.string(),
        area: z.string().optional(),
        hostPhone: z.string(),
        hostDisplayName: z.string().optional(),
        addressAr: z.string().optional(),
        approxLat: z.string().optional(),
        approxLng: z.string().optional(),
        capacityWomens: z.number().optional(),
        capacityMens: z.number().optional(),
        foundingHost: z.boolean().optional(),
      })
      .parse(req.body);

    // Find-or-create host user by phone.
    const phone = normalizePhone(body.hostPhone);
    let [host] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.phone, phone))
      .limit(1);
    if (!host) {
      [host] = await db
        .insert(schema.users)
        .values({ phone, role: "host", displayName: body.hostDisplayName })
        .returning();
    } else if (host.role === "guest") {
      await db.update(schema.users).set({ role: "host" }).where(eq(schema.users.id, host.id));
    }

    const [venue] = await db
      .insert(schema.venues)
      .values({ ...body, hostId: host!.id })
      .returning();
    await audit(req.session!.sub, "venue.create", "venue", venue!.id);
    return reply.status(201).send(venue);
  });

  app.post("/v1/ops/listings", async (req, reply) => {
    const body = z
      .object({
        venueId: z.string().uuid(),
        slug: z.string().regex(/^[a-z0-9-]+$/),
        titleAr: z.string(),
        titleEn: z.string().optional(),
        descriptionAr: z.string().optional(),
        baseNightly: z.number().int().positive(),
        weekendMultiplierBps: z.number().int().default(12500),
        thursdayMultiplierBps: z.number().int().default(11500),
        seasonMultiplierBps: z.number().int().default(10000),
        dayUsePrice: z.number().int().optional(),
        maxGuests: z.number().int().optional(),
        bedrooms: z.number().int().optional(),
        cancellationTier: z.enum(["flexible", "moderate", "strict"]).default("moderate"),
        familyOnly: z.boolean().default(false),
        bookingTypes: z.array(z.enum(["stay", "day_use", "event_date", "visit"])).default(["stay"]),
        media: z.array(z.object({ url: z.string(), kind: z.string(), order: z.number() })).default([]),
        houseRulesAr: z.string().optional(),
      })
      .parse(req.body);
    const [listing] = await db.insert(schema.listings).values(body).returning();
    await audit(req.session!.sub, "listing.create", "listing", listing!.id);
    return reply.status(201).send(listing);
  });

  app.post("/v1/ops/listings/:id/status", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({ status: z.enum(["draft", "live", "paused", "delisted"]) })
      .parse(req.body);
    await db
      .update(schema.listings)
      .set({ status: body.status, updatedAt: new Date() })
      .where(eq(schema.listings.id, id));
    await audit(req.session!.sub, "listing.status", "listing", id, body);
    return reply.send({ ok: true });
  });

  // ---------------- bookings ledger & overrides
  app.get("/v1/ops/bookings", async (req, reply) => {
    const q = z
      .object({
        state: z.enum(BOOKING_STATES).optional(),
        limit: z.coerce.number().max(200).default(50),
      })
      .parse(req.query);
    const rows = await db
      .select()
      .from(schema.bookings)
      .where(q.state ? eq(schema.bookings.state, q.state) : undefined)
      .orderBy(desc(schema.bookings.createdAt))
      .limit(q.limit);
    return reply.send({ items: rows });
  });

  /** State override with full journal trail — ops powers (§5.3). */
  app.post("/v1/ops/bookings/:id/transition", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({ to: z.enum(BOOKING_STATES), reason: z.string().min(3) })
      .parse(req.body);
    const result = await transition({
      bookingId: id,
      to: body.to as BookingState,
      actor: "ops",
      actorId: req.session!.sub,
      reason: body.reason,
      idempotencyKey: `ops:${id}:${body.to}:${Date.now()}`,
    });
    await audit(req.session!.sub, "booking.override", "booking", id, body);
    return reply.send({ ok: true, state: result.booking.state });
  });

  /** Concierge booking intake (Phase A §17.2): ops records a manual booking. */
  app.post("/v1/ops/bookings/concierge", async (req, reply) => {
    const body = z
      .object({
        listingId: z.string().uuid(),
        guestPhone: z.string(),
        guestName: z.string().optional(),
        checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        rail: z.enum(["sadad", "adfali", "local_card", "tlync", "mpgs"]).default("local_card"),
      })
      .parse(req.body);
    const phone = normalizePhone(body.guestPhone);
    let [guest] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.phone, phone))
      .limit(1);
    if (!guest) {
      [guest] = await db
        .insert(schema.users)
        .values({ phone, role: "guest", displayName: body.guestName })
        .returning();
    }
    const r = await bookingSvc.createStayRequest({
      listingId: body.listingId,
      guestId: guest!.id,
      checkIn: body.checkIn,
      checkOut: body.checkOut,
      rail: body.rail,
      concierge: true,
    });
    await audit(req.session!.sub, "booking.concierge_create", "booking", r.booking.id);
    return reply.status(201).send({
      bookingId: r.booking.id,
      code: r.booking.code,
      payment: r.intent, // ops sends the pay-by-link over WhatsApp
    });
  });

  /** Refund issuance via ladder (§10.6). */
  app.post("/v1/ops/bookings/:id/refund", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        fraction: z.number().min(0).max(1),
        method: z.enum(["credit", "rail_refund", "bank_transfer"]).default("credit"),
        reason: z.string().min(3),
      })
      .parse(req.body);
    const [b] = await db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, id))
      .limit(1);
    if (!b) throw new CiaoError("BOOKING_NOT_FOUND");
    await bookingSvc.refundDeposit(b, body.reason, body.fraction, body.method);
    await audit(req.session!.sub, "booking.refund", "booking", id, body);
    return reply.send({ ok: true });
  });

  /** Logged-cash receipt (§10.6): staged wedding payments / arrival balances. */
  app.post("/v1/ops/bookings/:id/cash-receipt", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        amount: z.number().int().positive(),
        purpose: z.enum(["arrival_balance", "stage_payment"]),
      })
      .parse(req.body);
    const [receipt] = await db
      .insert(schema.loggedCashReceipts)
      .values({ receiptNo: receiptNo(), bookingId: id, ...body })
      .returning();
    return reply.status(201).send(receipt);
  });

  // ---------------- disputes (§11.6)
  app.post("/v1/ops/disputes/:id/resolve", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        resolution: z.string().min(3),
        remedy: z.enum(["partial_refund", "full_refund_relocation", "credit", "strike", "none"]),
      })
      .parse(req.body);
    const [d] = await db
      .select()
      .from(schema.disputes)
      .where(eq(schema.disputes.id, id))
      .limit(1);
    if (!d) throw new CiaoError("BOOKING_NOT_FOUND");
    await db
      .update(schema.disputes)
      .set({ status: "resolved", resolution: body.resolution, remedy: body.remedy, resolvedAt: new Date() })
      .where(eq(schema.disputes.id, id));
    await transition({
      bookingId: d.bookingId,
      to: "resolved",
      actor: "ops",
      actorId: req.session!.sub,
      reason: body.resolution,
      expectedFrom: ["disputed", "no_show"],
      idempotencyKey: `resolve:${id}`,
    });
    await audit(req.session!.sub, "dispute.resolve", "dispute", id, body);
    return reply.send({ ok: true });
  });

  // ---------------- rails & reconciliation
  app.get("/v1/ops/rails", async (_req, reply) => {
    const rows = await db.select().from(schema.railHealth);
    return reply.send({ items: rows });
  });

  app.post("/v1/ops/rails/:rail", async (req, reply) => {
    const { rail } = z.object({ rail: z.string() }).parse(req.params);
    const body = z.object({ healthy: z.boolean(), note: z.string().optional() }).parse(req.body);
    await markRail(rail as never, body.healthy, body.note);
    await audit(req.session!.sub, "rail.mark", "rail", rail, body);
    return reply.send({ ok: true });
  });

  /** Daily reconciliation snapshot (§10.4): ledger balances + invariants. */
  app.get("/v1/ops/reconciliation", async (_req, reply) => {
    const accounts = await db
      .select({
        account: schema.ledgerEntries.account,
        balance: sql<string>`sum(${schema.ledgerEntries.credit} - ${schema.ledgerEntries.debit})`,
      })
      .from(schema.ledgerEntries)
      .groupBy(schema.ledgerEntries.account);
    const [unbalanced] = await db
      .select({ count: sql<string>`count(*)` })
      .from(
        sql`(select tx_id from ledger_entries group by tx_id having sum(debit) <> sum(credit)) t`,
      );
    return reply.send({
      accounts: accounts.map((a) => ({ account: a.account, balance: Number(a.balance) })),
      unbalancedTransactions: Number(unbalanced?.count ?? 0),
    });
  });

  // ---------------- calendar management for ops/host support
  app.post("/v1/ops/listings/:id/block", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({ days: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)), session: z.string().default("night") })
      .parse(req.body);
    await calendarSvc.blockDays(id, body.days, body.session);
    await audit(req.session!.sub, "calendar.block", "listing", id, body);
    return reply.send({ ok: true });
  });

  app.get("/v1/ops/ledger/:account", async (req, reply) => {
    const { account } = z.object({ account: z.string() }).parse(req.params);
    return reply.send({ account, balance: await ledger.balance(account) });
  });
}
