/**
 * The catalogue — what a partner sells, and what it costs.
 *
 * This is the module the rest of the business app hangs off. A service in here
 * is what a job is created from, what a quote line comes from, what the
 * marketplace lists, and what a promotion discounts. Everything else in the
 * console describes work that has already been agreed; this describes the
 * offer.
 *
 * Two rules govern the whole file:
 *
 *  1. **Prices are computed here, never sent by the client.** The console posts
 *     a selection — this service, two nights, these add-ons — and gets back a
 *     priced breakdown. A client that can post a total is a client that can
 *     post any total, and on a marketplace the person with the incentive to do
 *     that is the one paying.
 *
 *  2. **Nothing is deleted.** A service a partner "removes" is deactivated, so
 *     the jobs and quotes that referenced it still read correctly a year later.
 *     A diary that loses its own history when a price list changes is a diary
 *     nobody trusts with the wedding.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  ADDON_PRICE_MODELS,
  EXPENSE_CATEGORIES,
  INTAKE_FIELD_TYPES,
  PRICE_RULE_KINDS,
  PROMOTION_KINDS,
  SERVICE_UNITS,
  evaluatePromotion,
  priceSelection,
  type PriceBreakdown,
  type PricedAddonChoice,
  type PromotionRefusal,
} from "@ciao/shared";
import { db, schema } from "../../db/client.js";
import { CiaoError } from "../../lib/errors.js";
import { track } from "../intelligence/events.js";

const isUnit = (v: string) => (SERVICE_UNITS as readonly string[]).includes(v);
const isAddonModel = (v: string) => (ADDON_PRICE_MODELS as readonly string[]).includes(v);
const isRuleKind = (v: string) => (PRICE_RULE_KINDS as readonly string[]).includes(v);
const isPromoKind = (v: string) => (PROMOTION_KINDS as readonly string[]).includes(v);
const isExpenseCategory = (v: string) => (EXPENSE_CATEGORIES as readonly string[]).includes(v);
const isIntakeType = (v: string) => (INTAKE_FIELD_TYPES as readonly string[]).includes(v);

const today = (): string => new Date().toISOString().slice(0, 10);

/** Days between today and a future day. Negative for the past. */
export function leadDaysTo(day?: string | null): number | null {
  if (!day) return null;
  const target = new Date(`${day}T00:00:00Z`).getTime();
  if (Number.isNaN(target)) return null;
  const now = new Date(`${today()}T00:00:00Z`).getTime();
  return Math.round((target - now) / 86_400_000);
}

// ═════════════════════════════════ services ═════════════════════════════════

export interface ServiceInput {
  nameAr: string;
  nameEn?: string | null;
  descriptionAr?: string | null;
  descriptionEn?: string | null;
  unit?: string;
  basePrice?: number;
  minUnits?: number;
  maxUnits?: number | null;
  durationMinutes?: number | null;
  minGuests?: number | null;
  maxGuests?: number | null;
  noticeHours?: number | null;
  depositBps?: number | null;
  cancellationTier?: string | null;
  dailyCapacity?: number | null;
  includesAr?: string[];
  media?: unknown[];
  instantBook?: boolean;
  published?: boolean;
  listingId?: string | null;
  sortOrder?: number;
}

function validateService(input: ServiceInput) {
  if (!input.nameAr?.trim()) throw new CiaoError("VALIDATION", { field: "nameAr" });
  if (input.unit && !isUnit(input.unit)) throw new CiaoError("VALIDATION", { field: "unit" });
  if ((input.basePrice ?? 0) < 0) throw new CiaoError("VALIDATION", { field: "basePrice" });
  /*
   * A deposit over 100% is not a typo worth honouring. `depositBps` reaches
   * the consumer checkout, so a fat-fingered 20000 would ask a guest for twice
   * the price of the stay — and they would simply leave.
   */
  if (input.depositBps != null && (input.depositBps < 0 || input.depositBps > 10000))
    throw new CiaoError("VALIDATION", { field: "depositBps" });
  if (input.minUnits != null && input.minUnits < 1)
    throw new CiaoError("VALIDATION", { field: "minUnits" });
  if (input.maxUnits != null && input.minUnits != null && input.maxUnits < input.minUnits)
    throw new CiaoError("VALIDATION", { field: "maxUnits" });
  if (
    input.maxGuests != null &&
    input.minGuests != null &&
    input.maxGuests < input.minGuests
  )
    throw new CiaoError("VALIDATION", { field: "maxGuests" });
}

export async function listServices(partnerId: string, opts: { includeInactive?: boolean } = {}) {
  const where = opts.includeInactive
    ? eq(schema.partnerServices.partnerId, partnerId)
    : and(eq(schema.partnerServices.partnerId, partnerId), eq(schema.partnerServices.active, true));
  return db
    .select()
    .from(schema.partnerServices)
    .where(where)
    .orderBy(asc(schema.partnerServices.sortOrder), asc(schema.partnerServices.createdAt));
}

export async function createService(partnerId: string, input: ServiceInput) {
  validateService(input);
  const [row] = await db
    .insert(schema.partnerServices)
    .values({
      partnerId,
      listingId: input.listingId ?? null,
      nameAr: input.nameAr.trim(),
      nameEn: input.nameEn?.trim() || null,
      descriptionAr: input.descriptionAr ?? null,
      descriptionEn: input.descriptionEn ?? null,
      unit: input.unit && isUnit(input.unit) ? input.unit : "item",
      basePrice: Math.max(0, Math.round(input.basePrice ?? 0)),
      minUnits: Math.max(1, Math.round(input.minUnits ?? 1)),
      maxUnits: input.maxUnits ?? null,
      durationMinutes: input.durationMinutes ?? null,
      minGuests: input.minGuests ?? null,
      maxGuests: input.maxGuests ?? null,
      noticeHours: input.noticeHours ?? null,
      depositBps: input.depositBps ?? null,
      cancellationTier: input.cancellationTier ?? null,
      dailyCapacity: input.dailyCapacity ?? null,
      includesAr: input.includesAr ?? [],
      media: input.media ?? [],
      instantBook: input.instantBook ?? false,
      published: input.published ?? false,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning();
  void track("partner.service_created", {
    unit: row!.unit,
    hasPrice: row!.basePrice > 0,
    published: row!.published,
  });
  return row!;
}

export async function updateService(partnerId: string, id: string, input: Partial<ServiceInput>) {
  const [existing] = await db
    .select()
    .from(schema.partnerServices)
    .where(and(eq(schema.partnerServices.id, id), eq(schema.partnerServices.partnerId, partnerId)))
    .limit(1);
  if (!existing) throw new CiaoError("AUTH_FORBIDDEN");
  validateService({ ...existing, ...input } as ServiceInput);

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  const copy = <K extends keyof ServiceInput>(k: K, transform?: (v: NonNullable<ServiceInput[K]>) => unknown) => {
    if (input[k] === undefined) return;
    const v = input[k];
    patch[k as string] = v === null ? null : transform ? transform(v as NonNullable<ServiceInput[K]>) : v;
  };
  copy("nameAr", (v) => String(v).trim());
  copy("nameEn", (v) => String(v).trim() || null);
  copy("descriptionAr");
  copy("descriptionEn");
  copy("unit", (v) => (isUnit(String(v)) ? v : existing.unit));
  copy("basePrice", (v) => Math.max(0, Math.round(Number(v))));
  copy("minUnits", (v) => Math.max(1, Math.round(Number(v))));
  copy("maxUnits");
  copy("durationMinutes");
  copy("minGuests");
  copy("maxGuests");
  copy("noticeHours");
  copy("depositBps");
  copy("cancellationTier");
  copy("dailyCapacity");
  copy("includesAr");
  copy("media");
  copy("instantBook");
  copy("published");
  copy("listingId");
  copy("sortOrder");

  const [row] = await db
    .update(schema.partnerServices)
    .set(patch)
    .where(eq(schema.partnerServices.id, id))
    .returning();
  return row!;
}

/**
 * Retire a service rather than delete it.
 *
 * The row stays so that every job, quote and booking that pointed at it keeps
 * resolving. What changes is that it stops being offered — and it also stops
 * being published, because a partner who retires a service and then finds it
 * still on the marketplace has been let down in the way that matters most.
 */
export async function retireService(partnerId: string, id: string) {
  const [row] = await db
    .update(schema.partnerServices)
    .set({ active: false, published: false, updatedAt: new Date() })
    .where(and(eq(schema.partnerServices.id, id), eq(schema.partnerServices.partnerId, partnerId)))
    .returning();
  if (!row) throw new CiaoError("AUTH_FORBIDDEN");
  return row;
}

export async function reorderServices(partnerId: string, ids: string[]) {
  // One statement rather than a loop: a half-applied reorder leaves a
  // catalogue in an order nobody chose.
  if (ids.length === 0) return;
  const cases = ids.map((id, i) => sql`when ${id}::uuid then ${i}`);
  await db.execute(sql`
    update partner_services
       set sort_order = case id ${sql.join(cases, sql` `)} else sort_order end,
           updated_at = now()
     where partner_id = ${partnerId} and id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
  `);
}

// ══════════════════════════════════ add-ons ═════════════════════════════════

export interface AddonInput {
  nameAr: string;
  nameEn?: string | null;
  descriptionAr?: string | null;
  price?: number;
  priceModel?: string;
  maxQty?: number;
  required?: boolean;
  serviceId?: string | null;
  sortOrder?: number;
}

export async function listAddons(partnerId: string, opts: { includeInactive?: boolean } = {}) {
  const where = opts.includeInactive
    ? eq(schema.partnerAddons.partnerId, partnerId)
    : and(eq(schema.partnerAddons.partnerId, partnerId), eq(schema.partnerAddons.active, true));
  return db
    .select()
    .from(schema.partnerAddons)
    .where(where)
    .orderBy(asc(schema.partnerAddons.sortOrder), asc(schema.partnerAddons.createdAt));
}

export async function createAddon(partnerId: string, input: AddonInput) {
  if (!input.nameAr?.trim()) throw new CiaoError("VALIDATION", { field: "nameAr" });
  if (input.priceModel && !isAddonModel(input.priceModel))
    throw new CiaoError("VALIDATION", { field: "priceModel" });
  if ((input.price ?? 0) < 0) throw new CiaoError("VALIDATION", { field: "price" });
  const [row] = await db
    .insert(schema.partnerAddons)
    .values({
      partnerId,
      serviceId: input.serviceId ?? null,
      nameAr: input.nameAr.trim(),
      nameEn: input.nameEn?.trim() || null,
      descriptionAr: input.descriptionAr ?? null,
      price: Math.max(0, Math.round(input.price ?? 0)),
      priceModel: input.priceModel && isAddonModel(input.priceModel) ? input.priceModel : "flat",
      maxQty: Math.max(1, Math.round(input.maxQty ?? 1)),
      required: input.required ?? false,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning();
  return row!;
}

export async function updateAddon(partnerId: string, id: string, input: Partial<AddonInput>) {
  if (input.priceModel && !isAddonModel(input.priceModel))
    throw new CiaoError("VALIDATION", { field: "priceModel" });
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.nameAr !== undefined) patch.nameAr = String(input.nameAr).trim();
  if (input.nameEn !== undefined) patch.nameEn = input.nameEn || null;
  if (input.descriptionAr !== undefined) patch.descriptionAr = input.descriptionAr;
  if (input.price !== undefined) patch.price = Math.max(0, Math.round(Number(input.price)));
  if (input.priceModel !== undefined) patch.priceModel = input.priceModel;
  if (input.maxQty !== undefined) patch.maxQty = Math.max(1, Math.round(Number(input.maxQty)));
  if (input.required !== undefined) patch.required = input.required;
  if (input.serviceId !== undefined) patch.serviceId = input.serviceId;
  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
  const [row] = await db
    .update(schema.partnerAddons)
    .set(patch)
    .where(and(eq(schema.partnerAddons.id, id), eq(schema.partnerAddons.partnerId, partnerId)))
    .returning();
  if (!row) throw new CiaoError("AUTH_FORBIDDEN");
  return row;
}

export async function retireAddon(partnerId: string, id: string) {
  const [row] = await db
    .update(schema.partnerAddons)
    .set({ active: false, updatedAt: new Date() })
    .where(and(eq(schema.partnerAddons.id, id), eq(schema.partnerAddons.partnerId, partnerId)))
    .returning();
  if (!row) throw new CiaoError("AUTH_FORBIDDEN");
  return row;
}

// ═══════════════════════════════ price rules ════════════════════════════════

export async function listPriceRules(partnerId: string) {
  return db
    .select()
    .from(schema.partnerPriceRules)
    .where(eq(schema.partnerPriceRules.partnerId, partnerId))
    .orderBy(asc(schema.partnerPriceRules.priority), asc(schema.partnerPriceRules.createdAt));
}

export interface PriceRuleInput {
  labelAr: string;
  kind: string;
  serviceId?: string | null;
  fromDay?: string | null;
  toDay?: string | null;
  weekdays?: number[];
  minLeadDays?: number | null;
  maxLeadDays?: number | null;
  minUnits?: number | null;
  adjustBps?: number;
  adjustFlat?: number;
  priority?: number;
  active?: boolean;
}

function validateRule(input: PriceRuleInput) {
  if (!input.labelAr?.trim()) throw new CiaoError("VALIDATION", { field: "labelAr" });
  if (!isRuleKind(input.kind)) throw new CiaoError("VALIDATION", { field: "kind" });
  /*
   * A rule that multiplies by zero, or by fifty, is a partner who meant to
   * type something else — and unlike most bad input this one silently produces
   * a price rather than an error. The band is wide enough for anything real
   * (half price to triple) and narrow enough to catch a slipped decimal.
   */
  const bps = input.adjustBps ?? 10000;
  if (bps < 1000 || bps > 30000) throw new CiaoError("VALIDATION", { field: "adjustBps" });
  if (input.kind === "season" && !input.fromDay && !input.toDay)
    throw new CiaoError("VALIDATION", { field: "fromDay" });
  if (input.kind === "weekday" && !(input.weekdays ?? []).length)
    throw new CiaoError("VALIDATION", { field: "weekdays" });
  if (input.kind === "duration" && !input.minUnits)
    throw new CiaoError("VALIDATION", { field: "minUnits" });
  if (input.kind === "lead_time" && input.minLeadDays == null && input.maxLeadDays == null)
    throw new CiaoError("VALIDATION", { field: "minLeadDays" });
}

export async function createPriceRule(partnerId: string, input: PriceRuleInput) {
  validateRule(input);
  const [row] = await db
    .insert(schema.partnerPriceRules)
    .values({
      partnerId,
      serviceId: input.serviceId ?? null,
      labelAr: input.labelAr.trim(),
      kind: input.kind,
      fromDay: input.fromDay ?? null,
      toDay: input.toDay ?? null,
      weekdays: input.weekdays ?? [],
      minLeadDays: input.minLeadDays ?? null,
      maxLeadDays: input.maxLeadDays ?? null,
      minUnits: input.minUnits ?? null,
      adjustBps: input.adjustBps ?? 10000,
      adjustFlat: Math.round(input.adjustFlat ?? 0),
      priority: input.priority ?? 100,
      active: input.active ?? true,
    })
    .returning();
  return row!;
}

export async function updatePriceRule(partnerId: string, id: string, input: Partial<PriceRuleInput>) {
  const [existing] = await db
    .select()
    .from(schema.partnerPriceRules)
    .where(
      and(eq(schema.partnerPriceRules.id, id), eq(schema.partnerPriceRules.partnerId, partnerId)),
    )
    .limit(1);
  if (!existing) throw new CiaoError("AUTH_FORBIDDEN");
  validateRule({ ...existing, ...input } as PriceRuleInput);
  const [row] = await db
    .update(schema.partnerPriceRules)
    .set({ ...input, updatedAt: new Date() } as never)
    .where(eq(schema.partnerPriceRules.id, id))
    .returning();
  return row!;
}

export async function deletePriceRule(partnerId: string, id: string) {
  // Rules, unlike services, genuinely can be deleted: nothing references one
  // after the fact. A priced job carries its lines as a snapshot, so removing
  // "August +20%" cannot rewrite a job that was priced under it.
  const [row] = await db
    .delete(schema.partnerPriceRules)
    .where(
      and(eq(schema.partnerPriceRules.id, id), eq(schema.partnerPriceRules.partnerId, partnerId)),
    )
    .returning();
  if (!row) throw new CiaoError("AUTH_FORBIDDEN");
  return row;
}

// ══════════════════════════════════ pricing ═════════════════════════════════

export interface QuoteRequest {
  serviceId: string;
  units?: number;
  guests?: number;
  km?: number;
  day?: string | null;
  addons?: { addonId: string; qty: number }[];
  promoCode?: string | null;
  promotionId?: string | null;
  clientId?: string | null;
}

export interface PricedSelection extends PriceBreakdown {
  serviceId: string;
  serviceNameAr: string;
  unit: string;
  currency: "LYD";
  discount: number;
  promotion: { id: string; labelAr: string; code: string | null } | null;
  promotionRefused: PromotionRefusal | null;
  total: number;
  deposit: number;
  depositBps: number;
  /** Add-on lines resolved to names and prices, for snapshotting onto a job. */
  addonLines: { addonId: string; nameAr: string; qty: number; unitPrice: number; total: number }[];
}

/**
 * Price a selection against the partner's live catalogue.
 *
 * The single entry point for money on the supply side: the console's price
 * preview, the consumer checkout, and the job editor all call this, so a
 * customer cannot be shown one number and charged another. Everything the
 * caller sends is treated as a *request* — quantities are clamped to the
 * service's bounds and add-ons that do not belong to this partner are dropped
 * silently rather than trusted.
 */
export async function priceRequest(
  partnerId: string,
  req: QuoteRequest,
): Promise<PricedSelection> {
  const [service] = await db
    .select()
    .from(schema.partnerServices)
    .where(
      and(
        eq(schema.partnerServices.id, req.serviceId),
        eq(schema.partnerServices.partnerId, partnerId),
      ),
    )
    .limit(1);
  if (!service) throw new CiaoError("VALIDATION", { field: "serviceId" });

  const wanted = new Map((req.addons ?? []).map((a) => [a.addonId, Math.max(0, Math.round(a.qty))]));
  const addonRows = wanted.size
    ? await db
        .select()
        .from(schema.partnerAddons)
        .where(
          and(
            eq(schema.partnerAddons.partnerId, partnerId),
            eq(schema.partnerAddons.active, true),
            inArray(schema.partnerAddons.id, [...wanted.keys()]),
          ),
        )
    : [];

  // Required add-ons are not optional, whatever the client sent. Leaving them
  // out would let a caller shave the cleaning fee off by omission.
  const required = await db
    .select()
    .from(schema.partnerAddons)
    .where(
      and(
        eq(schema.partnerAddons.partnerId, partnerId),
        eq(schema.partnerAddons.active, true),
        eq(schema.partnerAddons.required, true),
      ),
    );
  const byId = new Map(addonRows.map((a) => [a.id, a]));
  for (const r of required) {
    if (r.serviceId && r.serviceId !== service.id) continue;
    byId.set(r.id, r);
    /*
     * Force at least one, whatever arrived.
     *
     * Guarding on `!byId.has(id)` alone left a hole: sending the required
     * add-on's id with `qty: 0` — which the route's schema allows, because 0
     * is how a client removes an optional extra — kept the entry and skipped
     * the forcing branch, so the mandatory fee priced at zero. Omitting the id
     * was covered; sending it as zero was not.
     */
    wanted.set(r.id, Math.max(1, wanted.get(r.id) ?? 1));
  }

  const choices: PricedAddonChoice[] = [...byId.values()]
    .filter((a) => !a.serviceId || a.serviceId === service.id)
    .map((a) => ({
      id: a.id,
      nameAr: a.nameAr,
      price: a.price,
      priceModel: a.priceModel,
      qty: Math.min(wanted.get(a.id) ?? 0, a.maxQty),
    }));

  const rules = await db
    .select()
    .from(schema.partnerPriceRules)
    .where(
      and(
        eq(schema.partnerPriceRules.partnerId, partnerId),
        eq(schema.partnerPriceRules.active, true),
      ),
    );

  const breakdown = priceSelection({
    service: {
      id: service.id,
      unit: service.unit,
      basePrice: service.basePrice,
      minUnits: service.minUnits,
      maxUnits: service.maxUnits,
    },
    units: req.units ?? service.minUnits,
    guests: req.guests ?? service.minGuests ?? 1,
    km: req.km,
    day: req.day ?? null,
    leadDays: leadDaysTo(req.day),
    addons: choices,
    rules: rules.map((r) => ({
      id: r.id,
      kind: r.kind,
      labelAr: r.labelAr,
      fromDay: r.fromDay,
      toDay: r.toDay,
      weekdays: (r.weekdays as number[]) ?? [],
      minLeadDays: r.minLeadDays,
      maxLeadDays: r.maxLeadDays,
      minUnits: r.minUnits,
      adjustBps: r.adjustBps,
      adjustFlat: r.adjustFlat,
      priority: r.priority,
      serviceId: r.serviceId,
    })),
  });

  // ── the partner's own promotion ────────────────────────────────────────
  let discount = 0;
  let promotion: PricedSelection["promotion"] = null;
  let promotionRefused: PromotionRefusal | null = null;

  const promoRow = await findPromotion(partnerId, req);
  if (promoRow) {
    const clientRedemptions = req.clientId
      ? await countClientRedemptions(partnerId, promoRow.id, req.clientId)
      : 0;
    const isFirstTime = req.clientId ? await isFirstTimeClient(partnerId, req.clientId) : true;
    const verdict = evaluatePromotion(
      {
        id: promoRow.id,
        code: promoRow.code,
        labelAr: promoRow.labelAr,
        kind: promoRow.kind,
        valueBps: promoRow.valueBps,
        valueFlat: promoRow.valueFlat,
        maxDiscount: promoRow.maxDiscount,
        minSpend: promoRow.minSpend,
        serviceIds: (promoRow.serviceIds as string[]) ?? [],
        fromDay: promoRow.fromDay,
        toDay: promoRow.toDay,
        travelFromDay: promoRow.travelFromDay,
        travelToDay: promoRow.travelToDay,
        maxRedemptions: promoRow.maxRedemptions,
        maxPerClient: promoRow.maxPerClient,
        redemptions: promoRow.redemptions,
        firstTimeOnly: promoRow.firstTimeOnly,
        active: promoRow.active,
        freeAddonId: promoRow.freeAddonId,
      },
      {
        subtotal: breakdown.subtotal,
        serviceId: service.id,
        travelDay: req.day ?? null,
        today: today(),
        clientRedemptions,
        isFirstTime,
        addons: choices,
      },
    );
    if (verdict.ok) {
      discount = verdict.discount;
      promotion = { id: promoRow.id, labelAr: promoRow.labelAr, code: promoRow.code };
    } else {
      promotionRefused = verdict.reason;
    }
  }

  const total = Math.max(0, breakdown.subtotal - discount);
  const depositBps = service.depositBps ?? (await profileDepositBps(partnerId));
  const deposit = Math.round((total * depositBps) / 10000);

  return {
    ...breakdown,
    serviceId: service.id,
    serviceNameAr: service.nameAr,
    unit: service.unit,
    currency: "LYD",
    discount,
    promotion,
    promotionRefused,
    total,
    deposit,
    depositBps,
    addonLines: choices
      .filter((c) => c.qty > 0)
      .map((c) => {
        const line = breakdown.lines.find((l) => l.kind === "addon" && l.labelAr === c.nameAr);
        return {
          addonId: c.id,
          nameAr: c.nameAr,
          qty: c.qty,
          unitPrice: c.price,
          total: line?.amount ?? 0,
        };
      }),
  };
}

async function profileDepositBps(partnerId: string): Promise<number> {
  const [p] = await db
    .select({ bps: schema.partnerProfiles.defaultDepositBps })
    .from(schema.partnerProfiles)
    .where(eq(schema.partnerProfiles.userId, partnerId))
    .limit(1);
  return p?.bps ?? 2000;
}

/**
 * Which promotion to consider.
 *
 * A named code wins, because the customer typed it and expects that one. With
 * no code the best *automatic* offer is chosen for them — a partner who set up
 * "10% off September" meant it to reach people who never heard of it, and
 * making the customer guess a code would defeat the purpose.
 */
async function findPromotion(partnerId: string, req: QuoteRequest) {
  if (req.promotionId) {
    const [row] = await db
      .select()
      .from(schema.partnerPromotions)
      .where(
        and(
          eq(schema.partnerPromotions.id, req.promotionId),
          eq(schema.partnerPromotions.partnerId, partnerId),
        ),
      )
      .limit(1);
    return row ?? null;
  }
  if (req.promoCode?.trim()) {
    const [row] = await db
      .select()
      .from(schema.partnerPromotions)
      .where(
        and(
          eq(schema.partnerPromotions.partnerId, partnerId),
          eq(schema.partnerPromotions.code, req.promoCode.trim().toUpperCase()),
        ),
      )
      .limit(1);
    return row ?? null;
  }
  const autos = await db
    .select()
    .from(schema.partnerPromotions)
    .where(
      and(
        eq(schema.partnerPromotions.partnerId, partnerId),
        eq(schema.partnerPromotions.active, true),
        sql`${schema.partnerPromotions.code} is null`,
      ),
    );
  return autos[0] ?? null;
}

async function countClientRedemptions(partnerId: string, promotionId: string, clientId: string) {
  const [row] = await db
    .select({ n: sql<string>`count(*)` })
    .from(schema.partnerJobs)
    .where(
      and(
        eq(schema.partnerJobs.partnerId, partnerId),
        eq(schema.partnerJobs.clientId, clientId),
        eq(schema.partnerJobs.promotionId, promotionId),
      ),
    );
  return Number(row?.n ?? 0);
}

async function isFirstTimeClient(partnerId: string, clientId: string) {
  const [row] = await db
    .select({ n: schema.partnerClients.jobsCount })
    .from(schema.partnerClients)
    .where(
      and(eq(schema.partnerClients.id, clientId), eq(schema.partnerClients.partnerId, partnerId)),
    )
    .limit(1);
  return (row?.n ?? 0) === 0;
}

/** Count a redemption. Called once, when a job or booking actually commits. */
export async function recordRedemption(promotionId: string) {
  await db
    .update(schema.partnerPromotions)
    .set({ redemptions: sql`${schema.partnerPromotions.redemptions} + 1`, updatedAt: new Date() })
    .where(eq(schema.partnerPromotions.id, promotionId));
}

// ════════════════════════════════ promotions ════════════════════════════════

export interface PromotionInput {
  labelAr: string;
  labelEn?: string | null;
  code?: string | null;
  kind?: string;
  valueBps?: number;
  valueFlat?: number;
  freeAddonId?: string | null;
  maxDiscount?: number | null;
  minSpend?: number;
  serviceIds?: string[];
  fromDay?: string | null;
  toDay?: string | null;
  travelFromDay?: string | null;
  travelToDay?: string | null;
  maxRedemptions?: number;
  maxPerClient?: number;
  firstTimeOnly?: boolean;
  publicOnListing?: boolean;
  active?: boolean;
}

function validatePromotion(input: PromotionInput) {
  if (!input.labelAr?.trim()) throw new CiaoError("VALIDATION", { field: "labelAr" });
  if (input.kind && !isPromoKind(input.kind)) throw new CiaoError("VALIDATION", { field: "kind" });
  if (input.kind === "percent") {
    const bps = input.valueBps ?? 0;
    /*
     * Capped at half. Not paternalism — a partner typing 9000 meaning "90 per
     * cent of the price" instead of "90 per cent off" is a mistake this
     * market makes constantly, and the version that goes through is the one
     * that gives the chalet away. Anything genuinely below half price is a
     * conversation worth having with a human first.
     */
    if (bps <= 0 || bps > 5000) throw new CiaoError("VALIDATION", { field: "valueBps" });
  }
  if (input.kind === "fixed" && (input.valueFlat ?? 0) <= 0)
    throw new CiaoError("VALIDATION", { field: "valueFlat" });
  if (input.kind === "free_addon" && !input.freeAddonId)
    throw new CiaoError("VALIDATION", { field: "freeAddonId" });
  if (input.fromDay && input.toDay && input.toDay < input.fromDay)
    throw new CiaoError("VALIDATION", { field: "toDay" });
}

export async function listPromotions(partnerId: string) {
  return db
    .select()
    .from(schema.partnerPromotions)
    .where(eq(schema.partnerPromotions.partnerId, partnerId))
    .orderBy(desc(schema.partnerPromotions.active), desc(schema.partnerPromotions.createdAt));
}

export async function createPromotion(partnerId: string, input: PromotionInput) {
  validatePromotion(input);
  const code = input.code?.trim().toUpperCase() || null;
  const [row] = await db
    .insert(schema.partnerPromotions)
    .values({
      partnerId,
      code,
      labelAr: input.labelAr.trim(),
      labelEn: input.labelEn?.trim() || null,
      kind: input.kind ?? "percent",
      valueBps: input.valueBps ?? 0,
      valueFlat: Math.max(0, Math.round(input.valueFlat ?? 0)),
      freeAddonId: input.freeAddonId ?? null,
      maxDiscount: input.maxDiscount ?? null,
      minSpend: Math.max(0, Math.round(input.minSpend ?? 0)),
      serviceIds: input.serviceIds ?? [],
      fromDay: input.fromDay ?? null,
      toDay: input.toDay ?? null,
      travelFromDay: input.travelFromDay ?? null,
      travelToDay: input.travelToDay ?? null,
      maxRedemptions: Math.max(0, Math.round(input.maxRedemptions ?? 0)),
      maxPerClient: Math.max(0, Math.round(input.maxPerClient ?? 0)),
      firstTimeOnly: input.firstTimeOnly ?? false,
      publicOnListing: input.publicOnListing ?? true,
      active: input.active ?? true,
    })
    .returning()
    .catch((e: unknown) => {
      // The unique index on (partner, code) is the guard; a duplicate code is
      // a normal thing for a person to do, not a 500.
      if (String(e).includes("partner_promotions_code_uq"))
        throw new CiaoError("VALIDATION", { field: "code", reason: "duplicate" });
      throw e;
    });
  void track("partner.promotion_created", {
    kind: row!.kind,
    hasCode: Boolean(row!.code),
    automatic: !row!.code,
  });
  return row!;
}

export async function updatePromotion(partnerId: string, id: string, input: Partial<PromotionInput>) {
  const [existing] = await db
    .select()
    .from(schema.partnerPromotions)
    .where(
      and(eq(schema.partnerPromotions.id, id), eq(schema.partnerPromotions.partnerId, partnerId)),
    )
    .limit(1);
  if (!existing) throw new CiaoError("AUTH_FORBIDDEN");
  validatePromotion({ ...existing, ...input } as PromotionInput);
  const patch = { ...input, updatedAt: new Date() } as Record<string, unknown>;
  if (input.code !== undefined) patch.code = input.code?.trim().toUpperCase() || null;
  const [row] = await db
    .update(schema.partnerPromotions)
    .set(patch as never)
    .where(eq(schema.partnerPromotions.id, id))
    .returning();
  return row!;
}

// ═══════════════════════════════ intake questions ═══════════════════════════

export interface IntakeInput {
  promptAr: string;
  promptEn?: string | null;
  helpAr?: string | null;
  fieldType?: string;
  options?: { valueAr: string }[];
  required?: boolean;
  serviceId?: string | null;
  sortOrder?: number;
}

export async function listIntake(partnerId: string, serviceId?: string | null) {
  const rows = await db
    .select()
    .from(schema.partnerIntakeQuestions)
    .where(
      and(
        eq(schema.partnerIntakeQuestions.partnerId, partnerId),
        eq(schema.partnerIntakeQuestions.active, true),
      ),
    )
    .orderBy(asc(schema.partnerIntakeQuestions.sortOrder));
  if (serviceId === undefined) return rows;
  return rows.filter((r) => !r.serviceId || r.serviceId === serviceId);
}

export async function createIntake(partnerId: string, input: IntakeInput) {
  if (!input.promptAr?.trim()) throw new CiaoError("VALIDATION", { field: "promptAr" });
  if (input.fieldType && !isIntakeType(input.fieldType))
    throw new CiaoError("VALIDATION", { field: "fieldType" });
  if (input.fieldType === "choice" && !(input.options ?? []).length)
    throw new CiaoError("VALIDATION", { field: "options" });
  const [row] = await db
    .insert(schema.partnerIntakeQuestions)
    .values({
      partnerId,
      serviceId: input.serviceId ?? null,
      promptAr: input.promptAr.trim(),
      promptEn: input.promptEn?.trim() || null,
      helpAr: input.helpAr ?? null,
      fieldType: input.fieldType ?? "text",
      options: input.options ?? [],
      required: input.required ?? false,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning();
  return row!;
}

export async function updateIntake(partnerId: string, id: string, input: Partial<IntakeInput>) {
  const [row] = await db
    .update(schema.partnerIntakeQuestions)
    .set({ ...input, updatedAt: new Date() } as never)
    .where(
      and(
        eq(schema.partnerIntakeQuestions.id, id),
        eq(schema.partnerIntakeQuestions.partnerId, partnerId),
      ),
    )
    .returning();
  if (!row) throw new CiaoError("AUTH_FORBIDDEN");
  return row;
}

export async function retireIntake(partnerId: string, id: string) {
  const [row] = await db
    .update(schema.partnerIntakeQuestions)
    .set({ active: false, updatedAt: new Date() })
    .where(
      and(
        eq(schema.partnerIntakeQuestions.id, id),
        eq(schema.partnerIntakeQuestions.partnerId, partnerId),
      ),
    )
    .returning();
  if (!row) throw new CiaoError("AUTH_FORBIDDEN");
  return row;
}

/**
 * Check submitted answers against the questions that were asked.
 *
 * Returns the answers to snapshot, or throws on a missing required one. The
 * prompt text is copied in beside the answer deliberately: a partner reading
 * "نعم" six months later needs to know what the question was, and the question
 * may since have been edited or retired.
 */
export async function collectIntakeAnswers(
  partnerId: string,
  serviceId: string | null,
  submitted: { questionId: string; answer: string }[],
): Promise<{ questionId: string; promptAr: string; answer: string }[]> {
  const questions = await listIntake(partnerId, serviceId);
  const given = new Map(submitted.map((s) => [s.questionId, String(s.answer ?? "").trim()]));
  const out: { questionId: string; promptAr: string; answer: string }[] = [];
  for (const q of questions) {
    const answer = given.get(q.id) ?? "";
    if (q.required && !answer)
      throw new CiaoError("VALIDATION", { field: `intake:${q.id}`, prompt: q.promptAr });
    if (answer) out.push({ questionId: q.id, promptAr: q.promptAr, answer: answer.slice(0, 500) });
  }
  return out;
}

// ══════════════════════════════════ expenses ════════════════════════════════

export interface ExpenseInput {
  day: string;
  labelAr: string;
  amount: number;
  category?: string;
  jobId?: string | null;
  recurring?: string | null;
  recurringUntil?: string | null;
  notesAr?: string | null;
}

export async function listExpenses(partnerId: string, from: string, to: string) {
  return db
    .select()
    .from(schema.partnerExpenses)
    .where(
      and(
        eq(schema.partnerExpenses.partnerId, partnerId),
        sql`${schema.partnerExpenses.day} between ${from} and ${to}`,
      ),
    )
    .orderBy(desc(schema.partnerExpenses.day));
}

export async function createExpense(partnerId: string, actorId: string, input: ExpenseInput) {
  if (!input.labelAr?.trim()) throw new CiaoError("VALIDATION", { field: "labelAr" });
  if (!input.day) throw new CiaoError("VALIDATION", { field: "day" });
  if (input.category && !isExpenseCategory(input.category))
    throw new CiaoError("VALIDATION", { field: "category" });
  const [row] = await db
    .insert(schema.partnerExpenses)
    .values({
      partnerId,
      jobId: input.jobId ?? null,
      day: input.day,
      labelAr: input.labelAr.trim(),
      category: input.category ?? "other",
      amount: Math.max(0, Math.round(input.amount ?? 0)),
      recurring: input.recurring ?? null,
      recurringUntil: input.recurringUntil ?? null,
      notesAr: input.notesAr ?? null,
      createdById: actorId,
    })
    .returning();
  return row!;
}

export async function deleteExpense(partnerId: string, id: string) {
  const [row] = await db
    .delete(schema.partnerExpenses)
    .where(and(eq(schema.partnerExpenses.id, id), eq(schema.partnerExpenses.partnerId, partnerId)))
    .returning();
  if (!row) throw new CiaoError("AUTH_FORBIDDEN");
  return row;
}

/**
 * Revenue minus costs, by month — the number nobody in this market can
 * currently produce about their own business.
 *
 * Revenue counts jobs that actually happened (`done`) plus confirmed work in
 * the window, because a partner planning next month needs the confirmed
 * column too. Both are labelled, never summed into one figure that means
 * neither.
 *
 * Recurring expenses are expanded across the window on read rather than
 * written as rows, so a partner who enters "rent, 800 a month" once does not
 * end up with a table they have to maintain — and changing the amount changes
 * it everywhere, which is what they expect a rent line to do.
 */
export async function profitAndLoss(partnerId: string, from: string, to: string) {
  const jobs = await db
    .select({
      month: sql<string>`to_char(${schema.partnerJobs.day}, 'YYYY-MM')`,
      status: schema.partnerJobs.status,
      source: schema.partnerJobs.source,
      revenue: sql<string>`coalesce(sum(${schema.partnerJobs.price}), 0)`,
      collected: sql<string>`coalesce(sum(${schema.partnerJobs.amountPaid}), 0)`,
      n: sql<string>`count(*)`,
    })
    .from(schema.partnerJobs)
    .where(
      and(
        eq(schema.partnerJobs.partnerId, partnerId),
        sql`${schema.partnerJobs.day} between ${from} and ${to}`,
        sql`${schema.partnerJobs.status} in ('confirmed','done')`,
      ),
    )
    .groupBy(sql`1`, schema.partnerJobs.status, schema.partnerJobs.source);

  const expenses = await listExpenses(partnerId, from, to);
  const recurring = await db
    .select()
    .from(schema.partnerExpenses)
    .where(
      and(
        eq(schema.partnerExpenses.partnerId, partnerId),
        sql`${schema.partnerExpenses.recurring} is not null`,
        sql`${schema.partnerExpenses.day} <= ${to}`,
      ),
    );

  const months = new Map<
    string,
    { revenue: number; confirmed: number; collected: number; costs: number; jobs: number }
  >();
  const month = (m: string) =>
    months.get(m) ??
    months.set(m, { revenue: 0, confirmed: 0, collected: 0, costs: 0, jobs: 0 }).get(m)!;

  for (const j of jobs) {
    const m = month(j.month);
    const revenue = Number(j.revenue);
    if (j.status === "done") m.revenue += revenue;
    else m.confirmed += revenue;
    m.collected += Number(j.collected);
    m.jobs += Number(j.n);
  }

  const byCategory = new Map<string, number>();
  for (const e of expenses) {
    if (e.recurring) continue; // counted below, expanded
    month(e.day.slice(0, 7)).costs += e.amount;
    byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount);
  }
  for (const e of recurring) {
    for (const m of monthsBetween(from, to)) {
      if (m < e.day.slice(0, 7)) continue;
      if (e.recurringUntil && m > e.recurringUntil.slice(0, 7)) continue;
      const amount = e.recurring === "weekly" ? e.amount * 4 : e.amount;
      month(m).costs += amount;
      byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + amount);
    }
  }

  const rows = [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([m, v]) => ({ month: m, ...v, profit: v.revenue - v.costs }));

  return {
    months: rows,
    totals: rows.reduce(
      (acc, r) => ({
        revenue: acc.revenue + r.revenue,
        confirmed: acc.confirmed + r.confirmed,
        collected: acc.collected + r.collected,
        costs: acc.costs + r.costs,
        profit: acc.profit + r.profit,
        jobs: acc.jobs + r.jobs,
      }),
      { revenue: 0, confirmed: 0, collected: 0, costs: 0, profit: 0, jobs: 0 },
    ),
    byCategory: [...byCategory.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount),
  };
}

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
  const end = new Date(`${to.slice(0, 7)}-01T00:00:00Z`);
  for (let i = 0; cursor <= end && i < 120; i++) {
    out.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}
