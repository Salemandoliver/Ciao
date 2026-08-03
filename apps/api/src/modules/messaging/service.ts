/**
 * Messaging fan-out — §12.4, §13.5.
 * Channel ladder: WhatsApp → one-way SMS → voice IVR → ops manual call.
 * Every send is journaled in `messages` with per-channel delivery tracking.
 * Providers are console stubs until BSP credentials exist (env-swappable).
 */
import { config } from "../../config.js";
import { db, schema } from "../../db/client.js";
import { render } from "./templates.js";
import { TEMPLATES } from "./templates.js";
import { getAllSettings } from "../business/settings.js";

/** Context a provider may need beyond the rendered body. */
export interface SendMeta {
  templateKey: string;
  locale: "ar" | "en";
  vars: Record<string, string>;
}

export interface ChannelProvider {
  name: "whatsapp" | "sms" | "voice";
  send(toPhone: string, body: string, meta: SendMeta): Promise<{ ok: boolean; detail?: string }>;
}

/** Dev/staging provider: logs to stdout so flows are fully exercisable. */
function consoleProvider(name: ChannelProvider["name"]): ChannelProvider {
  return {
    name,
    async send(toPhone, body) {
      console.log(`[msg:${name}] → ${toPhone}: ${body}`);
      return { ok: true };
    },
  };
}

/**
 * Variable names in the order they appear in a template body.
 *
 * Meta templates use positional placeholders — `{{1}}`, `{{2}}` — so the
 * parameters we send must line up with the body *of the language being sent*
 * (Arabic and English variants of one template may use the variables in a
 * different order). Deriving the order from the body is what keeps the code
 * and the registered template from drifting: both are generated from the same
 * string.
 */
export function templateVarOrder(body: string): string[] {
  const seen: string[] = [];
  for (const m of body.matchAll(/\{\{(\w+)\}\}/g)) {
    if (!seen.includes(m[1]!)) seen.push(m[1]!);
  }
  return seen;
}

/**
 * The Cloud API payload for one send.
 *
 * Template messages by default: free-form text only reaches someone who wrote
 * to us in the last 24 hours, and everything Ciao initiates arrives outside
 * that window. The registered template name is `ciao_<key>` (namespaced so it
 * cannot collide with anything else living in the same WhatsApp Business
 * Account), language `ar`/`en`, and positional parameters derived from the
 * same body string the registration doc was generated from.
 */
export function waPayload(toPhone: string, body: string, meta: SendMeta): Record<string, unknown> {
  const template = TEMPLATES[meta.templateKey];
  if (!config.whatsapp.templateSends || !template) {
    return { messaging_product: "whatsapp", to: toPhone, type: "text", text: { body } };
  }
  const source = meta.locale === "en" ? template.en : template.ar;
  const params = templateVarOrder(source).map((name) => ({
    type: "text",
    text: meta.vars[name] ?? "",
  }));
  return {
    messaging_product: "whatsapp",
    to: toPhone,
    type: "template",
    template: {
      name: `ciao_${meta.templateKey}`,
      language: { code: meta.locale },
      ...(params.length ? { components: [{ type: "body", parameters: params }] } : {}),
    },
  };
}

/** WhatsApp Cloud API provider (used when WHATSAPP_TOKEN present). */
const whatsappCloud: ChannelProvider = {
  name: "whatsapp",
  async send(toPhone, body, meta) {
    const res = await fetch(
      `https://graph.facebook.com/v20.0/${config.whatsapp.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.whatsapp.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(waPayload(toPhone.replace("+", ""), body, meta)),
      },
    );
    return { ok: res.ok, detail: res.ok ? undefined : await res.text() };
  },
};

/**
 * Twilio SMS — the one-way fallback rung (§12.4).
 *
 * Programmable Messaging's classic REST endpoint, form-encoded, basic auth.
 * The sender is the alphanumeric ID ("CIAO"): one-way by design, which is the
 * point — the SMS variant of every template is written to need no reply, and
 * an alphanumeric sender cannot receive one. Requires Libya enabled in the
 * account's Geo Permissions or Twilio answers 400 with error 21408.
 */
const twilioSms: ChannelProvider = {
  name: "sms",
  async send(toPhone, body) {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${config.sms.twilioSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(`${config.sms.twilioSid}:${config.sms.twilioToken}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: toPhone,
          From: config.sms.senderId,
          Body: body,
        }).toString(),
      },
    );
    return { ok: res.ok, detail: res.ok ? undefined : await res.text() };
  },
};

/**
 * The ladder for one send, built per call because the control plane can now
 * remove a rung at runtime: `messaging.whatsappEnabled` / `messaging.smsEnabled`
 * are the 11pm kill switches for a misbehaving channel, no deploy involved.
 * A disabled or unconfigured rung is skipped, not stubbed — in live mode a
 * console provider pretending to deliver would turn every outage invisible.
 */
export function ladder(settings: Record<string, unknown>): ChannelProvider[] {
  if (config.messagingProvider === "console") {
    return [consoleProvider("whatsapp"), consoleProvider("sms")];
  }
  const steps: ChannelProvider[] = [];
  if (config.whatsapp.token && settings["messaging.whatsappEnabled"] !== false)
    steps.push(whatsappCloud);
  if (config.sms.twilioSid && config.sms.twilioToken && settings["messaging.smsEnabled"] !== false)
    steps.push(twilioSms);
  return steps;
}

/** Quiet hours (§13.5): control-plane window in Africa/Tripoli, unless critical. */
export function inQuietHours(from: number, to: number, now = new Date()): boolean {
  const tripoliHour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hour12: false,
      timeZone: "Africa/Tripoli",
    }).format(now),
  );
  // The window may wrap midnight (23 → 8) or not (0 → 6). Equal ends = no window.
  if (from === to) return false;
  return from < to
    ? tripoliHour >= from && tripoliHour < to
    : tripoliHour >= from || tripoliHour < to;
}

export interface NotifyParams {
  templateKey: string;
  toPhone: string;
  toUserId?: string;
  bookingId?: string;
  locale?: "ar" | "en";
  vars: Record<string, string>;
}

/**
 * Fan-out: try ladder steps in order until one succeeds; journal every attempt.
 * Non-critical messages during quiet hours are journaled as skipped and
 * re-queued by the worker for the morning.
 */
export async function notify(p: NotifyParams): Promise<void> {
  const template = TEMPLATES[p.templateKey];
  const locale = p.locale ?? "ar";
  if (!template) throw new Error(`Unknown template ${p.templateKey}`);

  const settings = await getAllSettings();
  const quiet = inQuietHours(
    Number(settings["messaging.quietFromHour"] ?? 23),
    Number(settings["messaging.quietToHour"] ?? 8),
  );
  if (!template.critical && quiet) {
    await db.insert(schema.messages).values({
      bookingId: p.bookingId,
      kind: "notify",
      templateKey: p.templateKey,
      channel: "whatsapp",
      toUserId: p.toUserId,
      toPhone: p.toPhone,
      body: render(p.templateKey, locale, p.vars),
      deliveryStatus: "skipped",
    });
    await db.insert(schema.scheduledJobs).values({
      kind: "requeue_notification",
      refId: p.toUserId ?? null,
      runAt: nextMorning(),
      payload: p as unknown as Record<string, unknown>,
    });
    return;
  }

  const steps = ladder(settings);
  if (steps.length === 0) {
    /*
     * Every rung disabled or unconfigured. Journal the message as skipped so
     * the console's messaging screen shows exactly what did not go out and
     * why — the honest alternative to a stub provider "delivering" to a log
     * nobody reads.
     */
    await db.insert(schema.messages).values({
      bookingId: p.bookingId,
      kind: "notify",
      templateKey: p.templateKey,
      channel: "whatsapp",
      toUserId: p.toUserId,
      toPhone: p.toPhone,
      body: render(p.templateKey, locale, p.vars),
      deliveryStatus: "skipped",
    });
    return;
  }

  let step = 0;
  for (const channel of steps) {
    const variant = channel.name === "sms" ? "sms" : "full";
    const body = render(p.templateKey, locale, p.vars, variant);
    const [row] = await db
      .insert(schema.messages)
      .values({
        bookingId: p.bookingId,
        kind: "notify",
        templateKey: p.templateKey,
        channel: channel.name,
        toUserId: p.toUserId,
        toPhone: p.toPhone,
        body,
        deliveryStatus: "queued",
        ladderStep: step,
      })
      .returning();
    try {
      const result = await channel.send(p.toPhone, body, {
        templateKey: p.templateKey,
        locale,
        vars: p.vars,
      });
      await db
        .update(schema.messages)
        .set({
          deliveryStatus: result.ok ? "sent" : "failed",
          sentAt: result.ok ? new Date() : undefined,
          deliveryDetail: result.ok ? null : (result.detail ?? "").slice(0, 2000) || null,
        })
        .where(eqId(row!.id));
      if (result.ok) return; // ladder stops at first success
    } catch (e) {
      await db
        .update(schema.messages)
        .set({ deliveryStatus: "failed", deliveryDetail: String(e).slice(0, 2000) })
        .where(eqId(row!.id));
      console.error(`messaging: ${channel.name} failed`, e);
    }
    step++;
  }
}

function nextMorning(): Date {
  const d = new Date();
  d.setUTCHours(6, 5, 0, 0); // 08:05 Tripoli (UTC+2)
  if (d <= new Date()) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

import { eq } from "drizzle-orm";
function eqId(id: string) {
  return eq(schema.messages.id, id);
}
