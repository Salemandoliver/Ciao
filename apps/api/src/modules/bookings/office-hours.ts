/**
 * A confirmation countdown that knows when the desk is staffed.
 *
 * Lancaster's reservations office runs 11:00 to 17:00, daily, from a building
 * that is not the resort. Our countdown was a flat two hours from the moment
 * the deposit cleared, fifteen minutes for a same-day request, and it started
 * whenever it started. So a booking made at seven in the evening auto-declined
 * at nine, refunded the guest, told them the venue had not answered, and took
 * a bite out of the venue's reliability score — for being closed, at night,
 * exactly as advertised.
 *
 * That is the platform manufacturing its own worst metric. Three parties lose:
 * the guest, who is told the place ignored them; the venue, which is punished
 * for keeping ordinary hours; and Ciao, whose entire pitch is that booking
 * here is more reliable than the phone call it replaces.
 *
 * So the clock only runs while somebody could answer it. The hours live on the
 * venue, because that is what they describe — the desk, not the person — and
 * `null` means always open, which is the right default for a chalet owner with
 * a phone in his pocket and the behaviour every existing venue keeps.
 *
 * Everything here is Africa/Tripoli. Libya is UTC+2 year-round with no summer
 * time, which is why this can be arithmetic rather than a timezone library on
 * a 3G-budget server.
 */

/** Libya does not observe daylight saving. One offset, all year. */
export const TRIPOLI_UTC_OFFSET_MINUTES = 120;

export interface OfficeHours {
  /** "HH:MM", local. */
  from: string;
  to: string;
  /** Day numbers, 0 = Sunday. Omitted or empty means every day. */
  days?: number[];
}

export function parseOfficeHours(raw: unknown): OfficeHours | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const hhmm = /^([01]\d|2[0-3]):([0-5]\d)$/;
  if (typeof o.from !== "string" || !hhmm.test(o.from)) return null;
  if (typeof o.to !== "string" || !hhmm.test(o.to)) return null;
  const days = Array.isArray(o.days)
    ? o.days.filter((d): d is number => typeof d === "number" && d >= 0 && d <= 6)
    : undefined;
  /*
   * A window that closes before it opens is not an overnight shift, it is a
   * typo — and reading it as overnight would silently make a 17:00→11:00
   * mistake mean "open eighteen hours a day", which is the failure this whole
   * module exists to prevent. Treated as unset: always open beats wrong.
   */
  if (o.to <= o.from) return null;
  return { from: o.from, to: o.to, ...(days && days.length ? { days } : {}) };
}

function minutesOfDayTripoli(d: Date): number {
  const shifted = new Date(d.getTime() + TRIPOLI_UTC_OFFSET_MINUTES * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

function dayOfWeekTripoli(d: Date): number {
  const shifted = new Date(d.getTime() + TRIPOLI_UTC_OFFSET_MINUTES * 60_000);
  return shifted.getUTCDay();
}

function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h! * 60 + m!;
}

export function isOpenAt(hours: OfficeHours | null, at: Date): boolean {
  if (!hours) return true;
  if (hours.days && !hours.days.includes(dayOfWeekTripoli(at))) return false;
  const mins = minutesOfDayTripoli(at);
  return mins >= hhmmToMinutes(hours.from) && mins < hhmmToMinutes(hours.to);
}

/** The next instant the desk is staffed, at or after `from`. */
export function nextOpening(hours: OfficeHours | null, from: Date): Date {
  if (!hours) return from;
  const open = hhmmToMinutes(hours.from);
  /*
   * Walk forward a day at a time. Bounded at 14 so a venue that has managed to
   * mark every day closed cannot spin here — it returns `from` and the booking
   * behaves exactly as it did before this module existed, which is the correct
   * way for a scheduling nicety to fail.
   */
  let cursor = new Date(from);
  for (let i = 0; i < 14; i++) {
    if (!hours.days || hours.days.includes(dayOfWeekTripoli(cursor))) {
      const mins = minutesOfDayTripoli(cursor);
      if (mins < open) {
        return new Date(cursor.getTime() + (open - mins) * 60_000);
      }
      if (isOpenAt(hours, cursor)) return cursor;
    }
    // Midnight Tripoli on the following day.
    const mins = minutesOfDayTripoli(cursor);
    cursor = new Date(cursor.getTime() + (24 * 60 - mins) * 60_000);
  }
  return from;
}

/**
 * A deadline `windowMinutes` of *open time* after `start`.
 *
 * The countdown is consumed only while the desk is staffed, so a two-hour
 * window that begins at 16:30 on an 11:00–17:00 desk spends thirty minutes
 * today and resumes at 11:00 tomorrow. That is what a guest would assume if
 * you told them the office hours — which we now do, on the waiting screen.
 */
export function confirmationDeadline(
  hours: OfficeHours | null,
  windowMinutes: number,
  start: Date = new Date(),
): Date {
  if (!hours) return new Date(start.getTime() + windowMinutes * 60_000);

  let remaining = windowMinutes;
  let cursor = nextOpening(hours, start);
  const close = hhmmToMinutes(hours.to);

  for (let i = 0; i < 30 && remaining > 0; i++) {
    const mins = minutesOfDayTripoli(cursor);
    const availableToday = Math.max(0, close - mins);
    if (availableToday >= remaining) return new Date(cursor.getTime() + remaining * 60_000);
    remaining -= availableToday;
    // Jump to closing, then to the next opening.
    cursor = nextOpening(hours, new Date(cursor.getTime() + (availableToday + 1) * 60_000));
  }
  return new Date(cursor.getTime() + remaining * 60_000);
}

/**
 * Same-day requests are the exception that proves the rule.
 *
 * The fifteen-minute window exists because someone wants a chalet tonight, and
 * stretching it across a closed evening would leave a guest holding a hold on
 * a place they wanted in four hours' time. If the desk is shut, a same-day
 * request should fail fast and honestly rather than hang until morning.
 */
export function shouldFailFast(hours: OfficeHours | null, sameDay: boolean, at: Date): boolean {
  return sameDay && !isOpenAt(hours, at);
}
