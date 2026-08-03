/**
 * The console's window onto messaging.
 *
 * The day WhatsApp goes live, the questions ops asks daily — is the channel
 * healthy, what failed last night, did that partner get her invite — need a
 * screen, not a grep through server logs. This module answers them from the
 * delivery journal the ladder already writes.
 *
 * What is deliberately NOT here: credentials. The screen reports *whether*
 * each channel is wired (booleans), never the tokens themselves — a secret an
 * ops screen can display is a secret in the next screenshot.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { normalizePhone } from "@ciao/shared";
import { db, schema } from "../../db/client.js";
import { config } from "../../config.js";
import { notify } from "../messaging/service.js";
import { TEMPLATES } from "../messaging/templates.js";
import { getAllSettings } from "./settings.js";
import { bizGuard } from "./guards.js";

export async function bizMessagingRoutes(app: FastifyInstance) {
  /**
   * The journal and the health picture. `settings`-capable (ops and admin):
   * it is operational observability, in the same tier as reading the control
   * plane. Finance has no business in a message log — it contains phone
   * numbers and movement patterns, not money.
   */
  app.get("/v1/biz/messaging", async (req, reply) => {
    await bizGuard(req, "settings");
    const q = z
      .object({
        status: z.enum(["queued", "sent", "delivered", "failed", "skipped", "all"]).default("all"),
        channel: z.enum(["whatsapp", "sms", "voice", "all"]).default("all"),
        days: z.coerce.number().min(1).max(90).default(7),
        limit: z.coerce.number().min(1).max(200).default(60),
      })
      .parse(req.query);
    const since = new Date(Date.now() - q.days * 86400_000);

    const conditions = [eq(schema.messages.kind, "notify"), gte(schema.messages.createdAt, since)];
    if (q.status !== "all") conditions.push(eq(schema.messages.deliveryStatus, q.status));
    if (q.channel !== "all") conditions.push(eq(schema.messages.channel, q.channel));

    const journal = await db
      .select({
        id: schema.messages.id,
        templateKey: schema.messages.templateKey,
        channel: schema.messages.channel,
        toPhone: schema.messages.toPhone,
        deliveryStatus: schema.messages.deliveryStatus,
        deliveryDetail: schema.messages.deliveryDetail,
        ladderStep: schema.messages.ladderStep,
        sentAt: schema.messages.sentAt,
        createdAt: schema.messages.createdAt,
      })
      .from(schema.messages)
      .where(and(...conditions))
      .orderBy(desc(schema.messages.createdAt))
      .limit(q.limit);

    const byChannelStatus = await db
      .select({
        channel: schema.messages.channel,
        status: schema.messages.deliveryStatus,
        n: sql<string>`count(*)`,
      })
      .from(schema.messages)
      .where(and(eq(schema.messages.kind, "notify"), gte(schema.messages.createdAt, since)))
      .groupBy(schema.messages.channel, schema.messages.deliveryStatus);

    const byTemplate = await db
      .select({
        templateKey: schema.messages.templateKey,
        n: sql<string>`count(*)`,
        failed: sql<string>`count(*) filter (where ${schema.messages.deliveryStatus} = 'failed')`,
      })
      .from(schema.messages)
      .where(and(eq(schema.messages.kind, "notify"), gte(schema.messages.createdAt, since)))
      .groupBy(schema.messages.templateKey)
      .orderBy(desc(sql`count(*)`))
      .limit(20);

    const settings = await getAllSettings();

    return reply.send({
      windowDays: q.days,
      /*
       * Presence booleans only. `provider: "console"` in production is itself
       * the headline finding — it means nothing is really being sent.
       */
      config: {
        provider: config.messagingProvider,
        whatsappConfigured: Boolean(config.whatsapp.token && config.whatsapp.phoneNumberId),
        smsConfigured: Boolean(config.sms.twilioSid && config.sms.twilioToken),
        smsSenderId: config.sms.senderId,
        templateSends: config.whatsapp.templateSends,
      },
      switches: {
        whatsappEnabled: settings["messaging.whatsappEnabled"],
        smsEnabled: settings["messaging.smsEnabled"],
        quietFromHour: settings["messaging.quietFromHour"],
        quietToHour: settings["messaging.quietToHour"],
      },
      stats: byChannelStatus.map((r) => ({
        channel: r.channel,
        status: r.status,
        n: Number(r.n),
      })),
      byTemplate: byTemplate.map((r) => ({
        templateKey: r.templateKey,
        n: Number(r.n),
        failed: Number(r.failed),
      })),
      journal,
    });
  });

  /**
   * Send a test message — the wiring check for a freshly configured channel.
   *
   * `govern`-gated and rate-limited: it produces real traffic to a real phone
   * on the company's sender identity. The reference code in the body ties the
   * message on the handset to the journal row on the screen.
   */
  app.post("/v1/biz/messaging/test", {
    config: { rateLimit: { max: 10, timeWindow: "10 minutes" } },
    handler: async (req, reply) => {
      const ctx = await bizGuard(req, "govern");
      const body = z
        .object({
          phone: z.string().min(6).max(24),
          locale: z.enum(["ar", "en"]).default("ar"),
        })
        .parse(req.body);
      const phone = normalizePhone(body.phone);
      const code = Math.random().toString(36).slice(2, 8).toUpperCase();

      await notify({
        templateKey: "test_message",
        toPhone: phone,
        locale: body.locale,
        vars: { code },
      });

      // Hand back what the ladder just journaled so the screen can show the
      // outcome (and the provider's error text on a failure) immediately.
      const rows = await db
        .select({
          channel: schema.messages.channel,
          deliveryStatus: schema.messages.deliveryStatus,
          deliveryDetail: schema.messages.deliveryDetail,
          ladderStep: schema.messages.ladderStep,
        })
        .from(schema.messages)
        .where(
          and(
            eq(schema.messages.toPhone, phone),
            eq(schema.messages.templateKey, "test_message"),
          ),
        )
        .orderBy(desc(schema.messages.createdAt))
        .limit(3);

      await db.insert(schema.auditLog).values({
        actorId: ctx.actorId,
        action: "messaging.test_sent",
        targetType: "phone",
        targetId: phone,
        detail: { code, attempts: rows.length },
      });
      return reply.send({ ok: true, code, attempts: rows.reverse() });
    },
  });

  /** The registered-template inventory the Meta submission doc is built from. */
  app.get("/v1/biz/messaging/templates", async (req, reply) => {
    await bizGuard(req, "settings");
    return reply.send({
      templateSends: config.whatsapp.templateSends,
      items: Object.values(TEMPLATES).map((t) => ({
        key: t.key,
        waName: `ciao_${t.key}`,
        critical: t.critical,
        ar: t.ar,
        en: t.en,
        smsAr: t.smsAr ?? null,
      })),
    });
  });
}
