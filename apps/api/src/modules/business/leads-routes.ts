/**
 * Partner interest — the public invitation, and the ops queue behind it.
 *
 * Two audiences in one module because they are one flow: the marketplace's
 * «اعرض مكانك» button writes a row here, and the business console works it.
 * Splitting them across files would hide the fact that the public route's job
 * is to protect the console's queue from being worth ignoring.
 *
 * The public route is the interesting one. It is unauthenticated by necessity
 * — the whole point is a hall owner who has never signed in to anything — and
 * that makes it the most abusable endpoint on the API. Three things hold it up:
 *
 *  - **A verified phone, not a claimed one.** The caller must present a live
 *    one-time code for the number they are leaving. Ops is going to ring this
 *    number; a queue where half the numbers are invented is a queue nobody
 *    works.
 *  - **The number is the identity.** `phone` is unique, so tapping the button
 *    twice does not produce two agent visits. A repeat submission updates the
 *    name and touches `lastSeenAt` — someone coming back a second time is
 *    information, not noise — and answers exactly as a first one does. It must
 *    not be possible to learn from this endpoint whether a number is already
 *    on the list.
 *  - **Rate limits matching the OTP routes.** There is no point holding the
 *    submit route to 10 per 10 minutes if the code that unlocks it can be
 *    requested faster; both sit at the same ceiling as sign-in.
 *
 * Note what is not collected: no venue name, no city, no photographs. An agent
 * gets all of that on the visit (§14.2), and a longer form is a form that gets
 * abandoned on a phone at eleven at night, which is exactly when this button
 * gets pressed.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { isValidPhoneInput, normalizePhone } from "@ciao/shared";
import { db, schema } from "../../db/client.js";
import { CiaoError } from "../../lib/errors.js";
import { consumeOtp } from "../auth/routes.js";
import { track } from "../intelligence/events.js";
import { bizGuard } from "./guards.js";

const phoneSchema = z
  .string()
  .refine(isValidPhoneInput, "invalid phone")
  .transform(normalizePhone);

/** The states a lead moves through. Ops-facing, so they are ops' words. */
const LEAD_STATUSES = ["new", "contacted", "visiting", "onboarded", "declined"] as const;
type LeadStatus = (typeof LEAD_STATUSES)[number];

export async function partnerLeadRoutes(app: FastifyInstance) {
  /**
   * Leave a name and a number. Public.
   *
   * The code comes from `POST /v1/auth/otp/request`, unchanged — that route
   * already issues a challenge without touching the users table, so a lead
   * never becomes an account as a side effect of being interested.
   */
  app.post("/v1/partner-leads", {
    config: { rateLimit: { max: 10, timeWindow: "10 minutes" } },
    handler: async (req, reply) => {
      const body = z
        .object({
          name: z.string().trim().min(2).max(80),
          phone: phoneSchema,
          code: z.string().length(6),
          surface: z.enum(["home", "about", "listing"]).default("home"),
          locale: z.enum(["ar", "en"]).default("ar"),
        })
        .parse(req.body);

      await consumeOtp(body.phone, body.code);

      /*
       * One statement, so two taps that race each other cannot both insert.
       * The unique index on `phone` is what makes this safe; without the
       * conflict clause the second tap would surface a database error to
       * someone who has done nothing wrong.
       */
      const [row] = await db
        .insert(schema.partnerLeads)
        .values({
          name: body.name,
          phone: body.phone,
          surface: body.surface,
          locale: body.locale,
        })
        .onConflictDoUpdate({
          target: schema.partnerLeads.phone,
          set: { name: body.name, lastSeenAt: new Date() },
        })
        .returning({ id: schema.partnerLeads.id, createdAt: schema.partnerLeads.createdAt });

      /*
       * The shape of the interest, never the identity of it (intelligence
       * guardrail 2). Which invitation was tapped and in which language is
       * what tells us whether the home-page block earns its space; the name
       * and the number belong in the table, under RBAC, and nowhere else.
       */
      track("lead.submitted", { surface: body.surface, locale: body.locale }, { source: "api" });

      // Deliberately identical whether this was an insert or an update.
      return reply.status(201).send({ ok: true, id: row!.id });
    },
  });

  /**
   * The queue. `catalogue`-capable, because a lead is supply before it is
   * anything else, and supply is what the catalogue tab is for. Finance has no
   * reason to hold a list of names and phone numbers.
   */
  app.get("/v1/biz/leads", async (req, reply) => {
    await bizGuard(req, "catalogue");
    const q = z
      .object({ status: z.enum(LEAD_STATUSES).optional() })
      .parse(req.query ?? {});

    const rows = await db
      .select({
        id: schema.partnerLeads.id,
        name: schema.partnerLeads.name,
        phone: schema.partnerLeads.phone,
        surface: schema.partnerLeads.surface,
        locale: schema.partnerLeads.locale,
        status: schema.partnerLeads.status,
        note: schema.partnerLeads.note,
        claimedById: schema.partnerLeads.claimedById,
        claimedByName: schema.users.displayName,
        claimedAt: schema.partnerLeads.claimedAt,
        lastSeenAt: schema.partnerLeads.lastSeenAt,
        createdAt: schema.partnerLeads.createdAt,
      })
      .from(schema.partnerLeads)
      .leftJoin(schema.users, eq(schema.users.id, schema.partnerLeads.claimedById))
      .where(q.status ? eq(schema.partnerLeads.status, q.status) : undefined)
      .orderBy(desc(schema.partnerLeads.createdAt))
      .limit(500);

    /*
     * Counts come from the database rather than from `rows`, so the tab badge
     * stays right when the list is filtered or runs past its limit.
     */
    const counts = await db
      .select({ status: schema.partnerLeads.status, n: sql<number>`count(*)::int` })
      .from(schema.partnerLeads)
      .groupBy(schema.partnerLeads.status);

    return reply.send({
      items: rows,
      counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
    });
  });

  /**
   * Work a lead: take it, move it along, write down what was said.
   *
   * Claiming is first-write-wins rather than last — two agents opening the
   * queue at nine in the morning must not both ring the same owner, and the
   * one who got there second should be told, not silently overruled.
   */
  app.patch("/v1/biz/leads/:id", async (req, reply) => {
    const ctx = await bizGuard(req, "catalogue");
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        status: z.enum(LEAD_STATUSES).optional(),
        note: z.string().max(2000).nullable().optional(),
        claim: z.boolean().optional(),
      })
      .parse(req.body);

    const [lead] = await db
      .select()
      .from(schema.partnerLeads)
      .where(eq(schema.partnerLeads.id, id))
      .limit(1);
    if (!lead) throw new CiaoError("VALIDATION", "lead_not_found");

    if (body.claim === true) {
      const claimed = await db
        .update(schema.partnerLeads)
        .set({ claimedById: ctx.sub, claimedAt: new Date() })
        .where(and(eq(schema.partnerLeads.id, id), isNull(schema.partnerLeads.claimedById)))
        .returning({ id: schema.partnerLeads.id });
      if (claimed.length === 0 && lead.claimedById !== ctx.sub)
        throw new CiaoError("VALIDATION", "lead_already_claimed");
    } else if (body.claim === false) {
      // Releasing is always allowed: an agent going off shift should not need
      // an admin to hand the lead back.
      await db
        .update(schema.partnerLeads)
        .set({ claimedById: null, claimedAt: null })
        .where(eq(schema.partnerLeads.id, id));
    }

    const patch: Partial<{ status: LeadStatus; note: string | null }> = {};
    if (body.status !== undefined) patch.status = body.status;
    if (body.note !== undefined) patch.note = body.note;
    if (Object.keys(patch).length > 0) {
      await db
        .update(schema.partnerLeads)
        .set(patch)
        .where(eq(schema.partnerLeads.id, id));
    }

    // Module rule: every mutation audits.
    await db.insert(schema.auditLog).values({
      actorId: ctx.sub,
      action: "lead.updated",
      targetType: "partner_lead",
      targetId: id,
      detail: { ...patch, ...(body.claim === undefined ? {} : { claim: body.claim }) },
    });

    if (body.status) track("lead.status_changed", { status: body.status }, { source: "ops" });
    return reply.send({ ok: true });
  });
}
