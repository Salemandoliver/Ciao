/**
 * The evening agenda send.
 *
 * A separate file from the worker loop because the interesting logic is not
 * "run a job at a time", it is *which* partners are due right now and how to
 * avoid sending the same person their Thursday twice.
 *
 * The design rule: the message carries the whole day in its body, not just a
 * link. A partner reading this at 6pm during a power cut on a phone at 8%
 * should be able to plan tomorrow from the notification shade without opening
 * anything (§12.2, §12.4). The link is for when they want the phone numbers.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "../../db/client.js";
import { config } from "../../config.js";
import { notify } from "../messaging/service.js";
import { getSetting } from "../business/settings.js";
import { track } from "../intelligence/events.js";
import { agenda, syncBookingsToJobs } from "./service.js";

/** The hour in Tripoli right now — the clock a Libyan partner is reading. */
function tripoliHour(now = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hour12: false,
      timeZone: "Africa/Tripoli",
    }).format(now),
  );
}

/** Tomorrow's date in Tripoli, which is not always tomorrow in UTC. */
function tomorrowInTripoli(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Tripoli",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now.getTime() + 86_400_000));
  return parts;
}

/**
 * Send the agenda to every partner whose chosen hour has arrived and who has
 * not already had one today.
 *
 * The "already had one" check reads the message journal rather than a flag on
 * the profile, because the journal is the record that survives a redeploy
 * mid-sweep — and sending a partner their Thursday twice is the kind of small
 * indignity that makes a business turn notifications off.
 */
export async function sendDueAgendas(now = new Date()): Promise<number> {
  if (!(await getSetting("partner.agendaEnabled"))) return 0;

  const hour = tripoliHour(now);
  const day = tomorrowInTripoli(now);

  const partners = await db
    .select({
      partnerId: schema.partnerProfiles.userId,
      locale: schema.partnerProfiles.locale,
      phone: schema.users.phone,
      userLocale: schema.users.locale,
    })
    .from(schema.partnerProfiles)
    .innerJoin(schema.users, eq(schema.partnerProfiles.userId, schema.users.id))
    .where(
      and(
        eq(schema.partnerProfiles.agendaEnabled, true),
        eq(schema.partnerProfiles.agendaHour, hour),
        eq(schema.users.disabled, false),
      ),
    )
    .limit(500);

  // Midnight Tripoli, expressed as the instant the working day began — used to
  // ask "has this partner already had today's agenda".
  const dayStart = new Date(now.getTime());
  dayStart.setUTCHours(dayStart.getUTCHours() - 6);

  let sent = 0;
  for (const p of partners) {
    const [already] = await db
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.toUserId, p.partnerId),
          eq(schema.messages.templateKey, "partner_daily_agenda"),
          gte(schema.messages.createdAt, dayStart),
        ),
      )
      .limit(1);
    if (already) continue;

    await syncBookingsToJobs(p.partnerId);
    const [tomorrow] = await agenda(p.partnerId, day, 1);
    const jobs = tomorrow?.jobs.filter((j) => j.status === "confirmed" || j.status === "done") ?? [];

    /*
     * A quiet day gets no message. "You have nothing tomorrow" is not news,
     * it costs a WhatsApp conversation fee, and a channel that pings you to
     * say nothing happened is a channel you mute — which then costs us the
     * day that did matter.
     */
    if (jobs.length === 0) continue;

    const locale = (p.locale || p.userLocale) === "en" ? "en" : "ar";
    const lines = jobs
      .map((j) => {
        const time = j.startTime ? `${j.startTime} ` : "";
        const who = j.clientNameAr ? ` — ${j.clientNameAr}` : "";
        const where = j.locationAr ? ` (${j.locationAr})` : "";
        const owed =
          j.balanceDue > 0
            ? locale === "en"
              ? ` · ${Math.round(j.balanceDue / 1000)} LYD due`
              : ` · باقي ${Math.round(j.balanceDue / 1000)} د.ل`
            : "";
        return `• ${time}${j.titleAr}${who}${where}${owed}`;
      })
      .join("\n");

    await notify({
      templateKey: "partner_daily_agenda",
      toPhone: p.phone,
      toUserId: p.partnerId,
      locale,
      vars: {
        date: day,
        lines,
        summary:
          locale === "en"
            ? `${jobs.length} job(s)`
            : `${jobs.length} ${jobs.length === 1 ? "شغلة" : "شغلات"}`,
        link: `${config.webBaseUrl}/partner`,
      },
    }).catch(() => {
      /* one partner's failed send must not stop the sweep */
    });

    track(
      "partner.agenda_sent",
      { jobCount: jobs.length, channel: "ladder" },
      { userId: p.partnerId, source: "worker" },
    );
    sent++;
  }
  return sent;
}

/**
 * Warn partners whose free season is nearly over.
 *
 * Sent at ten days, not on the last day. A partner who discovers the charge
 * the morning it lands feels tricked even when they were told at signup, and
 * the whole subscription is built on the assumption that they trust the
 * numbers on this screen.
 */
export async function warnExpiringTrials(now = new Date()): Promise<number> {
  const soon = new Date(now.getTime() + 10 * 86_400_000);
  const rows = await db
    .select({
      partnerId: schema.partnerSubscriptions.partnerId,
      trialEndsAt: schema.partnerSubscriptions.trialEndsAt,
      price: schema.partnerSubscriptions.priceDirhams,
      phone: schema.users.phone,
      locale: schema.users.locale,
    })
    .from(schema.partnerSubscriptions)
    .innerJoin(schema.users, eq(schema.partnerSubscriptions.partnerId, schema.users.id))
    .where(
      and(
        eq(schema.partnerSubscriptions.status, "trialing"),
        sql`${schema.partnerSubscriptions.trialEndsAt} between ${now} and ${soon}`,
      ),
    )
    .limit(200);

  let sent = 0;
  for (const r of rows) {
    const [already] = await db
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.toUserId, r.partnerId),
          eq(schema.messages.templateKey, "partner_plus_trial_ending"),
        ),
      )
      .limit(1);
    if (already) continue;

    const days = Math.max(
      1,
      Math.round(((r.trialEndsAt?.getTime() ?? now.getTime()) - now.getTime()) / 86_400_000),
    );
    await notify({
      templateKey: "partner_plus_trial_ending",
      toPhone: r.phone,
      toUserId: r.partnerId,
      locale: r.locale === "en" ? "en" : "ar",
      vars: {
        days: String(days),
        price: String(Math.round((r.price || 0) / 1000)),
        link: `${config.webBaseUrl}/partner?tab=insights`,
      },
    }).catch(() => {
      /* best effort */
    });
    sent++;
  }
  return sent;
}
