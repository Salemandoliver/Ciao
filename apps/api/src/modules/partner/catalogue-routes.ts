/**
 * The catalogue over HTTP — services, add-ons, price rules, offers, intake,
 * costs, and buying a year of Plus.
 *
 * Every route goes through `partnerContext()` and names the capability it
 * needs. That is not ceremony: the difference between `settings` and `money`
 * here is the difference between a receptionist who can add a service and a
 * receptionist who can see what the business earned, and the whole reason the
 * console can be handed to staff at all.
 *
 * Pricing is a POST rather than a GET, which is worth stating because it looks
 * wrong. It takes a selection — a service, quantities, add-ons, a code — that
 * is too structured for a query string, and it has a side effect we want: a
 * priced selection is recorded in the intelligence spine so we can see which
 * catalogues get quoted and which sit untouched.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../../db/client.js";
import { CiaoError } from "../../lib/errors.js";
import { partnerContext } from "./guards.js";
import { track } from "../intelligence/events.js";
import {
  createAddon,
  createExpense,
  createIntake,
  createPriceRule,
  createPromotion,
  createService,
  deleteExpense,
  deletePriceRule,
  listAddons,
  listExpenses,
  listIntake,
  listPriceRules,
  listPromotions,
  listServices,
  priceRequest,
  profitAndLoss,
  reorderServices,
  retireAddon,
  retireIntake,
  retireService,
  updateAddon,
  updateIntake,
  updatePriceRule,
  updatePromotion,
  updateService,
} from "./catalogue.js";
import {
  cancelSubscription,
  planOffer,
  startAnnualCheckout,
  startTrial,
  subscriptionView,
} from "./subscription.js";

const scope = z.object({ partnerId: z.string().uuid().optional() });
const idParam = z.object({ id: z.string().uuid() });

const serviceBody = z.object({
  nameAr: z.string().min(1).max(120),
  nameEn: z.string().max(120).nullish(),
  descriptionAr: z.string().max(2000).nullish(),
  descriptionEn: z.string().max(2000).nullish(),
  unit: z.string().max(8).optional(),
  basePrice: z.number().int().min(0).optional(),
  minUnits: z.number().int().min(1).max(999).optional(),
  maxUnits: z.number().int().min(1).max(999).nullish(),
  durationMinutes: z.number().int().min(0).max(10080).nullish(),
  minGuests: z.number().int().min(0).max(10000).nullish(),
  maxGuests: z.number().int().min(0).max(10000).nullish(),
  noticeHours: z.number().int().min(0).max(8760).nullish(),
  depositBps: z.number().int().min(0).max(10000).nullish(),
  cancellationTier: z.string().max(12).nullish(),
  dailyCapacity: z.number().int().min(0).max(500).nullish(),
  includesAr: z.array(z.string().max(120)).max(20).optional(),
  media: z.array(z.unknown()).max(20).optional(),
  instantBook: z.boolean().optional(),
  published: z.boolean().optional(),
  listingId: z.string().uuid().nullish(),
  sortOrder: z.number().int().optional(),
});

const addonBody = z.object({
  nameAr: z.string().min(1).max(120),
  nameEn: z.string().max(120).nullish(),
  descriptionAr: z.string().max(500).nullish(),
  price: z.number().int().min(0).optional(),
  priceModel: z.string().max(10).optional(),
  maxQty: z.number().int().min(1).max(99).optional(),
  required: z.boolean().optional(),
  serviceId: z.string().uuid().nullish(),
  sortOrder: z.number().int().optional(),
});

const ruleBody = z.object({
  labelAr: z.string().min(1).max(120),
  kind: z.string().max(10),
  serviceId: z.string().uuid().nullish(),
  fromDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  toDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  weekdays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
  minLeadDays: z.number().int().min(0).max(3650).nullish(),
  maxLeadDays: z.number().int().min(0).max(3650).nullish(),
  minUnits: z.number().int().min(1).max(999).nullish(),
  adjustBps: z.number().int().min(1000).max(30000).optional(),
  adjustFlat: z.number().int().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  active: z.boolean().optional(),
});

const promotionBody = z.object({
  labelAr: z.string().min(1).max(120),
  labelEn: z.string().max(120).nullish(),
  code: z.string().max(24).nullish(),
  kind: z.string().max(10).optional(),
  valueBps: z.number().int().min(0).max(10000).optional(),
  valueFlat: z.number().int().min(0).optional(),
  freeAddonId: z.string().uuid().nullish(),
  maxDiscount: z.number().int().min(0).nullish(),
  minSpend: z.number().int().min(0).optional(),
  serviceIds: z.array(z.string().uuid()).max(50).optional(),
  fromDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  toDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  travelFromDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  travelToDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  maxRedemptions: z.number().int().min(0).max(100000).optional(),
  maxPerClient: z.number().int().min(0).max(1000).optional(),
  firstTimeOnly: z.boolean().optional(),
  publicOnListing: z.boolean().optional(),
  active: z.boolean().optional(),
});

const intakeBody = z.object({
  promptAr: z.string().min(1).max(300),
  promptEn: z.string().max(300).nullish(),
  helpAr: z.string().max(300).nullish(),
  fieldType: z.string().max(8).optional(),
  options: z.array(z.object({ valueAr: z.string().max(80) })).max(20).optional(),
  required: z.boolean().optional(),
  serviceId: z.string().uuid().nullish(),
  sortOrder: z.number().int().optional(),
});

export async function partnerCatalogueRoutes(app: FastifyInstance) {
  // ───────────────────────────── the catalogue ──────────────────────────────
  /**
   * Everything needed to draw the catalogue screen, and everything the
   * consumer checkout needs to price against. One round trip: this screen
   * opens on a phone at a chalet gate, and four requests there is four chances
   * for one to be the one that fails.
   */
  app.get("/v1/partner/catalogue", async (req, reply) => {
    const q = scope.parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    const [services, addons, rules, intake] = await Promise.all([
      listServices(ctx.partnerId, { includeInactive: true }),
      listAddons(ctx.partnerId, { includeInactive: true }),
      listPriceRules(ctx.partnerId),
      listIntake(ctx.partnerId),
    ]);
    // Money is a capability, and a price list is money. Staff get the diary,
    // not the rate card — a receptionist reading the corporate rate is how it
    // reaches a competitor.
    if (!ctx.can("settings") && !ctx.can("money")) throw new CiaoError("AUTH_FORBIDDEN");
    return reply.send({ services, addons, rules, intake, role: ctx.role });
  });

  app.post("/v1/partner/services", async (req, reply) => {
    const q = scope.parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("settings");
    const row = await createService(ctx.partnerId, serviceBody.parse(req.body) as never);
    return reply.status(201).send(row);
  });

  app.patch("/v1/partner/services/:id", async (req, reply) => {
    const q = scope.parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("settings");
    const { id } = idParam.parse(req.params);
    return reply.send(
      await updateService(ctx.partnerId, id, serviceBody.partial().parse(req.body) as never),
    );
  });

  app.delete("/v1/partner/services/:id", async (req, reply) => {
    const q = scope.parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("settings");
    const { id } = idParam.parse(req.params);
    return reply.send(await retireService(ctx.partnerId, id));
  });

  app.post("/v1/partner/services/reorder", async (req, reply) => {
    const q = scope.parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("settings");
    const { ids } = z.object({ ids: z.array(z.string().uuid()).max(200) }).parse(req.body);
    await reorderServices(ctx.partnerId, ids);
    return reply.send({ ok: true });
  });

  // ───────────────────────────────── add-ons ────────────────────────────────
  app.post("/v1/partner/addons", async (req, reply) => {
    const q = scope.parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("settings");
    const row = await createAddon(ctx.partnerId, addonBody.parse(req.body) as never);
    void track("partner.addon_created", { priceModel: row.priceModel, required: row.required });
    return reply.status(201).send(row);
  });

  app.patch("/v1/partner/addons/:id", async (req, reply) => {
    const q = scope.parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("settings");
    const { id } = idParam.parse(req.params);
    return reply.send(
      await updateAddon(ctx.partnerId, id, addonBody.partial().parse(req.body) as never),
    );
  });

  app.delete("/v1/partner/addons/:id", async (req, reply) => {
    const q = scope.parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("settings");
    const { id } = idParam.parse(req.params);
    return reply.send(await retireAddon(ctx.partnerId, id));
  });

  // ─────────────────────────────── price rules ──────────────────────────────
  app.post("/v1/partner/price-rules", async (req, reply) => {
    const q = scope.parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("settings");
    const row = await createPriceRule(ctx.partnerId, ruleBody.parse(req.body) as never);
    void track("partner.price_rule_created", { kind: row.kind });
    return reply.status(201).send(row);
  });

  app.patch("/v1/partner/price-rules/:id", async (req, reply) => {
    const q = scope.parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("settings");
    const { id } = idParam.parse(req.params);
    return reply.send(
      await updatePriceRule(ctx.partnerId, id, ruleBody.partial().parse(req.body) as never),
    );
  });

  app.delete("/v1/partner/price-rules/:id", async (req, reply) => {
    const q = scope.parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("settings");
    const { id } = idParam.parse(req.params);
    return reply.send(await deletePriceRule(ctx.partnerId, id));
  });

  // ──────────────────────────────── promotions ──────────────────────────────
  app.get("/v1/partner/promotions", async (req, reply) => {
    const q = scope.parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("settings");
    return reply.send({ items: await listPromotions(ctx.partnerId) });
  });

  app.post("/v1/partner/promotions", async (req, reply) => {
    const q = scope.parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("settings");
    const row = await createPromotion(ctx.partnerId, promotionBody.parse(req.body) as never);
    return reply.status(201).send(row);
  });

  app.patch("/v1/partner/promotions/:id", async (req, reply) => {
    const q = scope.parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("settings");
    const { id } = idParam.parse(req.params);
    return reply.send(
      await updatePromotion(ctx.partnerId, id, promotionBody.partial().parse(req.body) as never),
    );
  });

  // ────────────────────────────── intake questions ──────────────────────────
  app.post("/v1/partner/intake", async (req, reply) => {
    const q = scope.parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("settings");
    const row = await createIntake(ctx.partnerId, intakeBody.parse(req.body) as never);
    void track("partner.intake_created", { fieldType: row.fieldType, required: row.required });
    return reply.status(201).send(row);
  });

  app.patch("/v1/partner/intake/:id", async (req, reply) => {
    const q = scope.parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("settings");
    const { id } = idParam.parse(req.params);
    return reply.send(
      await updateIntake(ctx.partnerId, id, intakeBody.partial().parse(req.body) as never),
    );
  });

  app.delete("/v1/partner/intake/:id", async (req, reply) => {
    const q = scope.parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("settings");
    const { id } = idParam.parse(req.params);
    return reply.send(await retireIntake(ctx.partnerId, id));
  });

  // ───────────────────────────────── pricing ────────────────────────────────
  /**
   * What does this cost?
   *
   * The one place a price is computed on the supply side. The console's live
   * preview, the job editor and the consumer checkout all land here, which is
   * what stops a customer being shown one number and charged another.
   */
  app.post("/v1/partner/price", async (req, reply) => {
    const q = scope.parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("diary");
    const body = z
      .object({
        serviceId: z.string().uuid(),
        units: z.number().int().min(1).max(999).optional(),
        guests: z.number().int().min(1).max(10000).optional(),
        km: z.number().int().min(0).max(5000).optional(),
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
        addons: z
          .array(z.object({ addonId: z.string().uuid(), qty: z.number().int().min(0).max(99) }))
          .max(30)
          .optional(),
        promoCode: z.string().max(24).nullish(),
        promotionId: z.string().uuid().nullish(),
        clientId: z.string().uuid().nullish(),
      })
      .parse(req.body);
    const priced = await priceRequest(ctx.partnerId, body);
    void track("partner.catalogue_priced", {
      unit: priced.unit,
      addonCount: priced.addonLines.length,
      hasPromo: Boolean(priced.promotion),
      ruleCount: priced.appliedRuleIds.length,
    });
    return reply.send(priced);
  });

  // ───────────────────────────────── expenses ───────────────────────────────
  app.get("/v1/partner/expenses", async (req, reply) => {
    const q = scope
      .extend({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("money");
    return reply.send({ items: await listExpenses(ctx.partnerId, q.from, q.to) });
  });

  app.post("/v1/partner/expenses", async (req, reply) => {
    const q = scope.parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("money");
    const body = z
      .object({
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        labelAr: z.string().min(1).max(120),
        amount: z.number().int().min(0),
        category: z.string().max(12).optional(),
        jobId: z.string().uuid().nullish(),
        recurring: z.enum(["monthly", "weekly"]).nullish(),
        recurringUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
        notesAr: z.string().max(500).nullish(),
      })
      .parse(req.body);
    const row = await createExpense(ctx.partnerId, ctx.actorId, body);
    void track("partner.expense_logged", {
      category: row.category,
      recurring: Boolean(row.recurring),
    });
    return reply.status(201).send(row);
  });

  app.delete("/v1/partner/expenses/:id", async (req, reply) => {
    const q = scope.parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("money");
    const { id } = idParam.parse(req.params);
    return reply.send(await deleteExpense(ctx.partnerId, id));
  });

  /** Revenue minus costs — the question nobody here can answer about themselves. */
  app.get("/v1/partner/pnl", async (req, reply) => {
    const q = scope
      .extend({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("money");
    return reply.send(await profitAndLoss(ctx.partnerId, q.from, q.to));
  });

  // ─────────────────────────────── Ciao Plus ────────────────────────────────
  app.get("/v1/partner/plus", async (req, reply) => {
    const q = scope.parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    return reply.send(await subscriptionView(ctx.partnerId));
  });

  app.post("/v1/partner/plus/trial", async (req, reply) => {
    const q = scope.parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("admin");
    await startTrial(ctx.partnerId);
    return reply.send(await subscriptionView(ctx.partnerId));
  });

  /**
   * Buy a year.
   *
   * `admin` rather than `money`, and deliberately so: this is the owner
   * spending the business's money on the business's behalf, which is the same
   * class of action as changing the payout destination. A manager who can read
   * the ledger should not be able to commit the company to a year's fee.
   *
   * Rate-limited hard. A checkout that can be hammered is a way to spray
   * payment intents at a rail and get an account flagged by the bank.
   */
  app.post("/v1/partner/plus/checkout", {
    config: { rateLimit: { max: 6, timeWindow: "1 hour" } },
    handler: async (req, reply) => {
      const q = scope.parse(req.query);
      const ctx = await partnerContext(req, q.partnerId);
      ctx.require("admin");
      const body = z
        .object({ rail: z.string().max(12), returnUrl: z.string().url().max(300).optional() })
        .parse(req.body);

      const [owner] = await db
        .select({ phone: schema.users.phone })
        .from(schema.users)
        .where(eq(schema.users.id, ctx.partnerId))
        .limit(1);
      if (!owner) throw new CiaoError("AUTH_FORBIDDEN");

      const result = await startAnnualCheckout(ctx.partnerId, {
        rail: body.rail,
        phone: owner.phone,
        returnUrl: body.returnUrl,
      });
      return reply.send(result);
    },
  });

  app.post("/v1/partner/plus/cancel", async (req, reply) => {
    const q = scope.parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    ctx.require("admin");
    await cancelSubscription(ctx.partnerId);
    return reply.send(await subscriptionView(ctx.partnerId));
  });

  /**
   * A teaser was shown, or tapped.
   *
   * Worth its own endpoint because the question it answers — which locked
   * panel actually sells the subscription — cannot be inferred from anything
   * else, and the honest answer might be "none of them", which is exactly the
   * kind of thing a product team talks itself out of noticing.
   */
  app.post("/v1/partner/plus/teaser", async (req, reply) => {
    const q = scope.parse(req.query);
    const ctx = await partnerContext(req, q.partnerId);
    const body = z
      .object({ panel: z.string().max(40), action: z.enum(["shown", "clicked"]) })
      .parse(req.body);
    void track(
      body.action === "shown" ? "partner.plus_teaser_shown" : "partner.plus_teaser_clicked",
      { panel: body.panel },
      { userId: ctx.actorId },
    );
    return reply.send({ ok: true });
  });

  // ───────────────────────── what the offer costs, publicly ─────────────────
  /**
   * The price of Plus, with no session.
   *
   * Needed by the sign-in screen and the marketing surfaces, and harmless: it
   * is a list price, not a secret. Reading it from the control plane means the
   * number a partner sees before signing in cannot drift from the one they are
   * charged after.
   */
  app.get("/v1/partner/plus/offer", async (_req, reply) => {
    reply.header("cache-control", "public, max-age=300");
    return reply.send(await planOffer());
  });
}

/**
 * Read a partner's published catalogue for the marketplace.
 *
 * Separate from everything above because the audience is different: no
 * session, no partner context, and only what has been deliberately published.
 * Draft services, internal rates, private codes and retired items never appear
 * here — the filter is `published && active`, applied in SQL rather than in a
 * map, so a future field cannot leak by being forgotten.
 */
export async function publicCatalogue(listingId: string) {
  /*
   * Resolve the partner from the listing's venue, not from the first published
   * service.
   *
   * Deriving it from a service meant a host with extras and offers but no
   * catalogue services published — which is every host who existed before the
   * catalogue did — got an empty object, so their barbecue and their September
   * offer were invisible on their own page. The listing always has a venue and
   * the venue always has a host; that is the durable link.
   */
  const [owner] = await db
    .select({ hostId: schema.venues.hostId })
    .from(schema.listings)
    .innerJoin(schema.venues, eq(schema.listings.venueId, schema.venues.id))
    .where(eq(schema.listings.id, listingId))
    .limit(1);
  if (!owner?.hostId) return { services: [], addons: [], offers: [] };
  const partnerId = owner.hostId;

  const services = await db
    .select({
      id: schema.partnerServices.id,
      nameAr: schema.partnerServices.nameAr,
      nameEn: schema.partnerServices.nameEn,
      descriptionAr: schema.partnerServices.descriptionAr,
      descriptionEn: schema.partnerServices.descriptionEn,
      unit: schema.partnerServices.unit,
      basePrice: schema.partnerServices.basePrice,
      minUnits: schema.partnerServices.minUnits,
      maxUnits: schema.partnerServices.maxUnits,
      durationMinutes: schema.partnerServices.durationMinutes,
      minGuests: schema.partnerServices.minGuests,
      maxGuests: schema.partnerServices.maxGuests,
      includesAr: schema.partnerServices.includesAr,
      media: schema.partnerServices.media,
      instantBook: schema.partnerServices.instantBook,
      partnerId: schema.partnerServices.partnerId,
    })
    .from(schema.partnerServices)
    .where(
      and(
        eq(schema.partnerServices.listingId, listingId),
        eq(schema.partnerServices.published, true),
        eq(schema.partnerServices.active, true),
      ),
    )
    .orderBy(schema.partnerServices.sortOrder);

  const addons = await db
    .select({
      id: schema.partnerAddons.id,
      serviceId: schema.partnerAddons.serviceId,
      nameAr: schema.partnerAddons.nameAr,
      nameEn: schema.partnerAddons.nameEn,
      descriptionAr: schema.partnerAddons.descriptionAr,
      price: schema.partnerAddons.price,
      priceModel: schema.partnerAddons.priceModel,
      maxQty: schema.partnerAddons.maxQty,
      required: schema.partnerAddons.required,
    })
    .from(schema.partnerAddons)
    .where(
      and(eq(schema.partnerAddons.partnerId, partnerId), eq(schema.partnerAddons.active, true)),
    )
    .orderBy(schema.partnerAddons.sortOrder);

  /*
   * Only offers the partner chose to advertise.
   *
   * `publicOnListing` is the switch, and the default being on is deliberate: a
   * partner who builds a September offer wants it seen. The ones they turn off
   * are the codes they hand out personally, and those must not appear on a
   * page where anyone can read them.
   */
  const offers = await db
    .select({
      id: schema.partnerPromotions.id,
      labelAr: schema.partnerPromotions.labelAr,
      labelEn: schema.partnerPromotions.labelEn,
      kind: schema.partnerPromotions.kind,
      valueBps: schema.partnerPromotions.valueBps,
      valueFlat: schema.partnerPromotions.valueFlat,
      code: schema.partnerPromotions.code,
      minSpend: schema.partnerPromotions.minSpend,
      travelFromDay: schema.partnerPromotions.travelFromDay,
      travelToDay: schema.partnerPromotions.travelToDay,
    })
    .from(schema.partnerPromotions)
    .where(
      and(
        eq(schema.partnerPromotions.partnerId, partnerId),
        eq(schema.partnerPromotions.active, true),
        eq(schema.partnerPromotions.publicOnListing, true),
      ),
    );

  /*
   * The questions travel with the catalogue.
   *
   * Only the business-wide ones: a question attached to a catalogue service is
   * asked when that service is bought, and a stay booked from a listing is not
   * one of those. Asking a chalet guest what style of make-up she wants is how
   * a thoughtful feature becomes a joke.
   */
  const questions = await db
    .select({
      id: schema.partnerIntakeQuestions.id,
      promptAr: schema.partnerIntakeQuestions.promptAr,
      promptEn: schema.partnerIntakeQuestions.promptEn,
      helpAr: schema.partnerIntakeQuestions.helpAr,
      fieldType: schema.partnerIntakeQuestions.fieldType,
      options: schema.partnerIntakeQuestions.options,
      required: schema.partnerIntakeQuestions.required,
    })
    .from(schema.partnerIntakeQuestions)
    .where(
      and(
        eq(schema.partnerIntakeQuestions.partnerId, partnerId),
        eq(schema.partnerIntakeQuestions.active, true),
        sql`${schema.partnerIntakeQuestions.serviceId} is null`,
      ),
    )
    .orderBy(schema.partnerIntakeQuestions.sortOrder);

  return {
    services: services.map(({ partnerId: _p, ...s }) => s),
    addons: addons.filter((a) => !a.serviceId),
    offers,
    questions,
  };
}
