/**
 * Commands a partner can send from WhatsApp or SMS.
 *
 * §9.5 sketched this — "احجب 12-15/8" parsed into calendar writes — and it is
 * the most important thing in the whole console, because of who the user is.
 * Haj Mustafa has six chalets and a notebook. He will not open a dashboard. He
 * answers WhatsApp within minutes, every time, and has done for ten years.
 * Meeting him there is not a convenience feature; it is the difference between
 * a calendar that is maintained and one that is fiction.
 *
 * Three design decisions worth stating:
 *
 * **It reads Libyan Arabic, not a command syntax.** Nobody is going to learn
 * `/block --from --to`. People write «احجب من ١٢ لـ ١٥ أغسطس», or «مشغول
 * الخميس», or just «اليوم». So the parser is forgiving in the ways real
 * messages are messy — Arabic-Indic digits, Arabic and English month names,
 * `/` and `-` and `.` as separators, a year that is usually missing — and
 * refuses clearly when it genuinely cannot tell what was meant. A parser that
 * guesses wrong here blocks a chalet for a month.
 *
 * **A date with no year means the next one.** "احجب 15/8" in December means
 * next August, not last. Assuming the past is the failure mode that produces a
 * silent no-op, and a partner who thinks they blocked a date they did not.
 *
 * **Every command answers in words, with what changed.** Never "OK". A partner
 * who blocked four days should be told four days, and told which. That reply
 * is the only receipt they get.
 */
import { normalizePhone } from "@ciao/shared";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../../db/client.js";
import { blockDays, openDays } from "../calendar/service.js";
import { track } from "../intelligence/events.js";
import { agenda, ensureProfile } from "./service.js";
import { partnerListingIds } from "./guards.js";

export type CommandKind = "block" | "open" | "agenda" | "help" | "unknown";

export interface ParsedCommand {
  kind: CommandKind;
  days: string[];
  /** Echoed back so the reply can say what we understood, not just what we did. */
  raw: string;
}

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const EASTERN_ARABIC = "۰۱۲۳۴۵۶۷۸۹";

function westernDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(EASTERN_ARABIC.indexOf(d)));
}

/**
 * Month names as people actually write them here — Libyan Arabic uses the
 * Western month names (أغسطس, not آب), and half of messages use the English
 * ones because that is what the phone keyboard offers.
 */
const MONTHS: Record<string, number> = {
  يناير: 1, jan: 1, january: 1,
  فبراير: 2, feb: 2, february: 2,
  مارس: 3, mar: 3, march: 3,
  أبريل: 4, ابريل: 4, apr: 4, april: 4,
  مايو: 5, may: 5,
  يونيو: 6, jun: 6, june: 6,
  يوليو: 7, jul: 7, july: 7,
  أغسطس: 8, اغسطس: 8, aug: 8, august: 8,
  سبتمبر: 9, sep: 9, sept: 9, september: 9,
  أكتوبر: 10, اكتوبر: 10, oct: 10, october: 10,
  نوفمبر: 11, nov: 11, november: 11,
  ديسمبر: 12, dec: 12, december: 12,
};

const BLOCK_WORDS = ["احجب", "أحجب", "احجز", "مشغول", "اقفل", "أقفل", "block", "busy", "close"];
const OPEN_WORDS = ["افتح", "أفتح", "فاضي", "شاغر", "open", "free", "available"];
const AGENDA_WORDS = ["اليوم", "برنامج", "جدول", "شنو عندي", "today", "agenda", "schedule"];
const HELP_WORDS = ["مساعدة", "help", "?", "؟", "اوامر", "أوامر"];

/**
 * Turn a real message into dates.
 *
 * `today` is injected rather than read from the clock so the year-rollover
 * behaviour is testable — a parser whose correctness depends on what month it
 * is when you run the suite is a parser nobody trusts in December.
 */
export function parseCommand(message: string, today = new Date()): ParsedCommand {
  const raw = message.trim();
  const text = westernDigits(raw.toLowerCase());

  const has = (words: string[]) => words.some((w) => text.includes(w));
  const kind: CommandKind = has(HELP_WORDS)
    ? "help"
    : has(BLOCK_WORDS)
      ? "block"
      : has(OPEN_WORDS)
        ? "open"
        : has(AGENDA_WORDS)
          ? "agenda"
          : "unknown";

  if (kind === "help" || kind === "agenda" || kind === "unknown") {
    return { kind, days: [], raw };
  }
  return { kind, days: extractDays(text, today), raw };
}

/**
 * Pull dates out of free text.
 *
 * Handles, in order of how often people write them:
 *   15/8, 15-8, 15.8, 2026-08-15
 *   من 12 إلى 15/8   (a range sharing one month)
 *   12-15/8          (the same range, written the way a notebook does)
 *   15 أغسطس, 15 aug
 * A bare number with no month attached is deliberately ignored: "احجب 15"
 * could be the 15th of this month or next, and blocking the wrong one is worse
 * than asking.
 *
 * Digit and case normalisation happens here rather than in the caller. It used
 * to live in `parseCommand`, which meant this function silently found no dates
 * in «١٥/٨» when called on its own — and a Libyan phone keyboard produces
 * Arabic-Indic digits by default, so that is not an edge case, it is most
 * messages. Normalising at the point of parsing makes the function correct for
 * every caller rather than for one.
 */
export function extractDays(input: string, today = new Date()): string[] {
  const text = westernDigits(input.toLowerCase());
  const days = new Set<string>();
  const add = (day: number, month: number, year?: number) => {
    if (day < 1 || day > 31 || month < 1 || month > 12) return;
    const y = year ?? nextOccurrenceYear(month, day, today);
    const date = new Date(Date.UTC(y, month - 1, day));
    // Rejects the 31st of a 30-day month rather than rolling it into the 1st
    // of the next, which is how "احجب 31/9" would otherwise block October.
    if (date.getUTCMonth() !== month - 1) return;
    days.add(date.toISOString().slice(0, 10));
  };

  // ISO dates first — unambiguous, so nothing else should get a chance at them.
  const isoRe = /(\d{4})-(\d{1,2})-(\d{1,2})/g;
  let m: RegExpExecArray | null;
  let rest = text;
  while ((m = isoRe.exec(text))) {
    add(Number(m[3]), Number(m[2]), Number(m[1]));
  }
  rest = rest.replace(isoRe, " ");

  // Ranges written as "12-15/8" or "من 12 الى 15/8" — one month, two days.
  const rangeRe = /(\d{1,2})\s*(?:-|–|إلى|الى|to|لـ|ل)\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})/g;
  while ((m = rangeRe.exec(rest))) {
    const from = Number(m[1]);
    const to = Number(m[2]);
    const month = Number(m[3]);
    if (to >= from && to - from < 62) {
      for (let d = from; d <= to; d++) add(d, month);
    }
  }
  rest = rest.replace(rangeRe, " ");

  // Ranges against a named month: "من 12 إلى 15 أغسطس".
  const namedRangeRe = new RegExp(
    `(\\d{1,2})\\s*(?:-|–|إلى|الى|to|لـ|ل)\\s*(\\d{1,2})\\s*(${Object.keys(MONTHS).join("|")})`,
    "g",
  );
  while ((m = namedRangeRe.exec(rest))) {
    const from = Number(m[1]);
    const to = Number(m[2]);
    const month = MONTHS[m[3]!]!;
    if (to >= from && to - from < 62) {
      for (let d = from; d <= to; d++) add(d, month);
    }
  }
  rest = rest.replace(namedRangeRe, " ");

  // Single day/month pairs: "15/8", "15-8", "15.8".
  const pairRe = /(\d{1,2})\s*[/\-.]\s*(\d{1,2})(?!\d)/g;
  while ((m = pairRe.exec(rest))) add(Number(m[1]), Number(m[2]));
  rest = rest.replace(pairRe, " ");

  // Named months: "15 أغسطس".
  const namedRe = new RegExp(`(\\d{1,2})\\s*(${Object.keys(MONTHS).join("|")})`, "g");
  while ((m = namedRe.exec(rest))) add(Number(m[1]), MONTHS[m[2]!]!);

  return [...days].sort();
}

/**
 * The year a bare day/month means: this one if it has not passed, otherwise
 * next. Writing "15/8" in December means next August every time.
 */
function nextOccurrenceYear(month: number, day: number, today: Date): number {
  const year = today.getUTCFullYear();
  const candidate = Date.UTC(year, month - 1, day);
  const startOfToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return candidate >= startOfToday ? year : year + 1;
}

// ---------------------------------------------------------------- execution
export interface CommandResult {
  kind: CommandKind;
  ar: string;
  en: string;
  changedDays: string[];
}

/**
 * Run a parsed command for a partner and produce the reply.
 *
 * Blocks apply to every listing the partner supplies. That is the right
 * default for the person this is built for — Haj Mustafa saying "مشغول الخميس"
 * means the whole place, not chalet number four — and a partner who needs
 * per-listing control has the console. Guessing which of six chalets he meant
 * would be worse than either.
 */
export async function runCommand(
  partnerId: string,
  message: string,
  opts: { locale?: "ar" | "en"; today?: Date } = {},
): Promise<CommandResult> {
  const parsed = parseCommand(message, opts.today);
  const listingIds = await partnerListingIds(partnerId);

  if (parsed.kind === "help" || parsed.kind === "unknown") {
    return {
      kind: parsed.kind,
      ar: [
        "أوامر تشاو:",
        "• احجب 12-15/8 — يقفل الأيام",
        "• افتح 14/8 — يرجّعها متاحة",
        "• اليوم — يعرض شغل اليوم وبكرة",
      ].join("\n"),
      en: [
        "Ciao commands:",
        "• block 12-15/8 — closes those days",
        "• open 14/8 — makes them available again",
        "• today — shows today's and tomorrow's work",
      ].join("\n"),
      changedDays: [],
    };
  }

  if (parsed.kind === "agenda") {
    const today = (opts.today ?? new Date()).toISOString().slice(0, 10);
    const rows = await agenda(partnerId, today, 2);
    const lines = rows.flatMap((r) =>
      r.jobs.map(
        (j) =>
          `${r.day} ${j.startTime ?? ""} — ${j.titleAr}${j.clientNameAr ? ` (${j.clientNameAr})` : ""}`,
      ),
    );
    return {
      kind: "agenda",
      ar: lines.length ? `شغلك:\n${lines.join("\n")}` : "ما عندك شغل اليوم ولا بكرة.",
      en: lines.length ? `Your work:\n${lines.join("\n")}` : "Nothing booked today or tomorrow.",
      changedDays: [],
    };
  }

  if (parsed.days.length === 0) {
    return {
      kind: parsed.kind,
      ar: "ما فهمت التواريخ. اكتبها كذا: احجب 12-15/8",
      en: "I couldn't read the dates. Write them like this: block 12-15/8",
      changedDays: [],
    };
  }

  /*
   * A booked day is not the partner's to close by text message. Somebody has
   * paid a deposit against it and the state machine owns what happens next —
   * so those days are reported back rather than silently skipped, because a
   * partner who thinks Thursday is blocked and finds a family at the gate is
   * the exact failure this whole system exists to prevent.
   */
  const booked = listingIds.length
    ? await db
        .select({ day: schema.calendarDays.day })
        .from(schema.calendarDays)
        .where(
          and(
            inArray(schema.calendarDays.listingId, listingIds),
            inArray(schema.calendarDays.day, parsed.days),
            eq(schema.calendarDays.state, "booked"),
          ),
        )
    : [];
  const bookedDays = [...new Set(booked.map((b) => b.day))];
  const actionable = parsed.days.filter((d) => !bookedDays.includes(d));

  for (const listingId of listingIds) {
    if (actionable.length === 0) break;
    if (parsed.kind === "block") await blockDays(listingId, actionable);
    else await openDays(listingId, actionable);
  }

  track(
    "partner.command_received",
    { command: parsed.kind, dayCount: actionable.length, refused: bookedDays.length },
    { userId: partnerId, source: "api" },
  );

  const list = actionable.join("، ");
  const listEn = actionable.join(", ");
  const bookedNoteAr = bookedDays.length
    ? `\nما قدرت أغيّر ${bookedDays.join("، ")} — فيها حجز مدفوع.`
    : "";
  const bookedNoteEn = bookedDays.length
    ? `\nI couldn't change ${bookedDays.join(", ")} — those have a paid booking.`
    : "";

  if (actionable.length === 0) {
    return {
      kind: parsed.kind,
      ar: `كل الأيام المطلوبة فيها حجوزات مدفوعة: ${bookedDays.join("، ")}`,
      en: `Every day you named has a paid booking: ${bookedDays.join(", ")}`,
      changedDays: [],
    };
  }

  return {
    kind: parsed.kind,
    ar:
      parsed.kind === "block"
        ? `تم قفل ${actionable.length} يوم: ${list}${bookedNoteAr}`
        : `تم فتح ${actionable.length} يوم: ${list}${bookedNoteAr}`,
    en:
      parsed.kind === "block"
        ? `Closed ${actionable.length} day(s): ${listEn}${bookedNoteEn}`
        : `Opened ${actionable.length} day(s): ${listEn}${bookedNoteEn}`,
    changedDays: actionable,
  };
}

/**
 * Resolve an inbound message's sender to a partner.
 *
 * Used by the BSP webhook when one exists. It matches on the phone alone,
 * which is exactly as strong as WhatsApp's own sender identity and no
 * stronger — so what a command may do is bounded accordingly: it can open and
 * close availability, which is recoverable and visible, and it cannot touch
 * money, the payout destination, or the team. Anything in those three
 * categories requires the app and a real session.
 */
export async function partnerForPhone(phone: string): Promise<string | null> {
  const e164 = normalizePhone(phone);
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.phone, e164))
    .limit(1);
  if (!user) return null;
  const listings = await partnerListingIds(user.id);
  if (listings.length === 0) {
    // Not a supplier — but they may be on a team, in which case commands run
    // for exactly one business or not at all. Ambiguity here would mean a
    // manager's "احجب الخميس" landing on a business they did not mean.
    const teams = await db
      .select({ partnerId: schema.partnerTeam.partnerId })
      .from(schema.partnerTeam)
      .where(eq(schema.partnerTeam.memberUserId, user.id));
    return teams.length === 1 ? teams[0]!.partnerId : null;
  }
  await ensureProfile(user.id);
  return user.id;
}
