/**
 * Member accounts — everything a signed-up guest gets that a phone-number
 * booker does not.
 *
 * The governing rule: **signing up is never a toll gate.** A guest can search,
 * quote, book and arrive with a phone number and an OTP (§6.1). An account
 * adds a wallet, points, an inbox, passkeys and saved preferences on top. The
 * day a booking requires an account is the day we've made the product worse in
 * a market where half the people booking are doing it for their father.
 *
 * Money boundary (§15.4, and the reason the wallet is shaped this way): the
 * wallet is a *credit* balance — refunds, goodwill and redeemed points. Libya
 * has no e-money or escrow regime, so a balance customers top up with their own
 * cash is exactly what makes a marketplace look like an unlicensed
 * deposit-taker. Top-up is therefore built but gated behind a control-plane
 * flag that stays off until counsel clears it.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ProfileInputError,
  readProfile,
  saveProfile,
} from "./profile.js";
import {
  CHILD_BANDS,
  MAX_PARTY_ADULTS,
  MAX_PARTY_CHILDREN,
  MIN_AGE_YEARS,
  OCCASION_KINDS,
  PLANNED_EVENT_KINDS,
  type BirthDateProblem,
} from "./profile-data.js";

/** Why a birth date was refused, in words a member can act on. */
const BIRTH_DATE_MESSAGES: Record<"ar" | "en", Record<BirthDateProblem, string>> = {
  ar: {
    malformed: "التاريخ غير صحيح — اكتبه بصيغة يوم/شهر/سنة.",
    future: "تاريخ الميلاد لا يمكن أن يكون في المستقبل.",
    under_age: `الحجز في تشاو عقد يشمل عربونًا وعنوان المضيف، ولذلك يلزم أن يكون عمرك ${MIN_AGE_YEARS} سنة فأكثر. يمكن لأحد والديك الحجز نيابة عنك.`,
    implausible: "تأكد من سنة الميلاد — يبدو أن بها خطأ.",
  },
  en: {
    malformed: "That date doesn't look right — enter it as day/month/year.",
    future: "A date of birth can't be in the future.",
    under_age: `Booking on Ciao is a contract involving a deposit and a host's address, so you need to be ${MIN_AGE_YEARS} or over. A parent can book on your behalf.`,
    implausible: "Please check the year — it looks like a typo.",
  },
};
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "../../db/client.js";
import { CiaoError } from "../../lib/errors.js";
import { authenticate } from "../../lib/guards.js";
import { issueRefreshToken, signAccessToken } from "../../lib/auth.js";
import { config } from "../../config.js";
import { track } from "../intelligence/events.js";
import { notify } from "../messaging/service.js";
import { getSetting } from "../business/settings.js";
import {
  MIN_REDEEM_POINTS,
  POINT_RULES,
  POINT_TO_DIRHAM,
  awardPoints,
  claimReferral,
  ensureReferralCode,
  pointsBalance,
  pointsHistory,
  reasonLabel,
  redeemPoints,
  referralSummary,
} from "./loyalty.js";
import {
  PARTNER_CATEGORY_AR,
  issueVoucher,
  listPartners,
  myVouchers,
  redeemVoucher,
} from "./partners.js";
import { evaluatePromo, normalizePromoCode, rejectionMessage } from "./promos.js";
import { loyaltyConfig } from "./loyalty.js";
import {
  authenticationOptions,
  deletePasskey,
  listPasskeys,
  registrationOptions,
  verifyAuthentication,
  verifyRegistration,
} from "./passkeys.js";

const RAILS = ["sadad", "adfali", "local_card", "tlync", "cash"] as const;

export async function accountRoutes(app: FastifyInstance) {
  /** Preferences row is created lazily — an account without one still works. */
  async function preferences(userId: string) {
    const [row] = await db
      .select()
      .from(schema.userPreferences)
      .where(eq(schema.userPreferences.userId, userId))
      .limit(1);
    if (row) return row;
    const [created] = await db
      .insert(schema.userPreferences)
      .values({ userId })
      .onConflictDoNothing()
      .returning();
    return (
      created ??
      (
        await db
          .select()
          .from(schema.userPreferences)
          .where(eq(schema.userPreferences.userId, userId))
          .limit(1)
      )[0]!
    );
  }

  // ═══════════════════════════════════════════════════ 1. profile & membership
  /**
   * The whole member state in one call. The account screen is one of the few
   * places a user will open on a bad connection to check a balance, so it must
   * not be six requests (§12.3).
   */
  app.get("/v1/me/account", async (req, reply) => {
    const claims = await authenticate(req);
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, claims.sub))
      .limit(1);
    if (!user) throw new CiaoError("AUTH_REQUIRED");

    const prefs = await preferences(user.id);
    const [points, passkeys, unread] = await Promise.all([
      pointsBalance(user.id),
      listPasskeys(user.id),
      db
        .select({ n: sql<string>`count(*)` })
        .from(schema.messages)
        .where(and(eq(schema.messages.toUserId, user.id), isNull(schema.messages.readAt))),
    ]);

    return reply.send({
      id: user.id,
      phone: user.phone,
      displayName: user.displayName,
      publicName: user.publicName,
      email: user.email,
      emailVerified: Boolean(user.emailVerifiedAt),
      role: user.role,
      memberSince: user.createdAt,
      completedStays: user.completedStays,
      wallet: { creditBalance: user.creditBalance },
      loyalty: {
        points,
        // What the points are actually worth, so the number means something.
        worthDirhams: points * POINT_TO_DIRHAM,
        minRedeem: MIN_REDEEM_POINTS,
        rules: POINT_RULES,
      },
      preferences: {
        locale: prefs.locale,
        theme: prefs.theme,
        preferredRail: prefs.preferredRail,
        notifyWhatsapp: prefs.notifyWhatsapp,
        notifySms: prefs.notifySms,
        notifyInApp: prefs.notifyInApp,
        marketingOptIn: prefs.marketingOptIn,
        earlyAccessOptIn: prefs.earlyAccessOptIn,
        favouriteAreas: prefs.favouriteAreas,
      },
      passkeys: passkeys.length,
      unreadMessages: Number(unread[0]?.n ?? 0),
      // Declared profile — birth date, party shape, occasions. Returned in
      // full to its owner: everything we hold about their household should be
      // visible to them on one screen, which is also the design constraint
      // that keeps us from holding more than belongs there.
      profile: await readProfile(claims.sub),
    });
  });

  app.patch("/v1/me/profile", async (req, reply) => {
    const claims = await authenticate(req);
    const body = z
      .object({
        displayName: z.string().min(2).max(80).optional(),
        // §11.5 — what the public sees. Defaults to initials for a reason;
        // a guest may set it but we never widen it on their behalf.
        publicName: z.string().max(24).optional(),
      })
      .parse(req.body);
    await db
      .update(schema.users)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(schema.users.id, claims.sub));
    return reply.send({ ok: true });
  });

  /**
   * The declared profile — date of birth, who usually travels with you, the
   * months that matter.
   *
   * Every field is optional and every field pays. That is deliberate: a
   * required date of birth on a phone-first signup returns 01/01/1990 in bulk,
   * and a birthday campaign that fires on one day for a third of the base is
   * worse than none, because it is visibly fake. Points buy true answers;
   * mandatory fields buy filled boxes.
   *
   * What this endpoint will not accept is as important as what it will. There
   * is no field for a spouse, a child's name, a gender or an exact age — see
   * profile-data.ts for why a party profile is the right shape and a family
   * register is not.
   */
  app.patch("/v1/me/declared-profile", async (req, reply) => {
    const claims = await authenticate(req);
    const body = z
      .object({
        birthDate: z.string().max(10).nullable().optional(),
        party: z
          .object({
            adults: z.number().int().min(1).max(MAX_PARTY_ADULTS),
            children: z.number().int().min(0).max(MAX_PARTY_CHILDREN).optional(),
            bands: z.array(z.enum(CHILD_BANDS)).max(3).optional(),
          })
          .nullable()
          .optional(),
        occasions: z
          .array(z.object({ kind: z.enum(OCCASION_KINDS), month: z.number().int().min(1).max(12) }))
          .max(6)
          .optional(),
        plannedEvent: z
          .object({
            kind: z.enum(PLANNED_EVENT_KINDS),
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          })
          .nullable()
          .optional(),
      })
      .parse(req.body);

    try {
      const result = await saveProfile(claims.sub, body);
      return reply.send(result);
    } catch (e) {
      if (e instanceof ProfileInputError) {
        // Under-age is a real refusal with a real reason, not a validation
        // shrug — the message has to explain itself or the person just retypes
        // the same date. And it answers in the language of the request, like
        // every other error here: an English reader hitting an Arabic-only
        // refusal is stuck at exactly the point they most need to understand.
        const locale = (req.headers["accept-language"] ?? "ar").startsWith("en") ? "en" : "ar";
        return reply.status(422).send({
          error: {
            code: "CIAO-4001",
            message: BIRTH_DATE_MESSAGES[locale][e.problem],
            messageAr: BIRTH_DATE_MESSAGES.ar[e.problem],
            messageEn: BIRTH_DATE_MESSAGES.en[e.problem],
            field: "birthDate",
            problem: e.problem,
          },
        });
      }
      throw e;
    }
  });

  /**
   * Preferences. Everything here is *declared* — the intelligence layer's
   * first guardrail says enrichment must be explicit input, never inference,
   * and this endpoint is where that promise is kept.
   */
  app.patch("/v1/me/preferences", async (req, reply) => {
    const claims = await authenticate(req);
    const body = z
      .object({
        locale: z.enum(["ar", "en"]).optional(),
        theme: z.enum(["system", "light", "dark"]).optional(),
        preferredRail: z.enum(RAILS).nullable().optional(),
        notifyWhatsapp: z.boolean().optional(),
        notifySms: z.boolean().optional(),
        notifyInApp: z.boolean().optional(),
        marketingOptIn: z.boolean().optional(),
        earlyAccessOptIn: z.boolean().optional(),
        favouriteAreas: z.array(z.string().max(40)).max(10).optional(),
      })
      .parse(req.body);

    await preferences(claims.sub);
    await db
      .update(schema.userPreferences)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(schema.userPreferences.userId, claims.sub));

    // Keep the user row's locale in step — messaging templates read it there.
    if (body.locale)
      await db.update(schema.users).set({ locale: body.locale }).where(eq(schema.users.id, claims.sub));

    track("prefs.updated", { keys: Object.keys(body) }, { userId: claims.sub });
    return reply.send({ ok: true });
  });

  // ═══════════════════════════════════════════════════════ 2. email verification
  /**
   * Email is optional and secondary — phone is identity here. What email buys
   * is a channel that survives a lost SIM, which is why verifying it earns
   * points rather than being nagged for.
   */
  app.post("/v1/me/email", async (req, reply) => {
    const claims = await authenticate(req);
    const { email } = z.object({ email: z.string().email().max(160) }).parse(req.body);

    const [taken] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(and(eq(schema.users.email, email), sql`${schema.users.id} <> ${claims.sub}`))
      .limit(1);
    if (taken) throw new CiaoError("VALIDATION", "email_in_use");

    await db
      .update(schema.users)
      .set({ email, emailVerifiedAt: null, updatedAt: new Date() })
      .where(eq(schema.users.id, claims.sub));

    // Single-use, 24h token — the same mechanism as host-confirm links, not a
    // second bespoke one.
    const jti = randomUUID();
    await db.insert(schema.actionTokens).values({
      jti,
      scope: `verify_email:${claims.sub}`,
      userId: claims.sub,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    });
    const link = `${config.webBaseUrl}/account/verify-email?token=${jti}`;

    // No email provider is wired yet (launch gate 2 covers messaging), so the
    // link is logged and echoed in demo mode rather than silently going
    // nowhere and leaving the user waiting for a mail that never comes.
    const demo = await getSetting("ops.demoMode");
    app.log.info({ userId: claims.sub, link }, "email verification link");

    return reply.send({
      ok: true,
      sentTo: email,
      ...(demo ? { devLink: link } : {}),
      message: demo
        ? "الرابط ظاهر هنا في وضع العرض التجريبي — سيصلك بالبريد عند تفعيل خدمة الإرسال."
        : "أرسلنا رابط التوثيق إلى بريدك.",
    });
  });

  app.post("/v1/me/email/verify", async (req, reply) => {
    const { token } = z.object({ token: z.string().uuid() }).parse(req.body);
    const [row] = await db
      .select()
      .from(schema.actionTokens)
      .where(and(eq(schema.actionTokens.jti, token), isNull(schema.actionTokens.consumedAt)))
      .limit(1);
    if (!row || row.expiresAt < new Date() || !row.scope.startsWith("verify_email:"))
      throw new CiaoError("AUTH_REQUIRED", "link_expired");

    await db
      .update(schema.actionTokens)
      .set({ consumedAt: new Date() })
      .where(eq(schema.actionTokens.jti, token));
    await db
      .update(schema.users)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(schema.users.id, row.userId!));

    const earned = await awardPoints(row.userId!, "email_verified", row.userId!, "user");
    return reply.send({ ok: true, pointsEarned: earned });
  });

  // ═══════════════════════════════════════════════════════════════ 3. wallet
  /**
   * Wallet = platform credit, and every movement in it is a ledger posting.
   * We read the ledger rather than a balance column so the screen the customer
   * sees and the books the accountant closes are literally the same numbers.
   */
  app.get("/v1/me/wallet", async (req, reply) => {
    const claims = await authenticate(req);
    const account = `guest_credit:${claims.sub}`;

    const rows = await db
      .select({
        id: schema.ledgerEntries.id,
        debit: schema.ledgerEntries.debit,
        credit: schema.ledgerEntries.credit,
        memo: schema.ledgerEntries.memo,
        bookingId: schema.ledgerEntries.bookingId,
        createdAt: schema.ledgerEntries.createdAt,
      })
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.account, account))
      .orderBy(desc(schema.ledgerEntries.createdAt))
      .limit(100);

    // Credit-normal: credits add to the guest's balance, debits spend it.
    const balance = rows.reduce((s, r) => s + r.credit - r.debit, 0);
    const topUpEnabled = await getSetting("wallet.topUpEnabled");

    return reply.send({
      balance,
      topUpEnabled,
      transactions: rows.map((r) => ({
        id: r.id,
        amount: r.credit - r.debit, // signed, from the guest's point of view
        direction: r.credit > 0 ? "in" : "out",
        memo: r.memo,
        bookingId: r.bookingId,
        at: r.createdAt,
      })),
    });
  });

  /**
   * Top-up. Deliberately refuses while the control-plane flag is off.
   *
   * This is not caution theatre: holding customer cash without a licence is
   * the single biggest regulatory risk in the design (§15.4, risk #2), and it
   * is the founder's call plus a legal opinion to switch on — not a
   * developer's. The code path is here and tested so that flipping one setting
   * is all it takes on the day counsel clears it.
   */
  app.post("/v1/me/wallet/top-up", async (req, reply) => {
    const claims = await authenticate(req);
    if (!(await getSetting("wallet.topUpEnabled")))
      throw new CiaoError("VALIDATION", "top_up_not_available_yet");

    const { amount, rail } = z
      .object({
        amount: z.number().int().min(10_000).max(5_000_000), // 10–5,000 LYD
        rail: z.enum(RAILS),
      })
      .parse(req.body);

    track("wallet.topup_started", { amount, rail }, { userId: claims.sub });
    return reply.status(202).send({
      ok: true,
      // The real implementation routes through the same PaymentProvider
      // abstraction as deposits — one payments path, never a second one.
      next: "payment_intent",
      amount,
      rail,
    });
  });

  // ═══════════════════════════════════════════════════════ 4. points & referrals
  app.get("/v1/me/points", async (req, reply) => {
    const claims = await authenticate(req);
    const [balance, history] = await Promise.all([
      pointsBalance(claims.sub),
      pointsHistory(claims.sub),
    ]);
    return reply.send({
      balance,
      worthDirhams: balance * POINT_TO_DIRHAM,
      minRedeem: MIN_REDEEM_POINTS,
      rules: POINT_RULES,
      history: history.map((h) => ({
        delta: h.delta,
        reason: h.reason,
        label: h.memoAr ?? reasonLabel(h.reason),
        at: h.createdAt,
      })),
    });
  });

  app.post("/v1/me/points/redeem", async (req, reply) => {
    const claims = await authenticate(req);
    const { points } = z.object({ points: z.number().int().min(1) }).parse(req.body);
    return reply.send(await redeemPoints(claims.sub, points));
  });

  app.get("/v1/me/referrals", async (req, reply) => {
    const claims = await authenticate(req);
    const summary = await referralSummary(claims.sub);
    return reply.send({
      ...summary,
      shareUrl: `${config.webBaseUrl}/?ref=${summary.code}`,
      // Pre-written so every invite reads the same and nobody has to compose
      // one — this is shared over WhatsApp, not email.
      shareTextAr: `جرّب تشاو لحجز الشاليهات وقاعات الأفراح في ليبيا — أماكن مفحوصة ميدانيًا وحجز بعربون بسيط. استخدم كودي ${summary.code}: ${config.webBaseUrl}/?ref=${summary.code}`,
    });
  });

  app.post("/v1/me/referrals/claim", async (req, reply) => {
    const claims = await authenticate(req);
    const { code } = z.object({ code: z.string().min(4).max(16) }).parse(req.body);
    return reply.send(await claimReferral(claims.sub, code));
  });

  // ═══════════════════════════════════════════════════════════════ 5. inbox
  /**
   * In-app messages from hosts, providers and Ciao itself. WhatsApp remains
   * the channel that actually reaches people here; the inbox is the durable
   * record of what was said, which matters when a dispute needs evidence
   * (§11.6) and when a phone has been wiped.
   */
  app.get("/v1/me/messages", async (req, reply) => {
    const claims = await authenticate(req);
    const rows = await db
      .select({
        id: schema.messages.id,
        bookingId: schema.messages.bookingId,
        kind: schema.messages.kind,
        body: schema.messages.body,
        maskedBody: schema.messages.maskedBody,
        fromUserId: schema.messages.fromUserId,
        readAt: schema.messages.readAt,
        createdAt: schema.messages.createdAt,
        fromName: schema.users.displayName,
        bookingCode: schema.bookings.code,
      })
      .from(schema.messages)
      .leftJoin(schema.users, eq(schema.messages.fromUserId, schema.users.id))
      .leftJoin(schema.bookings, eq(schema.messages.bookingId, schema.bookings.id))
      .where(eq(schema.messages.toUserId, claims.sub))
      .orderBy(desc(schema.messages.createdAt))
      .limit(100);

    return reply.send({
      unread: rows.filter((r) => !r.readAt).length,
      items: rows.map((r) => ({
        id: r.id,
        // §8.7 — the masked body is what exists before a deposit is paid.
        body: r.maskedBody ?? r.body,
        kind: r.kind,
        from: r.fromName ?? "تشاو",
        bookingCode: r.bookingCode,
        read: Boolean(r.readAt),
        at: r.createdAt,
      })),
    });
  });

  app.post("/v1/me/messages/read", async (req, reply) => {
    const claims = await authenticate(req);
    const { ids } = z.object({ ids: z.array(z.string().uuid()).max(200).optional() }).parse(
      req.body ?? {},
    );
    const where = ids?.length
      ? and(
          eq(schema.messages.toUserId, claims.sub),
          isNull(schema.messages.readAt),
          sql`${schema.messages.id} = any(${ids})`,
        )
      : and(eq(schema.messages.toUserId, claims.sub), isNull(schema.messages.readAt));
    await db.update(schema.messages).set({ readAt: new Date() }).where(where);
    return reply.send({ ok: true });
  });

  // ═══════════════════════════════════════════ 5b. partners & point vouchers
  /**
   * The partner directory. Public: a guest deciding whether membership is
   * worth anything should be able to see where points actually spend before
   * they sign up for anything.
   */
  app.get("/v1/partners", async (req, reply) => {
    const q = z
      .object({ city: z.string().max(40).optional(), venueId: z.string().uuid().optional() })
      .parse(req.query);
    const cfg = await loyaltyConfig();
    reply.header("cache-control", "public, max-age=120, stale-while-revalidate=600");
    return reply.send({
      enabled: cfg.enabled && cfg.partnersEnabled,
      pointToDirham: cfg.pointToDirham,
      voucherMinutes: cfg.voucherMinutes,
      categories: PARTNER_CATEGORY_AR,
      items: await listPartners(q),
    });
  });

  app.post("/v1/me/vouchers", async (req, reply) => {
    const claims = await authenticate(req);
    const { partnerId, value } = z
      .object({ partnerId: z.string().uuid(), value: z.number().int().min(1000) })
      .parse(req.body);
    const voucher = await issueVoucher(claims.sub, partnerId, value);
    track(
      "partner.voucher_issued",
      { partnerId, value, points: voucher.points },
      { userId: claims.sub },
    );
    return reply.status(201).send(voucher);
  });

  app.get("/v1/me/vouchers", async (req, reply) => {
    const claims = await authenticate(req);
    return reply.send({ items: await myVouchers(claims.sub) });
  });

  /**
   * The counter. Called by the partner's own account so a guest can never
   * mark their own voucher used and walk out with a coffee the café never
   * agreed to hand over.
   */
  app.post("/v1/partner/redeem", async (req, reply) => {
    const claims = await authenticate(req);
    const { code } = z.object({ code: z.string().min(4).max(12) }).parse(req.body);
    return reply.send(await redeemVoucher(code, claims.sub));
  });

  /** What the till sees: today's redemptions and what we owe so far. */
  app.get("/v1/partner/summary", async (req, reply) => {
    const claims = await authenticate(req);
    const [partner] = await db
      .select()
      .from(schema.partners)
      .where(eq(schema.partners.staffUserId, claims.sub))
      .limit(1);
    if (!partner) throw new CiaoError("AUTH_FORBIDDEN", "not_a_partner");

    const rows = await db
      .select({
        code: schema.partnerRedemptions.code,
        value: schema.partnerRedemptions.value,
        redeemedAt: schema.partnerRedemptions.redeemedAt,
        settledAt: schema.partnerRedemptions.settledAt,
      })
      .from(schema.partnerRedemptions)
      .where(
        and(
          eq(schema.partnerRedemptions.partnerId, partner.id),
          eq(schema.partnerRedemptions.status, "redeemed"),
        ),
      )
      .orderBy(desc(schema.partnerRedemptions.redeemedAt))
      .limit(100);

    return reply.send({
      partner: { id: partner.id, nameAr: partner.nameAr },
      // Unsettled value is what Ciao owes them right now.
      owed: rows.filter((r) => !r.settledAt).reduce((s, r) => s + r.value, 0),
      redemptions: rows,
    });
  });

  // ═══════════════════════════════════════════════════════════ 5c. promo codes
  /**
   * Check a code without committing to it. Read-only, so a checkout screen can
   * call it as the guest types without burning a redemption on a typo.
   */
  app.post("/v1/promos/check", async (req, reply) => {
    const claims = await authenticate(req);
    const body = z
      .object({
        code: z.string().min(2).max(24),
        total: z.number().int().min(0),
        commission: z.number().int().min(0),
        vertical: z.string().max(8).optional(),
        city: z.string().max(40).optional(),
        listingId: z.string().uuid().optional(),
      })
      .parse(req.body);
    try {
      const result = await evaluatePromo(normalizePromoCode(body.code), {
        userId: claims.sub,
        total: body.total,
        commission: body.commission,
        vertical: body.vertical,
        city: body.city,
        listingId: body.listingId,
      });
      return reply.send({
        valid: true,
        discount: result.discount,
        descriptionAr: result.descriptionAr,
        kind: result.kind,
      });
    } catch (e) {
      const reason = e instanceof CiaoError ? String(e.detail ?? "unknown") : "unknown";
      // A rejected code is a normal outcome at checkout, not an error state:
      // answer 200 with a reason the guest can act on.
      return reply.send({ valid: false, reason, messageAr: rejectionMessage(reason) });
    }
  });

  // ═════════════════════════════════════════════════════ 6. payment methods
  app.get("/v1/me/payment-methods", async (req, reply) => {
    const claims = await authenticate(req);
    const rows = await db
      .select()
      .from(schema.paymentMethods)
      .where(eq(schema.paymentMethods.userId, claims.sub));
    return reply.send({
      items: rows.map((r) => ({
        id: r.id,
        rail: r.rail,
        label: r.label,
        last4: r.last4,
        isDefault: r.isDefault,
      })),
    });
  });

  app.post("/v1/me/payment-methods", async (req, reply) => {
    const claims = await authenticate(req);
    const body = z
      .object({
        rail: z.enum(RAILS),
        label: z.string().max(60).optional(),
        // An opaque provider token, never a card number. Anything that looks
        // like a PAN is refused rather than quietly stored.
        providerToken: z.string().max(200).optional(),
        last4: z.string().regex(/^\d{4}$/).optional(),
        isDefault: z.boolean().default(false),
      })
      .parse(req.body);

    if (body.providerToken && /^\d{12,19}$/.test(body.providerToken.replace(/\s|-/g, "")))
      throw new CiaoError("VALIDATION", "looks_like_a_card_number");

    if (body.isDefault)
      await db
        .update(schema.paymentMethods)
        .set({ isDefault: false })
        .where(eq(schema.paymentMethods.userId, claims.sub));

    const [row] = await db
      .insert(schema.paymentMethods)
      .values({ ...body, userId: claims.sub })
      .returning();
    return reply.status(201).send({ id: row!.id });
  });

  app.delete("/v1/me/payment-methods/:id", async (req, reply) => {
    const claims = await authenticate(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await db
      .delete(schema.paymentMethods)
      .where(and(eq(schema.paymentMethods.id, id), eq(schema.paymentMethods.userId, claims.sub)));
    return reply.send({ ok: true });
  });

  // ══════════════════════════════════════════════════════════════ 7. passkeys
  app.post("/v1/me/passkeys/options", async (req, reply) => {
    const claims = await authenticate(req);
    return reply.send(await registrationOptions(claims.sub));
  });

  app.post("/v1/me/passkeys", async (req, reply) => {
    const claims = await authenticate(req);
    const body = z
      .object({ response: z.record(z.string(), z.unknown()), deviceLabel: z.string().max(60).optional() })
      .parse(req.body);
    const result = await verifyRegistration(
      claims.sub,
      body.response as never,
      body.deviceLabel,
    );
    track("passkey.registered", {}, { userId: claims.sub });
    return reply.status(201).send(result);
  });

  app.get("/v1/me/passkeys", async (req, reply) => {
    const claims = await authenticate(req);
    return reply.send({ items: await listPasskeys(claims.sub) });
  });

  app.delete("/v1/me/passkeys/:id", async (req, reply) => {
    const claims = await authenticate(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await deletePasskey(claims.sub, id);
    return reply.send({ ok: true });
  });

  /** Passwordless, message-less login — the whole point of passkeys here. */
  app.post("/v1/auth/passkey/options", async (_req, reply) => {
    return reply.send(await authenticationOptions());
  });

  app.post("/v1/auth/passkey/verify", async (req, reply) => {
    const body = z.object({ response: z.record(z.string(), z.unknown()) }).parse(req.body);
    const { userId } = await verifyAuthentication(body.response as never);

    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    if (!user || user.disabled) throw new CiaoError("AUTH_FORBIDDEN");

    const accessToken = await signAccessToken({
      sub: user.id,
      role: user.role as never,
      phone: user.phone,
    });
    const refreshToken = await issueRefreshToken(user.id);
    track("auth.passkey_login", {}, { userId: user.id });

    return reply.send({
      accessToken,
      refreshToken,
      user: { id: user.id, phone: user.phone, role: user.role, displayName: user.displayName },
    });
  });

  // ══════════════════════════════════════════════════════ 8. join & data rights
  /**
   * Turn a phone-only booker into a member. Idempotent: calling it twice
   * doesn't double the welcome points, because awardPoints keys on the user.
   */
  app.post("/v1/me/join", async (req, reply) => {
    const claims = await authenticate(req);
    const body = z
      .object({
        displayName: z.string().min(2).max(80).optional(),
        email: z.string().email().max(160).optional(),
        referralCode: z.string().min(4).max(16).optional(),
        marketingOptIn: z.boolean().optional(),
      })
      .parse(req.body ?? {});

    if (body.displayName || body.email)
      await db
        .update(schema.users)
        .set({
          ...(body.displayName ? { displayName: body.displayName } : {}),
          ...(body.email ? { email: body.email, emailVerifiedAt: null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.users.id, claims.sub));

    await preferences(claims.sub);
    if (body.marketingOptIn !== undefined)
      await db
        .update(schema.userPreferences)
        .set({ marketingOptIn: body.marketingOptIn })
        .where(eq(schema.userPreferences.userId, claims.sub));

    let referral: string | null = null;
    if (body.referralCode) {
      try {
        await claimReferral(claims.sub, body.referralCode);
        referral = body.referralCode.toUpperCase();
      } catch {
        // A bad invite code must never block someone from joining.
      }
    }

    const earned = await awardPoints(claims.sub, "signup", claims.sub, "user");
    const code = await ensureReferralCode(claims.sub);
    track("account.joined", { withReferral: Boolean(referral) }, { userId: claims.sub });

    return reply.status(201).send({
      ok: true,
      pointsEarned: earned,
      referralCode: code,
      claimedReferral: referral,
    });
  });

  /**
   * Data export and deletion. Law 6/2022 carries data-protection duties and
   * our own About page promises we don't hoard — a promise with no button
   * behind it is just copy.
   */
  app.get("/v1/me/export", async (req, reply) => {
    const claims = await authenticate(req);
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, claims.sub)).limit(1);
    const [bookings, reviews, points, prefs, wallet] = await Promise.all([
      db.select().from(schema.bookings).where(eq(schema.bookings.guestId, claims.sub)),
      db.select().from(schema.reviews).where(eq(schema.reviews.authorId, claims.sub)),
      pointsHistory(claims.sub, 500),
      preferences(claims.sub),
      db
        .select()
        .from(schema.ledgerEntries)
        .where(eq(schema.ledgerEntries.account, `guest_credit:${claims.sub}`)),
    ]);
    reply.header("content-disposition", 'attachment; filename="ciao-my-data.json"');
    return reply.send({ user, preferences: prefs, bookings, reviews, points, wallet });
  });

  app.post("/v1/me/close", async (req, reply) => {
    const claims = await authenticate(req);
    // An account with money or a live booking cannot be closed silently —
    // that would strand somebody's balance or a host's Thursday.
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, claims.sub)).limit(1);
    if ((user?.creditBalance ?? 0) > 0) throw new CiaoError("VALIDATION", "wallet_not_empty");
    const [live] = await db
      .select({ id: schema.bookings.id })
      .from(schema.bookings)
      .where(
        and(
          eq(schema.bookings.guestId, claims.sub),
          or(
            eq(schema.bookings.state, "confirmed"),
            eq(schema.bookings.state, "payment_held"),
            eq(schema.bookings.state, "checked_in"),
          ),
        ),
      )
      .limit(1);
    if (live) throw new CiaoError("VALIDATION", "active_booking_exists");

    await db
      .update(schema.users)
      .set({ disabled: true, email: null, updatedAt: new Date() })
      .where(eq(schema.users.id, claims.sub));
    // Derived state is safe to drop outright (intelligence guardrail 5).
    await db.delete(schema.userProfiles).where(eq(schema.userProfiles.userId, claims.sub));
    await db.delete(schema.webauthnCredentials).where(eq(schema.webauthnCredentials.userId, claims.sub));
    return reply.send({ ok: true });
  });

  void notify; // messaging is wired per-event elsewhere; kept for future sends
}
