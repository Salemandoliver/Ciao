/**
 * Which brand message is live, and what it says in this language.
 *
 * Two very different callers need to answer these questions identically: the
 * marketplace, deciding what to render to a family in Tripoli, and the Ciao
 * Business composer, showing an operator what she is about to publish. If the
 * preview and the page disagree about which message wins — or about what a
 * half-translated one looks like in English — the preview is worse than none,
 * because it is confidently wrong. So the rule lives here, in the package both
 * of them already depend on, and neither is allowed its own copy.
 *
 * Everything below is pure. No clock, no locale guessing, no database: the
 * caller passes the day and the audience, which is also what makes "what will
 * be live on the 14th of March in Misrata" a question the composer can answer
 * without time travel.
 */

export type BrandVertical = "coast" | "hall" | "service";

export interface BrandMessage {
  id: string;
  name: string;
  overlineAr: string | null;
  overlineEn: string | null;
  headlineAr: string;
  headlineEn: string | null;
  accentAr: string | null;
  accentEn: string | null;
  bodyAr: string | null;
  bodyEn: string | null;
  imageUrl: string | null;
  imageAltAr: string | null;
  imageAltEn: string | null;
  ctaLabelAr: string | null;
  ctaLabelEn: string | null;
  ctaHref: string | null;
  /** Inclusive `YYYY-MM-DD`; null means open at that end. */
  startsOn: string | null;
  endsOn: string | null;
  /** Null = every city / every vertical. */
  city: string | null;
  vertical: string | null;
  priority: number;
  active: boolean;
}

/** What a page knows about who is reading it. */
export interface BrandAudience {
  city?: string | null;
  vertical?: string | null;
}

/**
 * Is this message scheduled to be live on `day`?
 *
 * Both ends inclusive, which is the only reading that matches how the window
 * was typed. An operator who sets Eid to end on the 16th means the 16th is an
 * Eid day; ending it at the start of the 16th would take the greeting down on
 * the morning of the holiday, and she would have no way to express what she
 * meant except by typing the 17th and hoping.
 *
 * `YYYY-MM-DD` strings compare correctly with `<=` because the format is
 * zero-padded and big-endian. That is a property of ISO dates, not a
 * coincidence, and it is why days are stored as strings rather than as
 * timestamps that would drag a timezone into a question that has none.
 */
export function isScheduledOn(m: BrandMessage, day: string): boolean {
  if (!m.active) return false;
  if (m.startsOn && day < m.startsOn) return false;
  if (m.endsOn && day > m.endsOn) return false;
  return true;
}

/**
 * Does this message address the reader?
 *
 * A null target means "everyone", so an untargeted message matches every
 * audience — including one we know nothing about. A *targeted* message shown
 * to an unknown audience is the case worth being careful with: the homepage
 * does not know which city a visitor is in, and guessing would put a Misrata
 * offer in front of Tripoli. So a message that names a city only matches when
 * the page has told us a city, and the composer says exactly that back to
 * whoever schedules one.
 */
export function matchesAudience(m: BrandMessage, at: BrandAudience): boolean {
  if (m.city && m.city !== at.city) return false;
  if (m.vertical && m.vertical !== at.vertical) return false;
  return true;
}

/** How many of the two dimensions this message names. Ties break by it. */
function specificity(m: BrandMessage): number {
  return (m.city ? 1 : 0) + (m.vertical ? 1 : 0);
}

/**
 * The one that wins: highest priority, then most specific, then newest.
 *
 * Specificity before recency matters more than it looks. Ciao's standing copy
 * — the founder's «المكان الجميل يخلّي الذكرى أجمل» — is an untargeted message
 * with no end date, so it is *always* a candidate. Without the specificity
 * rule, editing that standing line would make it the newest row and it would
 * silently outrank a Tripoli Eid campaign somebody scheduled a fortnight ago.
 *
 * `createdAt` is passed alongside rather than living on the message so this
 * stays sortable on data that has crossed JSON, where a Date is a string.
 */
export function pickBrandMessage<T extends BrandMessage>(
  messages: readonly T[],
  day: string,
  at: BrandAudience = {},
): T | null {
  const live = messages.filter((m) => isScheduledOn(m, day) && matchesAudience(m, at));
  if (live.length === 0) return null;
  return live.reduce((best, m) => {
    if (m.priority !== best.priority) return m.priority > best.priority ? m : best;
    const ds = specificity(m) - specificity(best);
    if (ds !== 0) return ds > 0 ? m : best;
    // Stable and total: ids are uuids, so this never depends on input order.
    return m.id > best.id ? m : best;
  });
}

/**
 * The message in one language, with English falling back to Arabic.
 *
 * Arabic is the only required half, and that asymmetry is deliberate rather
 * than lazy. Ciao's market reads Arabic; the English pages exist for the
 * minority who prefer them. Requiring both would mean an operator who wants
 * «عيد مبارك» up in ten minutes either writes an English line she does not
 * care about or does not publish — and a half-translated site is a smaller
 * problem than a stale one.
 *
 * The returned `lang` is what the caller must put on the element when the
 * fallback fired: Arabic text inside an English page needs `lang="ar"` and
 * `dir="rtl"` or a screen reader announces it letter by letter, and the locale
 * audit fails the build for exactly this.
 */
/**
 * One piece of text, and whether it is Arabic sitting on an English page.
 *
 * `ar` is not decoration. Arabic inside an English document without
 * `lang="ar"` and `dir="rtl"` is announced letter by letter by a screen reader
 * and laid out in the wrong direction by the browser, and `tools/locale-audit
 * .mjs` fails the build over it. Carrying the flag per field rather than per
 * message is what makes precise markup possible — the common half-translated
 * message has an English headline above an Arabic paragraph, and marking the
 * whole band `lang="ar"` would then lie about the headline.
 */
export interface BrandText {
  text: string;
  ar: boolean;
}

export interface RenderedBrandMessage {
  overline: BrandText | null;
  headline: BrandText;
  accent: BrandText | null;
  body: BrandText | null;
  imageUrl: string | null;
  imageAlt: string | null;
  ctaLabel: BrandText | null;
  ctaHref: string | null;
}

/** Non-empty English, or Arabic marked as such. Null when neither exists. */
function pickText(en: string | null, ar: string | null): BrandText | null {
  const e = en?.trim();
  if (e) return { text: e, ar: false };
  const a = ar?.trim();
  return a ? { text: a, ar: true } : null;
}

export function renderBrandMessage(
  m: BrandMessage,
  locale: "ar" | "en",
): RenderedBrandMessage {
  if (locale === "ar") {
    const ar = (t: string | null): BrandText | null =>
      t?.trim() ? { text: t.trim(), ar: false } : null;
    return {
      overline: ar(m.overlineAr),
      headline: { text: m.headlineAr, ar: false },
      accent: ar(m.accentAr),
      body: ar(m.bodyAr),
      imageUrl: m.imageUrl,
      imageAlt: m.imageAltAr?.trim() || null,
      ctaLabel: ar(m.ctaLabelAr),
      ctaHref: m.ctaHref,
    };
  }
  /*
   * Fall back per field, not per message.
   *
   * A message with an English headline and no English body is the common case
   * — the headline is the part anyone bothers to translate. Falling back
   * wholesale would throw away the translation that does exist.
   */
  return {
    overline: pickText(m.overlineEn, m.overlineAr),
    headline: pickText(m.headlineEn, m.headlineAr) ?? { text: m.headlineAr, ar: true },
    accent: pickText(m.accentEn, m.accentAr),
    body: pickText(m.bodyEn, m.bodyAr),
    imageUrl: m.imageUrl,
    /* Alt text is never rendered, so it needs no direction — only words. */
    imageAlt: m.imageAltEn?.trim() || m.imageAltAr?.trim() || null,
    ctaLabel: pickText(m.ctaLabelEn, m.ctaLabelAr),
    ctaHref: m.ctaHref,
  };
}

/**
 * Why a message is not on screen right now.
 *
 * The composer needs to say something more useful than "not live". Ordered so
 * the first true answer is the one worth acting on: retired beats out-of-window
 * beats "you targeted an audience the homepage cannot know".
 */
export type BrandMessageState =
  | "live"
  | "retired"
  | "scheduled"
  | "expired"
  | "outranked";

export function brandMessageState<T extends BrandMessage>(
  m: T,
  all: readonly T[],
  day: string,
): BrandMessageState {
  if (!m.active) return "retired";
  if (m.startsOn && day < m.startsOn) return "scheduled";
  if (m.endsOn && day > m.endsOn) return "expired";
  const winner = pickBrandMessage(all, day, { city: m.city, vertical: m.vertical });
  return winner?.id === m.id ? "live" : "outranked";
}

/**
 * A day string in Libya's calendar (UTC+2, no daylight saving since 2013).
 *
 * Taken here rather than left to `toISOString().slice(0,10)` at each call site
 * because that is UTC, and between midnight and 02:00 Libyan time it names
 * yesterday. An Eid greeting scheduled to start "today" would then not appear
 * until two in the morning — during the exact two hours somebody is most
 * likely to be publishing it in a hurry.
 */
export const LIBYA_UTC_OFFSET_MINUTES = 120;

export function libyaDay(at: Date = new Date()): string {
  return new Date(at.getTime() + LIBYA_UTC_OFFSET_MINUTES * 60_000)
    .toISOString()
    .slice(0, 10);
}
