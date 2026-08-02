import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "../../db/client.js";
import { track } from "../intelligence/events.js";
import { awardPoints } from "./loyalty.js";
import { notify } from "../messaging/service.js";
import {
  ageBand,
  birthDayMonth,
  checkBirthDate,
  normaliseOccasions,
  normaliseParty,
  type BirthDateProblem,
  type DeclaredParty,
  type Occasion,
} from "./profile-data.js";

/**
 * Declared profile: reading it, writing it, and the birthday campaign it
 * exists to power.
 *
 * The rule this module keeps is that the precise data stays in
 * `user_preferences` and only its shape travels: an age band and a birth month
 * reach the intelligence layer, never a date of birth. Everything below is
 * written so that holds even when someone is adding a feature in a hurry.
 */

export interface DeclaredProfile {
  birthDate: string | null;
  party: DeclaredParty | null;
  occasions: Occasion[];
  plannedEvent: { kind: string; date: string } | null;
  /** Which rewards are still on the table, so the UI can say so honestly. */
  rewards: { birthDate: boolean; party: boolean };
}

/** Ensure the preferences row exists — same helper the settings endpoint uses. */
async function ensureRow(userId: string) {
  await db
    .insert(schema.userPreferences)
    .values({ userId })
    .onConflictDoNothing();
  const [row] = await db
    .select()
    .from(schema.userPreferences)
    .where(eq(schema.userPreferences.userId, userId))
    .limit(1);
  return row!;
}

export async function readProfile(userId: string): Promise<DeclaredProfile> {
  const row = await ensureRow(userId);
  const party = normaliseParty({
    adults: row.partyAdults,
    children: row.partyChildren,
    bands: row.childAgeBands as string[],
  });
  return {
    birthDate: row.birthDate ?? null,
    party,
    occasions: normaliseOccasions(row.occasions),
    plannedEvent:
      row.plannedEventKind && row.plannedEventDate
        ? { kind: row.plannedEventKind, date: row.plannedEventDate }
        : null,
    rewards: { birthDate: !row.birthDate, party: !row.profileCompletedAt },
  };
}

export class ProfileInputError extends Error {
  constructor(public problem: BirthDateProblem) {
    super(problem);
  }
}

export interface ProfileUpdate {
  birthDate?: string | null;
  party?: { adults?: number | null; children?: number | null; bands?: string[] | null } | null;
  occasions?: unknown;
  plannedEvent?: { kind: string; date: string } | null;
}

/**
 * Save declared profile data and pay whatever it earned.
 *
 * Rewards are one-time and idempotent: `awardPoints` dedupes on
 * (userId, reason, refId), and the party reward additionally gates on
 * `profileCompletedAt`, so editing your household next year does not mint
 * another 1000 points. Points that can be farmed by editing a form are not a
 * loyalty programme, they are a bug with a marketing budget.
 */
export async function saveProfile(
  userId: string,
  update: ProfileUpdate,
): Promise<{ profile: DeclaredProfile; earned: number }> {
  const row = await ensureRow(userId);
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  let earned = 0;

  if (update.birthDate !== undefined) {
    if (update.birthDate === null) {
      // Withdrawing it is always allowed, and does not claw back the reward —
      // punishing someone for changing their mind about what we hold is how
      // you teach them never to tell you anything.
      patch.birthDate = null;
    } else {
      const problem = checkBirthDate(update.birthDate);
      if (problem) throw new ProfileInputError(problem);
      patch.birthDate = update.birthDate;
      if (!row.birthDate) {
        earned += await awardPoints(userId, "birth_date_added", userId, "profile");
        // Band and month only. The date itself stops here.
        track(
          "profile.birth_date_added",
          {
            ageBand: ageBand(update.birthDate),
            birthMonth: birthDayMonth(update.birthDate).month,
          },
          { userId },
        );
      }
    }
  }

  if (update.party !== undefined) {
    const party = update.party ? normaliseParty(update.party) : null;
    patch.partyAdults = party?.adults ?? null;
    patch.partyChildren = party?.children ?? null;
    patch.childAgeBands = party?.bands ?? [];
    if (party && !row.profileCompletedAt) {
      patch.profileCompletedAt = new Date();
      earned += await awardPoints(userId, "party_profile_added", userId, "profile");
    }
    if (party) {
      track(
        "profile.party_added",
        { adults: party.adults, children: party.children, bands: party.bands },
        { userId },
      );
    }
  }

  if (update.occasions !== undefined) {
    const occasions = normaliseOccasions(update.occasions);
    patch.occasions = occasions;
    if (occasions.length) {
      track(
        "profile.occasions_added",
        { kinds: occasions.map((o) => o.kind), months: occasions.map((o) => o.month) },
        { userId },
      );
    }
  }

  if (update.plannedEvent !== undefined) {
    if (update.plannedEvent === null) {
      patch.plannedEventKind = null;
      patch.plannedEventDate = null;
    } else {
      patch.plannedEventKind = update.plannedEvent.kind;
      patch.plannedEventDate = update.plannedEvent.date;
      const monthsAway = Math.round(
        (new Date(`${update.plannedEvent.date}T00:00:00Z`).getTime() - Date.now()) /
          (30 * 24 * 3600 * 1000),
      );
      track(
        "profile.planned_event_added",
        { kind: update.plannedEvent.kind, monthsAway },
        { userId },
      );
    }
  }

  await db
    .update(schema.userPreferences)
    .set(patch)
    .where(eq(schema.userPreferences.userId, userId));

  return { profile: await readProfile(userId), earned };
}

/**
 * The birthday campaign.
 *
 * Two things happen on a member's birthday and they are governed differently.
 *
 * The **points** are a loyalty benefit. Someone who joined the programme is
 * owed the programme, so they are awarded whether or not that member accepts
 * marketing. The `refId` is the year, which makes the award idempotent: the
 * job can run twice, or be retried after a crash, and nobody gets two gifts.
 *
 * The **message** is marketing. It only goes to members who opted in, because
 * an unsolicited "happy birthday, here's an offer" is exactly the kind of
 * message Law 6/2022 has in mind, and because a marketplace that messages you
 * on a day it learned about from a form you filled in for points had better
 * have asked first.
 *
 * `campaign.sent` is emitted in both cases with `messaged` recording which, so
 * an opt-out reads as an opt-out in the funnel rather than as a delivery
 * failure.
 */
export async function runBirthdayCampaign(now: Date = new Date()): Promise<{
  awarded: number;
  messaged: number;
}> {
  const month = now.getUTCMonth() + 1;
  const day = now.getUTCDate();
  const year = now.getUTCFullYear();

  const rows = await db
    .select({
      userId: schema.userPreferences.userId,
      marketingOptIn: schema.userPreferences.marketingOptIn,
      notifyWhatsapp: schema.userPreferences.notifyWhatsapp,
      locale: schema.userPreferences.locale,
      phone: schema.users.phone,
      displayName: schema.users.displayName,
    })
    .from(schema.userPreferences)
    .innerJoin(schema.users, eq(schema.users.id, schema.userPreferences.userId))
    .where(
      and(
        sql`extract(month from ${schema.userPreferences.birthDate}) = ${month}`,
        sql`extract(day from ${schema.userPreferences.birthDate}) = ${day}`,
        eq(schema.users.disabled, false),
      ),
    )
    .limit(500);

  let awarded = 0;
  let messaged = 0;
  for (const r of rows) {
    const delta = await awardPoints(r.userId, "birthday_gift", `${year}`, "campaign");
    if (delta > 0) awarded++;
    const willMessage = delta > 0 && r.marketingOptIn && r.notifyWhatsapp;
    if (willMessage) {
      const msgLocale = r.locale === "en" ? "en" : "ar";
      await notify({
        templateKey: "birthday",
        toPhone: r.phone,
        toUserId: r.userId,
        locale: msgLocale,
        /*
         * The name is a *fragment*, not a value, because Arabic and English
         * attach it differently: «كل عام وأنت بخير يا سالم» versus "Happy
         * birthday, Salem". Building it here keeps both templates readable and
         * — the reason this is worth the care — a member with no name set gets
         * a clean greeting instead of a stray comma or a gap before the emoji.
         */
        vars: {
          name: r.displayName
            ? msgLocale === "en"
              ? `, ${r.displayName}`
              : ` يا ${r.displayName}`
            : "",
          points: String(delta),
        },
      });
      messaged++;
    }
    track(
      "campaign.sent",
      { campaign: "birthday", channel: "whatsapp", messaged: willMessage },
      { userId: r.userId, source: "worker" },
    );
  }
  return { awarded, messaged };
}

/**
 * Members with an occasion this month who accept marketing — the input to the
 * "your anniversary is coming" nudge. Returned rather than sent so the
 * campaign copy stays with the messaging module and this file stays about data.
 */
export async function occasionAudience(month: number): Promise<
  { userId: string; phone: string; kinds: string[] }[]
> {
  const rows = await db
    .select({
      userId: schema.userPreferences.userId,
      occasions: schema.userPreferences.occasions,
      phone: schema.users.phone,
    })
    .from(schema.userPreferences)
    .innerJoin(schema.users, eq(schema.users.id, schema.userPreferences.userId))
    .where(and(eq(schema.userPreferences.marketingOptIn, true), eq(schema.users.disabled, false)))
    .limit(1000);
  return rows
    .map((r) => ({
      userId: r.userId,
      phone: r.phone,
      kinds: normaliseOccasions(r.occasions)
        .filter((o) => o.month === month)
        .map((o) => o.kind),
    }))
    .filter((r) => r.kinds.length > 0);
}

/** Revoke one session, or every session this member has. */
export async function signOut(userId: string, refreshToken?: string, everywhere = false) {
  const { hashToken } = await import("../../lib/auth.js");
  if (everywhere || !refreshToken) {
    await db
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(schema.refreshTokens.userId, userId), isNull(schema.refreshTokens.revokedAt)),
      );
  } else {
    await db
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.refreshTokens.userId, userId),
          eq(schema.refreshTokens.tokenHash, hashToken(refreshToken)),
          isNull(schema.refreshTokens.revokedAt),
        ),
      );
  }
  track("auth.signed_out", { everywhere }, { userId });
}
