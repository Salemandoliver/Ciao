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

export interface ChannelProvider {
  name: "whatsapp" | "sms" | "voice";
  send(toPhone: string, body: string): Promise<{ ok: boolean; detail?: string }>;
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

/** WhatsApp Cloud API provider (used when WHATSAPP_TOKEN present). */
const whatsappCloud: ChannelProvider = {
  name: "whatsapp",
  async send(toPhone, body) {
    const res = await fetch(
      `https://graph.facebook.com/v20.0/${config.whatsapp.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.whatsapp.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: toPhone.replace("+", ""),
          type: "text",
          text: { body },
        }),
      },
    );
    return { ok: res.ok, detail: res.ok ? undefined : await res.text() };
  },
};

function ladder(): ChannelProvider[] {
  if (config.messagingProvider === "console") {
    return [consoleProvider("whatsapp"), consoleProvider("sms")];
  }
  const steps: ChannelProvider[] = [];
  if (config.whatsapp.token) steps.push(whatsappCloud);
  steps.push(consoleProvider("sms")); // TODO: Twilio alphanumeric sender (one-way, §12.4)
  return steps;
}

/** Quiet hours (§13.5): 23:00–08:00 Africa/Tripoli, unless critical. */
function inQuietHours(now = new Date()): boolean {
  const tripoliHour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hour12: false,
      timeZone: "Africa/Tripoli",
    }).format(now),
  );
  return tripoliHour >= 23 || tripoliHour < 8;
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

  if (!template.critical && inQuietHours()) {
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

  let step = 0;
  for (const channel of ladder()) {
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
      const result = await channel.send(p.toPhone, body);
      await db
        .update(schema.messages)
        .set({
          deliveryStatus: result.ok ? "sent" : "failed",
          sentAt: result.ok ? new Date() : undefined,
        })
        .where(eqId(row!.id));
      if (result.ok) return; // ladder stops at first success
    } catch (e) {
      await db
        .update(schema.messages)
        .set({ deliveryStatus: "failed" })
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
