/**
 * Declared profile data — birth date, party shape, occasions.
 *
 * The whole point of this file is the line it draws. Salem asked for date of
 * birth and family information so Ciao can time offers and keep in touch. That
 * is a reasonable thing for a marketplace to want, and it is also the exact
 * shape of request that turns into a privacy incident if it is built literally.
 *
 * So: everything here is **declared** by the member (guardrail 1), and it
 * describes a *party*, not a family (guardrail 3). Counts and coarse bands
 * answer every question an offer actually needs to ask —
 *
 *   "Your anniversary is next month"        → a month
 *   "Somewhere for 8 adults and 3 children" → two counts
 *   "A walled, shallow pool"                → a band, not a child
 *   "Happy birthday"                        → a day and a month
 *
 * — while a register of named family members answers none of them any better
 * and would be, in a market built on satar, the single most damaging table we
 * could hold. It also rots: a stored "daughter, age 4" is wrong within a year,
 * whereas "one child in the 4–9 band" is self-correcting on the next edit.
 *
 * The precise birth year never leaves this module either. Downstream — events,
 * profiles, dashboards — sees an age band.
 */

/** Coarse child bands. Used to size and screen a property, never to target a child. */
export const CHILD_BANDS = ["toddler", "child", "teen"] as const;
export type ChildBand = (typeof CHILD_BANDS)[number];

/** Recurring occasions worth a note, as a month only. */
export const OCCASION_KINDS = ["anniversary", "family_birthday", "graduation", "other"] as const;
export type OccasionKind = (typeof OCCASION_KINDS)[number];

/** A one-off event the member is planning — the declared wedding pipeline. */
export const PLANNED_EVENT_KINDS = ["wedding", "engagement", "graduation", "other"] as const;
export type PlannedEventKind = (typeof PLANNED_EVENT_KINDS)[number];

export interface Occasion {
  kind: OccasionKind;
  /** 1–12. No day, no year: "next month" is all a nudge needs. */
  month: number;
}

/**
 * Age bands.
 *
 * Wide enough that a band never identifies anyone, narrow enough to be worth
 * something: an 18–24 member and a 55+ member want visibly different weekends.
 */
export const AGE_BANDS = ["18-24", "25-34", "35-44", "45-54", "55+"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export const MIN_AGE_YEARS = 18;

/**
 * How long a birth date must sit on file before it earns that year's gift.
 *
 * Without this, the cheapest attack on the loyalty programme is: join, set
 * your birthday to tomorrow, collect. It is not a hypothetical — on the
 * numbers as first shipped it took a brand-new account to exactly the
 * redemption floor in one day, with no booking, which buys a coffee at a
 * partner that Ciao settles in cash.
 *
 * Thirty days is chosen to be longer than a fraudster's patience and shorter
 * than a real member's memory. The cost to an honest person is bounded and
 * knowable: if you join in March and your birthday is in April, your first
 * gift arrives the following April. We say that on the rewards page rather
 * than letting it arrive as a silent non-event, because an unexplained missing
 * gift is worse than a stated rule.
 */
export const BIRTHDAY_TENURE_DAYS = 30;

/**
 * Corrections allowed after the first entry.
 *
 * One, because people mistype a year. Not unlimited, because a birth date that
 * can be edited freely is a dial rather than a fact — and the entire reason
 * for asking was to know a real day. After that it is a support job, which is
 * how every bank and airline treats the same field.
 */
export const MAX_BIRTH_DATE_CHANGES = 1;

/** Whole years between a birth date and a reference day. */
export function ageOn(birthDate: string, on: Date = new Date()): number {
  const [y, m, d] = birthDate.split("-").map(Number);
  let age = on.getUTCFullYear() - y!;
  const beforeBirthday =
    on.getUTCMonth() + 1 < m! || (on.getUTCMonth() + 1 === m! && on.getUTCDate() < d!);
  if (beforeBirthday) age -= 1;
  return age;
}

export function ageBand(birthDate: string, on: Date = new Date()): AgeBand {
  const age = ageOn(birthDate, on);
  if (age < 25) return "18-24";
  if (age < 35) return "25-34";
  if (age < 45) return "35-44";
  if (age < 55) return "45-54";
  return "55+";
}

/** Day and month, for greetings and the birthday job. Never the year. */
export function birthDayMonth(birthDate: string): { day: number; month: number } {
  const [, m, d] = birthDate.split("-").map(Number);
  return { day: d!, month: m! };
}

export type BirthDateProblem =
  | "malformed"
  | "future"
  | "under_age"
  | "implausible"
  /** Already corrected once; changing it again is a support job. */
  | "locked";

/**
 * Validate a declared birth date.
 *
 * Two refusals matter here.
 *
 * Under 18 is a hard stop, not a warning. A booking on Ciao is a contract that
 * moves a deposit and hands over a host's address; a minor cannot enter it, and
 * discovering that after the money moved is worse for the child, the host and
 * us than refusing at the door. The message says so plainly rather than
 * pretending the date was invalid.
 *
 * An implausible age (over 110) is almost always a typo in the year, and a typo
 * that silently becomes a birthday campaign is a bad first impression.
 */
export function checkBirthDate(
  birthDate: string,
  now: Date = new Date(),
): BirthDateProblem | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return "malformed";
  const parsed = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "malformed";
  // Round-trip guard: `2026-02-31` parses to 3 March without it.
  if (parsed.toISOString().slice(0, 10) !== birthDate) return "malformed";
  if (parsed.getTime() > now.getTime()) return "future";
  const age = ageOn(birthDate, now);
  if (age < MIN_AGE_YEARS) return "under_age";
  if (age > 110) return "implausible";
  return null;
}

/**
 * The party profile, as the intelligence layer is allowed to see it.
 *
 * Note what is absent: no names, no genders, no relationships, no exact ages,
 * and no birth date. If a member ever asked to see everything we hold about
 * their household, this is the whole of it — which is the test guardrail 3
 * actually sets.
 */
export interface DeclaredParty {
  adults: number;
  children: number;
  bands: ChildBand[];
}

export const MAX_PARTY_ADULTS = 40;
export const MAX_PARTY_CHILDREN = 20;

export function normaliseParty(input: {
  adults?: number | null;
  children?: number | null;
  bands?: string[] | null;
}): DeclaredParty | null {
  const adults = Math.trunc(input.adults ?? 0);
  const children = Math.trunc(input.children ?? 0);
  if (adults <= 0) return null;
  if (adults > MAX_PARTY_ADULTS || children < 0 || children > MAX_PARTY_CHILDREN) return null;
  const bands = (input.bands ?? []).filter((b): b is ChildBand =>
    (CHILD_BANDS as readonly string[]).includes(b),
  );
  // Bands without children, or children without bands, is a half-filled form
  // rather than a lie — keep whichever the member actually gave us.
  return { adults, children, bands: children > 0 ? [...new Set(bands)] : [] };
}

/** Total heads, which is what a capacity check actually compares against. */
export function partySize(party: DeclaredParty): number {
  return party.adults + party.children;
}

export function normaliseOccasions(input: unknown): Occasion[] {
  if (!Array.isArray(input)) return [];
  const out: Occasion[] = [];
  for (const raw of input.slice(0, 6)) {
    if (!raw || typeof raw !== "object") continue;
    const { kind, month } = raw as { kind?: unknown; month?: unknown };
    if (!(OCCASION_KINDS as readonly unknown[]).includes(kind)) continue;
    const m = Math.trunc(Number(month));
    if (!Number.isFinite(m) || m < 1 || m > 12) continue;
    out.push({ kind: kind as OccasionKind, month: m });
  }
  return out;
}
