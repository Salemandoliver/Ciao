/**
 * The partner control panel's HTTP surface.
 *
 * Two things are true of every route in this file and worth stating once
 * rather than at each handler:
 *
 * **Authorisation is resolved before anything is read.** Every handler starts
 * with `partnerContext()`, which establishes both which business is being
 * acted on and what the caller may do to it, and then calls `require()` for
 * the capability the route needs. There is no route that reads a row and
 * checks the owner afterwards, because that ordering is where object-level
 * authorisation bugs live.
 *
 * **Premium data is withheld server-side.** The Plus panels are absent from
 * the response when the subscription is not live, not merely hidden by the
 * console. Anything else means the data was already on the wire and the
 * paywall was decoration.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, desc, eq, gte, inArray, lte, ne, or, sql } from "drizzle-orm";
import { JOB_KINDS, JOB_SOURCES, JOB_STATUSES, capabilitiesFor, normalizePhone, plusActive } from "@ciao/shared";
import { db, schema } from "../../db/client.js";
import { CiaoError } from "../../lib/errors.js";
import { authenticate, requireRole } from "../../lib/guards.js";
import { track } from "../intelligence/events.js";
import { getSetting } from "../business/settings.js";
import { blockDays, openDays } from "../calendar/service.js";
import {
  agenda,
  calendarMonth,
  createJob,
  dayLoad,
  ensureProfile,
  getSubscription,
  hasPlus,
  syncBookingsToJobs,
  updateJob,
  upsertClient,
} from "./service.js";
import {
  cancelPendingPayoutAccount,
  earnings,
  payoutAccounts,
  payouts,
  receivables,
  requestPayoutAccountChange,
} from "./money.js";
import {
  acceptQuote,
  createQuote,
  lineItemSchema,
  listQuotes,
  publicQuote,
  recordQuoteView,
  updateQuote,
} from "./quotes.js";
import { partnerInsights } from "./insights.js";
import { partnerContext, partnerListingIds, partnerMemberships } from "./guards.js";
import { runCommand } from "./commands.js";

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeSchema = z.string().regex(/^\d{2}:\d{2}$/);

export async function partnerRoutes(app: FastifyInstance) {
  /** Every route may be called for a team's business via ?partnerId=… */
  const scopeSchema = z.object({ partnerId: z.string().uuid().optional() });

  // ------------------------------------------------------------------ me
  /**
   * Everything the console needs to draw itself: who this partner is, what
   * shape of business, what the caller may do, which businesses they can
   * switch between, and whether Plus is live.
   *
   * One round trip on purpose. The alternative is five, and this screen opens
   * on a 3G connection at a chalet gate (§12.3).
   */
  app.get("/v1/partner/me", async (req, reply) => {
    const q = scopeSchema.parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    const profile = await ensureProfile(ctx.partnerId);
    const memberships = await partnerMemberships(ctx.actorId);
    const sub = await getSubscription(ctx.partnerId);
    const plusEnabled = Boolean(await getSetting("partner.plusEnabled"));

    const listings = await db
      .select({
        id: schema.listings.id,
        slug: schema.listings.slug,
        titleAr: schema.listings.titleAr,
        titleEn: schema.listings.titleEn,
        status: schema.listings.status,
        baseNightly: schema.listings.baseNightly,
        serviceCategory: schema.listings.serviceCategory,
        venueType: schema.venues.type,
        area: schema.venues.area,
        city: schema.venues.city,
        verified: sql<boolean>`(${schema.venues.verifiedAt} is not null and not ${schema.venues.badgeRevoked})`,
      })
      .from(schema.listings)
      .innerJoin(schema.venues, eq(schema.listings.venueId, schema.venues.id))
      .where(eq(schema.venues.hostId, ctx.partnerId));

    // Business names belong to whoever owns the business, so a team member
    // switching between two employers sees the names, never the phone numbers.
    const names = await db
      .select({ id: schema.users.id, name: schema.users.displayName })
      .from(schema.users)
      .where(inArray(schema.users.id, memberships.map((m) => m.partnerId)));
    const nameById = new Map(names.map((n) => [n.id, n.name]));

    return reply.send({
      partnerId: ctx.partnerId,
      role: ctx.role,
      capabilities: capabilitiesFor(ctx.role),
      profile: {
        kind: profile.kind,
        businessNameAr: profile.businessNameAr,
        businessNameEn: profile.businessNameEn,
        workingDays: profile.workingDays,
        workingHours: profile.workingHours,
        noticeHours: profile.noticeHours,
        maxJobsPerDay: profile.maxJobsPerDay,
        travelsToClient: profile.travelsToClient,
        travelFee: profile.travelFee,
        serviceAreas: profile.serviceAreas,
        defaultDepositBps: profile.defaultDepositBps,
        agendaEnabled: profile.agendaEnabled,
        agendaHour: profile.agendaHour,
        onboardedAt: profile.onboardedAt,
      },
      listings,
      businesses: memberships.map((m) => ({
        partnerId: m.partnerId,
        role: m.role,
        nameAr: nameById.get(m.partnerId) ?? null,
        isSelf: m.ownName,
      })),
      plus: {
        enabled: plusEnabled,
        active: plusEnabled && plusActive(sub),
        plan: sub?.plan ?? "free",
        status: sub?.status ?? "none",
        trialEndsAt: sub?.trialEndsAt ?? null,
        currentPeriodEnd: sub?.currentPeriodEnd ?? null,
        priceDirhams: Number(await getSetting("partner.plusPriceDirhams")),
        trialDays: Number(await getSetting("partner.plusTrialDays")),
      },
      directJobsEnabled: Boolean(await getSetting("partner.directJobsEnabled")),
    });
  });

  app.patch("/v1/partner/profile", async (req, reply) => {
    const q = scopeSchema.parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("settings");
    const body = z
      .object({
        businessNameAr: z.string().max(120).nullish(),
        businessNameEn: z.string().max(120).nullish(),
        kind: z.enum(["venue", "hall", "service"]).optional(),
        workingDays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
        workingHours: z.object({ from: timeSchema, to: timeSchema }).nullish(),
        noticeHours: z.number().int().min(0).max(8760).optional(),
        maxJobsPerDay: z.number().int().min(1).max(50).optional(),
        travelsToClient: z.boolean().optional(),
        travelFee: z.number().int().min(0).max(1_000_000_000).optional(),
        serviceAreas: z.array(z.string().max(60)).max(30).optional(),
        defaultDepositBps: z.number().int().min(0).max(10_000).optional(),
        agendaEnabled: z.boolean().optional(),
        agendaHour: z.number().int().min(0).max(23).optional(),
        onboarded: z.boolean().optional(),
      })
      .parse(req.body);

    await ensureProfile(ctx.partnerId);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of [
      "businessNameAr",
      "businessNameEn",
      "kind",
      "workingDays",
      "workingHours",
      "noticeHours",
      "maxJobsPerDay",
      "travelsToClient",
      "travelFee",
      "serviceAreas",
      "defaultDepositBps",
      "agendaEnabled",
      "agendaHour",
    ] as const) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    if (body.onboarded) patch.onboardedAt = new Date();

    const [row] = await db
      .update(schema.partnerProfiles)
      .set(patch)
      .where(eq(schema.partnerProfiles.userId, ctx.partnerId))
      .returning();
    return reply.send({ ok: true, profile: row });
  });

  // ------------------------------------------------------------------ agenda
  app.get("/v1/partner/agenda", async (req, reply) => {
    const q = z
      .object({
        partnerId: z.string().uuid().optional(),
        from: daySchema.optional(),
        days: z.coerce.number().int().min(1).max(14).default(2),
      })
      .parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("diary");
    // Mirroring Ciao bookings on read keeps the diary honest without a webhook
    // on every booking transition — the agenda is opened far more often than
    // bookings change, and a stale diary is the one thing it may never be.
    await syncBookingsToJobs(ctx.partnerId);
    const from = q.from ?? new Date().toISOString().slice(0, 10);
    const days = await agenda(ctx.partnerId, from, q.days);
    /*
     * Staff see the work and the customer's number — they cannot ring a late
     * client without it, and ringing the late client is the job. They do not
     * see what anything is worth.
     */
    if (!ctx.can("money")) {
      for (const d of days) {
        for (const j of d.jobs) {
          j.price = 0;
          j.amountPaid = 0;
          j.balanceDue = 0;
        }
      }
    }
    return reply.send({ from, days });
  });

  // ------------------------------------------------------------------ calendar
  app.get("/v1/partner/calendar", async (req, reply) => {
    const q = z
      .object({
        partnerId: z.string().uuid().optional(),
        month: z.string().regex(/^\d{4}-\d{2}$/),
        listingId: z.string().uuid().optional(),
      })
      .parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("diary");
    if (q.listingId) {
      const owned = await partnerListingIds(ctx.partnerId);
      if (!owned.includes(q.listingId)) throw new CiaoError("AUTH_FORBIDDEN");
    }
    const result = await calendarMonth(ctx.partnerId, q.month, q.listingId);
    return reply.send(result);
  });

  /**
   * Open or close days — the tap-a-day action behind the month grid.
   *
   * The previous host screen asked people to type "2026-08-15, 2026-08-16"
   * into a text box, which is a data-entry task disguised as a calendar and
   * explains a great deal about why host calendars go stale.
   */
  app.post("/v1/partner/calendar", async (req, reply) => {
    const q = scopeSchema.parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("diary");
    const body = z
      .object({
        days: z.array(daySchema).min(1).max(120),
        action: z.enum(["block", "open"]),
        listingId: z.string().uuid().optional(),
        session: z.string().max(16).default("night"),
      })
      .parse(req.body);

    const owned = await partnerListingIds(ctx.partnerId);
    const targets = body.listingId ? [body.listingId] : owned;
    if (body.listingId && !owned.includes(body.listingId)) throw new CiaoError("AUTH_FORBIDDEN");

    // Sold days are refused rather than skipped, and named in the refusal. A
    // partner who believes a day is closed and finds a family at the gate is
    // the exact failure the platform exists to prevent.
    const booked = targets.length
      ? await db
          .select({ day: schema.calendarDays.day })
          .from(schema.calendarDays)
          .where(
            and(
              inArray(schema.calendarDays.listingId, targets),
              inArray(schema.calendarDays.day, body.days),
              eq(schema.calendarDays.state, "booked"),
            ),
          )
      : [];
    const bookedDays = [...new Set(booked.map((b) => b.day))];
    const actionable = body.days.filter((d) => !bookedDays.includes(d));

    for (const listingId of targets) {
      if (actionable.length === 0) break;
      if (body.action === "block") await blockDays(listingId, actionable, body.session);
      else await openDays(listingId, actionable, body.session);
    }

    track(
      "partner.calendar_updated",
      { action: body.action, dayCount: actionable.length, via: "console" },
      { userId: ctx.actorId, source: "api" },
    );
    return reply.send({ ok: true, changed: actionable, refused: bookedDays });
  });

  // ------------------------------------------------------------------ jobs
  app.get("/v1/partner/jobs", async (req, reply) => {
    const q = z
      .object({
        partnerId: z.string().uuid().optional(),
        from: daySchema.optional(),
        to: daySchema.optional(),
        status: z.enum(JOB_STATUSES).optional(),
        clientId: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(100),
      })
      .parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("diary");
    await syncBookingsToJobs(ctx.partnerId);

    const rows = await db
      .select({
        job: schema.partnerJobs,
        clientNameAr: schema.partnerClients.nameAr,
        clientPhone: schema.partnerClients.phone,
        bookingCode: schema.bookings.code,
        bookingState: schema.bookings.state,
        listingTitleAr: schema.listings.titleAr,
      })
      .from(schema.partnerJobs)
      .leftJoin(schema.partnerClients, eq(schema.partnerJobs.clientId, schema.partnerClients.id))
      .leftJoin(schema.bookings, eq(schema.partnerJobs.bookingId, schema.bookings.id))
      .leftJoin(schema.listings, eq(schema.partnerJobs.listingId, schema.listings.id))
      .where(
        and(
          eq(schema.partnerJobs.partnerId, ctx.partnerId),
          q.status ? eq(schema.partnerJobs.status, q.status) : sql`true`,
          q.clientId ? eq(schema.partnerJobs.clientId, q.clientId) : sql`true`,
          q.from ? or(gte(schema.partnerJobs.day, q.from), gte(schema.partnerJobs.endDay, q.from)) : sql`true`,
          q.to ? lte(schema.partnerJobs.day, q.to) : sql`true`,
        ),
      )
      .orderBy(desc(schema.partnerJobs.day))
      .limit(q.limit);

    const money = ctx.can("money");
    return reply.send({
      items: rows.map(({ job, clientNameAr, clientPhone, bookingCode, bookingState, listingTitleAr }) => ({
        id: job.id,
        titleAr: job.titleAr,
        day: job.day,
        endDay: job.endDay,
        session: job.session,
        startTime: job.startTime,
        endTime: job.endTime,
        status: job.status,
        source: job.source,
        kind: job.kind,
        price: money ? job.price : 0,
        amountPaid: money ? job.amountPaid : 0,
        balanceDue: money ? Math.max(0, job.price - job.amountPaid) : 0,
        locationAr: job.locationAr,
        notesAr: job.notesAr,
        blocksCalendar: job.blocksCalendar,
        listingId: job.listingId,
        listingTitleAr,
        clientId: job.clientId,
        clientNameAr,
        clientPhone,
        bookingId: job.bookingId,
        bookingCode,
        bookingState,
        /** Ciao-linked jobs have their dates and money managed by the booking. */
        locked: Boolean(job.bookingId),
      })),
    });
  });

  const jobBodySchema = z.object({
    listingId: z.string().uuid().nullish(),
    clientId: z.string().uuid().nullish(),
    client: z
      .object({ nameAr: z.string().min(1).max(120), phone: z.string().max(24).nullish() })
      .nullish(),
    source: z.enum(JOB_SOURCES).optional(),
    kind: z.enum(JOB_KINDS).optional(),
    titleAr: z.string().min(1).max(160),
    day: daySchema,
    endDay: daySchema.nullish(),
    session: z.string().max(16).optional(),
    startTime: timeSchema.nullish(),
    endTime: timeSchema.nullish(),
    status: z.enum(JOB_STATUSES).optional(),
    price: z.number().int().min(0).max(1_000_000_000).optional(),
    amountPaid: z.number().int().min(0).max(1_000_000_000).optional(),
    locationAr: z.string().max(300).nullish(),
    notesAr: z.string().max(2000).nullish(),
    blocksCalendar: z.boolean().optional(),
  });

  app.post("/v1/partner/jobs", async (req, reply) => {
    const q = scopeSchema.parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("diary");
    if (!(await getSetting("partner.directJobsEnabled"))) {
      throw new CiaoError("AUTH_FORBIDDEN");
    }
    const body = jobBodySchema.parse(req.body);
    if (body.listingId) {
      const owned = await partnerListingIds(ctx.partnerId);
      if (!owned.includes(body.listingId)) throw new CiaoError("AUTH_FORBIDDEN");
    }
    // Ciao is not a party to a direct job and takes nothing from it, so the
    // source may never be set to "ciao" from outside — that value is the
    // platform's own claim about where work came from and it has to stay
    // trustworthy for the source-mix numbers to mean anything.
    const source = body.source === "ciao" ? "direct" : body.source;
    const job = await createJob(ctx.partnerId, ctx.actorId, { ...body, source });
    return reply.status(201).send({ job });
  });

  app.patch("/v1/partner/jobs/:id", async (req, reply) => {
    const q = scopeSchema.parse(req.query);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("diary");
    const body = jobBodySchema.partial().parse(req.body);
    // Staff run the day; they do not restate what it was worth.
    if (!ctx.can("money")) {
      delete body.price;
      delete body.amountPaid;
    }
    const source = body.source === "ciao" ? undefined : body.source;
    const job = await updateJob(ctx.partnerId, ctx.actorId, id, { ...body, source });
    return reply.send({ job });
  });

  /**
   * Would these days clash?
   *
   * Asked by the console before it lets someone save, so the answer arrives
   * while they can still change the date rather than as a refusal after they
   * have typed everything.
   */
  app.get("/v1/partner/jobs/load", async (req, reply) => {
    const q = z
      .object({
        partnerId: z.string().uuid().optional(),
        days: z.string(),
        excludeJobId: z.string().uuid().optional(),
      })
      .parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("diary");
    const days = q.days.split(",").filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 60);
    const profile = await ensureProfile(ctx.partnerId);
    const counts = await dayLoad(ctx.partnerId, days, q.excludeJobId);
    return reply.send({
      maxJobsPerDay: profile.maxJobsPerDay,
      days: days.map((day) => ({
        day,
        jobs: counts[day] ?? 0,
        full: (counts[day] ?? 0) >= profile.maxJobsPerDay,
      })),
    });
  });

  // ------------------------------------------------------------------ clients
  app.get("/v1/partner/clients", async (req, reply) => {
    const q = z
      .object({ partnerId: z.string().uuid().optional(), search: z.string().max(60).optional() })
      .parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    // The customer book as a whole is not a staff screen. A member of staff can
    // reach the contact details of the job in front of them and no further.
    ctx.require("clients");
    const rows = await db
      .select()
      .from(schema.partnerClients)
      .where(
        and(
          eq(schema.partnerClients.partnerId, ctx.partnerId),
          q.search
            ? or(
                sql`${schema.partnerClients.nameAr} ilike ${"%" + q.search + "%"}`,
                sql`${schema.partnerClients.phone} like ${"%" + q.search + "%"}`,
              )
            : sql`true`,
        ),
      )
      .orderBy(desc(schema.partnerClients.lastJobAt))
      .limit(300);
    return reply.send({
      items: rows.map((r) => ({
        id: r.id,
        nameAr: r.nameAr,
        phone: r.phone,
        notesAr: r.notesAr,
        jobsCount: r.jobsCount,
        totalSpend: ctx.can("money") ? r.totalSpend : 0,
        lastJobAt: r.lastJobAt,
      })),
    });
  });

  app.post("/v1/partner/clients", async (req, reply) => {
    const q = scopeSchema.parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("clients");
    const body = z
      .object({
        id: z.string().uuid().optional(),
        nameAr: z.string().min(1).max(120),
        phone: z.string().max(24).nullish(),
        notesAr: z.string().max(2000).nullish(),
      })
      .parse(req.body);
    const client = await upsertClient(ctx.partnerId, body, ctx.actorId);
    return reply.send({ client });
  });

  // ------------------------------------------------------------------ quotes
  app.get("/v1/partner/quotes", async (req, reply) => {
    const q = z
      .object({ partnerId: z.string().uuid().optional(), status: z.string().max(12).optional() })
      .parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("diary");
    return reply.send({ items: await listQuotes(ctx.partnerId, q.status) });
  });

  const quoteBodySchema = z.object({
    clientId: z.string().uuid().nullish(),
    client: z
      .object({ nameAr: z.string().min(1).max(120), phone: z.string().max(24).nullish() })
      .nullish(),
    listingId: z.string().uuid().nullish(),
    titleAr: z.string().min(1).max(160),
    lineItems: z.array(lineItemSchema).min(1).max(40),
    discount: z.number().int().min(0).max(1_000_000_000).optional(),
    depositBps: z.number().int().min(0).max(10_000).optional(),
    proposedDay: daySchema.nullish(),
    session: z.string().max(16).nullish(),
    startTime: timeSchema.nullish(),
    validUntil: daySchema.nullish(),
    notesAr: z.string().max(2000).nullish(),
    termsAr: z.string().max(2000).nullish(),
  });

  app.post("/v1/partner/quotes", async (req, reply) => {
    const q = scopeSchema.parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("diary");
    const body = quoteBodySchema.parse(req.body);
    const quote = await createQuote(ctx.partnerId, ctx.actorId, body);
    const webBase = (await import("../../config.js")).config.webBaseUrl;
    return reply.status(201).send({ quote, shareUrl: `${webBase}/q/${quote.code}` });
  });

  app.patch("/v1/partner/quotes/:id", async (req, reply) => {
    const q = scopeSchema.parse(req.query);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("diary");
    const body = quoteBodySchema
      .partial()
      .extend({ status: z.enum(["draft", "sent", "withdrawn"]).optional() })
      .parse(req.body);
    const quote = await updateQuote(ctx.partnerId, id, body);
    const webBase = (await import("../../config.js")).config.webBaseUrl;
    return reply.send({ quote, shareUrl: `${webBase}/q/${quote.code}` });
  });

  /**
   * The customer's view of a quote — public, unauthenticated, rate-limited.
   *
   * Unauthenticated because requiring an account here would kill the send, and
   * the send is the entire feature. Rate-limited because a six-character code
   * is guessable given enough attempts, and the thing behind it is a business's
   * pricing.
   */
  app.get("/v1/q/:code", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    handler: async (req, reply) => {
      const { code } = z.object({ code: z.string().max(12) }).parse(req.params);
      const quote = await publicQuote(code);
      await recordQuoteView(code);
      return reply.send({ quote });
    },
  });

  app.post("/v1/q/:code/respond", {
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    handler: async (req, reply) => {
      const { code } = z.object({ code: z.string().max(12) }).parse(req.params);
      const body = z.object({ decision: z.enum(["accept", "decline"]) }).parse(req.body);
      const result = await acceptQuote(code, body.decision);

      if (result.status === "accepted") {
        // Tell the partner immediately. This is the message that changes their
        // day, and it has to arrive before the customer rings to ask whether
        // it arrived.
        const [row] = await db
          .select({
            partnerId: schema.partnerQuotes.partnerId,
            total: schema.partnerQuotes.total,
            proposedDay: schema.partnerQuotes.proposedDay,
            phone: schema.users.phone,
            locale: schema.users.locale,
          })
          .from(schema.partnerQuotes)
          .innerJoin(schema.users, eq(schema.partnerQuotes.partnerId, schema.users.id))
          .where(eq(schema.partnerQuotes.code, code))
          .limit(1);
        if (row) {
          const { notify } = await import("../messaging/service.js");
          const { config } = await import("../../config.js");
          await notify({
            templateKey: "partner_quote_accepted",
            toPhone: row.phone,
            toUserId: row.partnerId,
            locale: row.locale === "en" ? "en" : "ar",
            vars: {
              code,
              total: String(Math.round(row.total / 1000)),
              when: row.proposedDay ? ` — ${row.proposedDay}` : "",
              link: `${config.webBaseUrl}/partner?tab=quotes`,
            },
          }).catch(() => {
            /* the acceptance stands whether or not the notification lands */
          });
        }
      }
      return reply.send(result);
    },
  });

  // ------------------------------------------------------------------ money
  app.get("/v1/partner/money", async (req, reply) => {
    const q = z
      .object({
        partnerId: z.string().uuid().optional(),
        months: z.coerce.number().int().min(1).max(36).default(12),
      })
      .parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("money");
    await syncBookingsToJobs(ctx.partnerId);
    const [earn, pay, owed, accounts] = await Promise.all([
      earnings(ctx.partnerId, q.months),
      payouts(ctx.partnerId),
      receivables(ctx.partnerId),
      payoutAccounts(ctx.partnerId),
    ]);
    return reply.send({
      earnings: earn,
      payouts: pay,
      receivables: owed,
      payoutAccounts: accounts,
      /** Only an owner may move where the money goes. */
      canChangePayoutAccount: ctx.can("admin"),
      payoutHoldHours: Number(await getSetting("partner.payoutChangeHoldHours")),
    });
  });

  app.post("/v1/partner/payout-account", {
    // Deliberately tighter than the global limit: this is the highest-value
    // mutation in the product and there is no legitimate reason to call it
    // more than a handful of times an hour.
    config: { rateLimit: { max: 5, timeWindow: "1 hour" } },
    handler: async (req, reply) => {
      const q = scopeSchema.parse(req.query);
      const ctx = await partnerContext(req, q.partnerId);
      ctx.require("admin");
      const body = z
        .object({
          rail: z.string().max(12),
          label: z.string().max(80).nullish(),
          accountRef: z.string().min(4).max(64),
        })
        .parse(req.body);
      const [user] = await db
        .select({ phone: schema.users.phone, locale: schema.users.locale })
        .from(schema.users)
        .where(eq(schema.users.id, ctx.partnerId))
        .limit(1);
      const row = await requestPayoutAccountChange(ctx.partnerId, ctx.actorId, body, {
        ip: req.ip,
        locale: user?.locale === "en" ? "en" : "ar",
        phone: user?.phone ?? null,
      });
      return reply.send({
        id: row.id,
        status: row.status,
        activatesAt: row.activatesAt,
      });
    },
  });

  app.delete("/v1/partner/payout-account/:id", async (req, reply) => {
    const q = scopeSchema.parse(req.query);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("admin");
    await cancelPendingPayoutAccount(ctx.partnerId, ctx.actorId, id);
    return reply.send({ ok: true });
  });

  // ------------------------------------------------------------------ insights
  app.get("/v1/partner/insights", async (req, reply) => {
    const q = z
      .object({
        partnerId: z.string().uuid().optional(),
        days: z.coerce.number().int().min(7).max(365).default(90),
      })
      .parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    // Their own numbers are a money screen — a member of staff should not be
    // able to read the business's earnings off the insights tab either.
    ctx.require("money");
    await syncBookingsToJobs(ctx.partnerId);
    const insights = await partnerInsights(ctx.partnerId, q.days);
    track(
      "partner.insights_viewed",
      { plus: insights.plus, windowDays: q.days },
      { userId: ctx.actorId, source: "api" },
    );
    return reply.send(insights);
  });

  // ------------------------------------------------------------------ Ciao Plus
  app.post("/v1/partner/plus", async (req, reply) => {
    const q = scopeSchema.parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("admin");
    const body = z.object({ action: z.enum(["start", "cancel"]) }).parse(req.body);

    if (!(await getSetting("partner.plusEnabled"))) throw new CiaoError("AUTH_FORBIDDEN");
    const existing = await getSubscription(ctx.partnerId);

    if (body.action === "cancel") {
      if (!existing) return reply.send({ ok: true, plan: "free" });
      await db
        .update(schema.partnerSubscriptions)
        .set({ status: "cancelled", plan: "free", cancelledAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.partnerSubscriptions.partnerId, ctx.partnerId));
      track(
        "partner.plus_cancelled",
        {
          daysActive: existing.createdAt
            ? Math.round((Date.now() - existing.createdAt.getTime()) / 86_400_000)
            : 0,
        },
        { userId: ctx.actorId, source: "api" },
      );
      return reply.send({ ok: true, plan: "free" });
    }

    const price = Number(await getSetting("partner.plusPriceDirhams"));
    const trialDays = Number(await getSetting("partner.plusTrialDays"));
    /*
     * The free season is once per partner, not once per subscribe. Otherwise
     * cancelling and rejoining is a permanent free tier, and a benefit that
     * only the people who notice the loophole receive is worse than no benefit.
     */
    const alreadyTrialed = Boolean(existing?.trialEndsAt);
    const trialEndsAt = alreadyTrialed
      ? null
      : new Date(Date.now() + trialDays * 86_400_000);

    const values = {
      partnerId: ctx.partnerId,
      plan: "plus" as const,
      status: (trialEndsAt ? "trialing" : "active") as "trialing" | "active",
      trialEndsAt: existing?.trialEndsAt ?? trialEndsAt,
      currentPeriodStart: new Date(),
      currentPeriodEnd: trialEndsAt ?? new Date(Date.now() + 30 * 86_400_000),
      priceDirhams: price,
      settlement: "payout_netting" as const,
      cancelledAt: null,
      updatedAt: new Date(),
    };
    await db
      .insert(schema.partnerSubscriptions)
      .values(values)
      .onConflictDoUpdate({ target: schema.partnerSubscriptions.partnerId, set: values });

    track(
      "partner.plus_started",
      { trial: Boolean(trialEndsAt), priceDirhams: price },
      { userId: ctx.actorId, source: "api" },
    );
    return reply.send({ ok: true, plan: "plus", trialEndsAt: values.trialEndsAt });
  });

  // ------------------------------------------------------------------ team
  app.get("/v1/partner/team", async (req, reply) => {
    const q = scopeSchema.parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("admin");
    const rows = await db
      .select({
        id: schema.partnerTeam.id,
        role: schema.partnerTeam.role,
        disabledAt: schema.partnerTeam.disabledAt,
        lastSeenAt: schema.partnerTeam.lastSeenAt,
        createdAt: schema.partnerTeam.createdAt,
        memberUserId: schema.partnerTeam.memberUserId,
        name: schema.users.displayName,
        phone: schema.users.phone,
      })
      .from(schema.partnerTeam)
      .innerJoin(schema.users, eq(schema.partnerTeam.memberUserId, schema.users.id))
      .where(eq(schema.partnerTeam.partnerId, ctx.partnerId))
      .orderBy(desc(schema.partnerTeam.createdAt));
    return reply.send({ items: rows });
  });

  app.post("/v1/partner/team", async (req, reply) => {
    const q = scopeSchema.parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("admin");
    const body = z
      .object({
        phone: z.string().min(6).max(24),
        role: z.enum(["manager", "staff"]),
        nameAr: z.string().max(120).optional(),
      })
      .parse(req.body);
    const phone = normalizePhone(body.phone);
    if (!/^\+[1-9]\d{8,14}$/.test(phone)) throw new CiaoError("VALIDATION", { field: "phone" });

    /*
     * `owner` is not grantable. It is the account the business hangs off, it
     * controls where the money goes, and a second owner would be a second
     * person who can redirect payouts — which is the attack this whole area is
     * built to resist. Transferring a business is an ops action with a human
     * in it, not a form.
     */
    let [member] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.phone, phone))
      .limit(1);
    if (!member) {
      [member] = await db
        .insert(schema.users)
        .values({ phone, role: "host", displayName: body.nameAr ?? null })
        .returning({ id: schema.users.id });
    }
    if (member!.id === ctx.partnerId) throw new CiaoError("VALIDATION", { field: "phone" });

    const values = {
      partnerId: ctx.partnerId,
      memberUserId: member!.id,
      role: body.role,
      invitedById: ctx.actorId,
      disabledAt: null,
    };
    await db
      .insert(schema.partnerTeam)
      .values(values)
      .onConflictDoUpdate({
        target: [schema.partnerTeam.partnerId, schema.partnerTeam.memberUserId],
        set: { role: body.role, disabledAt: null },
      });

    await db.insert(schema.auditLog).values({
      actorId: ctx.actorId,
      action: "partner.team.added",
      targetType: "partner",
      targetId: ctx.partnerId,
      detail: { role: body.role, memberUserId: member!.id },
    });
    track("partner.team_changed", { action: "added", role: body.role }, { userId: ctx.actorId, source: "api" });
    return reply.status(201).send({ ok: true, memberUserId: member!.id });
  });

  app.delete("/v1/partner/team/:id", async (req, reply) => {
    const q = scopeSchema.parse(req.query);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("admin");
    const [row] = await db
      .select()
      .from(schema.partnerTeam)
      .where(eq(schema.partnerTeam.id, id))
      .limit(1);
    if (!row || row.partnerId !== ctx.partnerId) throw new CiaoError("AUTH_FORBIDDEN");
    await db
      .update(schema.partnerTeam)
      .set({ disabledAt: new Date() })
      .where(eq(schema.partnerTeam.id, id));
    await db.insert(schema.auditLog).values({
      actorId: ctx.actorId,
      action: "partner.team.removed",
      targetType: "partner",
      targetId: ctx.partnerId,
      detail: { memberUserId: row.memberUserId, role: row.role },
    });
    track("partner.team_changed", { action: "removed", role: row.role }, { userId: ctx.actorId, source: "api" });
    return reply.send({ ok: true });
  });

  // ------------------------------------------------------------------ commands
  /**
   * The command box in the console, and the same code path the BSP webhook
   * will call when inbound WhatsApp exists.
   *
   * Exposing it in-app now is not a stopgap — it is how the parser gets
   * exercised against real messages before it is the only interface a partner
   * has, and a date parser that has never seen real input is a date parser
   * that will block the wrong month.
   */
  app.post("/v1/partner/command", async (req, reply) => {
    const q = scopeSchema.parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("diary");
    const body = z.object({ message: z.string().min(1).max(400) }).parse(req.body);
    const result = await runCommand(ctx.partnerId, body.message);
    return reply.send(result);
  });

  // ------------------------------------------------------------------ ops view
  /**
   * The internal view of the partner base, for the business console.
   *
   * Deliberately counts and states only. Ops needs to know how many partners
   * are actually using the diary and how many are on Plus; ops does not need
   * to browse anyone's customer book from here, and a screen that made that
   * easy would get used.
   *
   * Named `partner-panel` rather than `partners` because `/v1/biz/partners` is
   * already the loyalty partners — the cafés that redeem point vouchers. Two
   * different meanings of "partner" live in this product, and the routes have
   * to keep them apart even though the console copy does not.
   */
  app.get("/v1/biz/partner-panel", async (req, reply) => {
    // Console-audience gate like every other /v1/biz route — the panel moved
    // to the standalone business console along with the rest of them.
    const { bizGuard } = await import("../business/guards.js");
    await bizGuard(req, "catalogue");
    const [totals] = await db
      .select({
        profiles: sql<string>`count(*)`,
        onboarded: sql<string>`count(*) filter (where ${schema.partnerProfiles.onboardedAt} is not null)`,
        agendaOn: sql<string>`count(*) filter (where ${schema.partnerProfiles.agendaEnabled})`,
      })
      .from(schema.partnerProfiles);

    const [jobs] = await db
      .select({
        total: sql<string>`count(*)`,
        direct: sql<string>`count(*) filter (where ${schema.partnerJobs.source} <> 'ciao')`,
        value: sql<string>`coalesce(sum(${schema.partnerJobs.price}) filter (where ${schema.partnerJobs.source} <> 'ciao'), 0)`,
      })
      .from(schema.partnerJobs)
      .where(ne(schema.partnerJobs.status, "cancelled"));

    const [subs] = await db
      .select({
        trialing: sql<string>`count(*) filter (where ${schema.partnerSubscriptions.status} = 'trialing')`,
        active: sql<string>`count(*) filter (where ${schema.partnerSubscriptions.status} = 'active')`,
        pastDue: sql<string>`count(*) filter (where ${schema.partnerSubscriptions.status} = 'past_due')`,
        cancelled: sql<string>`count(*) filter (where ${schema.partnerSubscriptions.status} = 'cancelled')`,
      })
      .from(schema.partnerSubscriptions);

    /*
     * The number this whole feature was built to produce: across every
     * partner's own diary, how much of their work came through Ciao. It is
     * allowed to be small, and it is the most honest read on our market
     * position that exists anywhere.
     */
    const sourceMix = await db
      .select({
        source: schema.partnerJobs.source,
        jobs: sql<string>`count(*)`,
      })
      .from(schema.partnerJobs)
      .where(ne(schema.partnerJobs.status, "cancelled"))
      .groupBy(schema.partnerJobs.source)
      .orderBy(desc(sql`count(*)`));

    const [pendingPayouts] = await db
      .select({ pending: sql<string>`count(*)` })
      .from(schema.partnerPayoutAccounts)
      .where(eq(schema.partnerPayoutAccounts.status, "pending"));

    return reply.send({
      profiles: Number(totals?.profiles ?? 0),
      onboarded: Number(totals?.onboarded ?? 0),
      agendaOn: Number(totals?.agendaOn ?? 0),
      jobs: {
        total: Number(jobs?.total ?? 0),
        direct: Number(jobs?.direct ?? 0),
        directValue: Number(jobs?.value ?? 0),
      },
      subscriptions: {
        trialing: Number(subs?.trialing ?? 0),
        active: Number(subs?.active ?? 0),
        pastDue: Number(subs?.pastDue ?? 0),
        cancelled: Number(subs?.cancelled ?? 0),
      },
      sourceMix: sourceMix.map((s) => ({ source: s.source, jobs: Number(s.jobs) })),
      pendingPayoutChanges: Number(pendingPayouts?.pending ?? 0),
    });
  });
}
