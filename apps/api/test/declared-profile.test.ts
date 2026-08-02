/**
 * Declared profile — date of birth, party shape, occasions.
 *
 * Most of these tests are not checking that a feature works. They are pinning
 * down a set of promises that are easy to break by accident six months from
 * now, when someone adds "just the child's first name so the message is
 * friendlier". The privacy shape of this data IS the feature; a version of it
 * that leaks a birth date into the events table would pass every functional
 * test and still be the wrong product.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, pool, schema } from "../src/db/client.js";
import { signAccessToken } from "../src/lib/auth.js";
import {
  ageBand,
  checkBirthDate,
  normaliseParty,
  normaliseOccasions,
  partySize,
} from "../src/modules/accounts/profile-data.js";
import { runBirthdayCampaign } from "../src/modules/accounts/profile.js";
import { BIRTHDAY_TENURE_DAYS } from "../src/modules/accounts/profile-data.js";
import { MIN_REDEEM_POINTS, POINT_RULES } from "../src/modules/accounts/loyalty.js";
import { emptyTraits, foldEvent, scoreListing } from "../src/modules/intelligence/profile.js";

let app: FastifyInstance;
let userId: string;
let token: string;
const phone = `+2189${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

beforeAll(async () => {
  app = await buildApp();
  const [u] = await db.insert(schema.users).values({ phone, role: "guest" }).returning();
  userId = u!.id;
  // Minted directly: the OTP endpoint is rate-limited by design and the limit
  // is not something a test suite should be routing around.
  token = await signAccessToken({ sub: userId, role: "guest", phone });
});

afterAll(async () => {
  await db.delete(schema.loyaltyLedger).where(eq(schema.loyaltyLedger.userId, userId));
  await db.delete(schema.userPreferences).where(eq(schema.userPreferences.userId, userId));
  await db.delete(schema.events).where(eq(schema.events.userId, userId));
  await db.delete(schema.users).where(eq(schema.users.id, userId));
  await app.close();
  await pool.end();
});

/*
 * A function, not a constant. As a constant this is evaluated at module load —
 * before `beforeAll` has minted the token — and every request goes out as
 * "Bearer undefined", which fails as a flat 401 and looks like a broken guard
 * rather than a broken test.
 */
const auth = () => ({ authorization: `Bearer ${token}` });

describe("birth date validation", () => {
  const now = new Date("2026-08-01T00:00:00Z");

  it("accepts a plausible adult date", () => {
    expect(checkBirthDate("1988-03-14", now)).toBeNull();
  });

  it("rejects a date that does not exist", () => {
    // Without a round-trip check this parses to 3 March and is accepted.
    expect(checkBirthDate("2000-02-31", now)).toBe("malformed");
  });

  it("rejects the future and the implausible", () => {
    expect(checkBirthDate("2030-01-01", now)).toBe("future");
    expect(checkBirthDate("1890-01-01", now)).toBe("implausible");
  });

  it("refuses under-18s, because a booking is a contract", () => {
    expect(checkBirthDate("2010-01-01", now)).toBe("under_age");
    // And is exact about the boundary rather than approximating with years.
    expect(checkBirthDate("2008-08-02", now)).toBe("under_age"); // 17 by a day
    expect(checkBirthDate("2008-08-01", now)).toBeNull(); // 18 today
  });

  it("bands ages coarsely enough that a band never identifies anyone", () => {
    expect(ageBand("2004-01-01", now)).toBe("18-24");
    expect(ageBand("1995-01-01", now)).toBe("25-34");
    expect(ageBand("1960-01-01", now)).toBe("55+");
  });
});

describe("party shape", () => {
  it("keeps counts and bands, and has nowhere to put a name", () => {
    const party = normaliseParty({ adults: 8, children: 3, bands: ["toddler", "child"] });
    expect(party).toEqual({ adults: 8, children: 3, bands: ["toddler", "child"] });
    expect(partySize(party!)).toBe(11);
    // The type has three fields. If this ever grows a fourth, someone should
    // have to come and change this assertion on purpose.
    expect(Object.keys(party!).sort()).toEqual(["adults", "bands", "children"]);
  });

  it("drops bands it does not recognise rather than storing free text", () => {
    const party = normaliseParty({ adults: 2, children: 1, bands: ["toddler", "daughter-layla"] });
    expect(party!.bands).toEqual(["toddler"]);
  });

  it("ignores bands when there are no children", () => {
    expect(normaliseParty({ adults: 2, children: 0, bands: ["teen"] })!.bands).toEqual([]);
  });

  it("refuses a party with no adults", () => {
    expect(normaliseParty({ adults: 0, children: 4 })).toBeNull();
  });

  it("keeps occasions to a month", () => {
    const occ = normaliseOccasions([
      { kind: "anniversary", month: 6, day: 12, year: 2015, spouse: "…" },
      { kind: "not-a-kind", month: 3 },
      { kind: "graduation", month: 99 },
    ]);
    expect(occ).toEqual([{ kind: "anniversary", month: 6 }]);
  });
});

describe("PATCH /v1/me/declared-profile", () => {
  it("saves, pays once, and never pays twice", async () => {
    const first = await app.inject({
      method: "PATCH",
      url: "/v1/me/declared-profile",
      headers: auth(),
      payload: {
        birthDate: "1988-03-14",
        party: { adults: 8, children: 3, bands: ["toddler", "child"] },
        occasions: [{ kind: "anniversary", month: 6 }],
      },
    });
    expect(first.statusCode).toBe(200);
    const a = first.json() as { earned: number; profile: { party: { adults: number } } };
    expect(a.earned).toBe(1500); // 500 birth date + 1000 party
    expect(a.profile.party.adults).toBe(8);

    // Editing the household later is normal life, not a second payday.
    const second = await app.inject({
      method: "PATCH",
      url: "/v1/me/declared-profile",
      headers: auth(),
      payload: { party: { adults: 9, children: 3, bands: ["child"] } },
    });
    expect((second.json() as { earned: number }).earned).toBe(0);
  });

  it("explains an under-age refusal instead of shrugging", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/me/declared-profile",
      headers: auth(),
      payload: { birthDate: "2015-01-01" },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json() as { error: { problem: string; message: string } };
    expect(body.error.problem).toBe("under_age");
    // The message has to say why, or the person just retypes the same date.
    expect(body.error.message).toContain("18");
    expect(body.error.message.length).toBeGreaterThan(40);
  });

  it("never writes a birth date into the events table", async () => {
    // The events table is the least-protected place this data could sit, and
    // the one most likely to be exported. Bands and months only.
    const rows = await db
      .select({ name: schema.events.name, props: schema.events.props })
      .from(schema.events)
      .where(
        and(eq(schema.events.userId, userId), sql`${schema.events.name} like 'profile.%'`),
      );
    expect(rows.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain("1988-03-14");
    expect(serialized).not.toContain("1988");
    const birth = rows.find((r) => r.name === "profile.birth_date_added");
    expect(birth!.props).toMatchObject({ ageBand: "35-44", birthMonth: 3 });
  });

  it("lets a member withdraw the date without losing the reward", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/me/declared-profile",
      headers: auth(),
      payload: { birthDate: null },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { profile: { birthDate: null } }).profile.birthDate).toBeNull();
    const totals = await db
      .select({ total: sql<number>`coalesce(sum(delta), 0)::int` })
      .from(schema.loyaltyLedger)
      .where(eq(schema.loyaltyLedger.userId, userId));
    expect(Number(totals[0]?.total ?? 0)).toBeGreaterThanOrEqual(1500);
  });
});

describe("declared data in the intelligence layer", () => {
  const ev = (name: string, props: Record<string, unknown>) =>
    ({ name, props, ts: new Date("2026-07-01T00:00:00Z") }) as never;

  it("folds the shape, not the data", () => {
    let t = emptyTraits();
    t = foldEvent(t, ev("profile.birth_date_added", { ageBand: "35-44", birthMonth: 3 }));
    t = foldEvent(t, ev("profile.party_added", { adults: 8, children: 3, bands: ["toddler"] }));
    expect(t.declared.ageBand).toBe("35-44");
    expect(t.declared.party).toEqual({ adults: 8, children: 3, bands: ["toddler"] });
  });

  it("prefers what the member stated over what we inferred", () => {
    let t = emptyTraits();
    // Behaviour says a couple; the member says eleven of them.
    t.groupSizeSum = 4;
    t.groupSizeCount = 2;
    t = foldEvent(t, ev("profile.party_added", { adults: 8, children: 3, bands: [] }));

    const venue = { type: "coast", privacy: null, amenities: [] } as never;
    const big = { maxGuests: 12, baseNightly: 0, familyOnly: false } as never;
    const small = { maxGuests: 4, baseNightly: 0, familyOnly: false } as never;

    const bigScore = scoreListing(t, big, venue, 0.5, 0).score;
    const smallScore = scoreListing(t, small, venue, 0.5, 0).score;
    // A four-person chalet fits the *inferred* group perfectly and is still
    // ranked below the twelve-person one, because they told us there are 11.
    expect(bigScore).toBeGreaterThan(smallScore);
  });

  it("can explain the ranking in the member's own terms", () => {
    let t = emptyTraits();
    t = foldEvent(t, ev("profile.party_added", { adults: 8, children: 3, bands: [] }));
    const venue = { type: "coast", privacy: null, amenities: [] } as never;
    const big = { maxGuests: 12, baseNightly: 0, familyOnly: false } as never;
    const { because } = scoreListing(t, big, venue, 0.5, 0);
    expect(because ?? "").toContain("11");
  });
});

describe("the birthday campaign", () => {
  it("gives the gift once per year, however often the job runs", async () => {
    const today = new Date();
    const birthDate = `1990-${String(today.getUTCMonth() + 1).padStart(2, "0")}-${String(
      today.getUTCDate(),
    ).padStart(2, "0")}`;
    /*
     * `birthDateSetAt` is backdated because this test is about idempotency,
     * not tenure — the gift only pays once the date has been on file for
     * BIRTHDAY_TENURE_DAYS, and a fixture that ignored that would be testing a
     * state no real member can be in. The tenure rule has its own tests below.
     */
    const onFileSince = new Date(Date.now() - 400 * 24 * 3600 * 1000);
    await db
      .insert(schema.userPreferences)
      .values({ userId, birthDate, birthDateSetAt: onFileSince, marketingOptIn: false })
      .onConflictDoUpdate({
        target: schema.userPreferences.userId,
        set: { birthDate, birthDateSetAt: onFileSince, marketingOptIn: false },
      });

    const first = await runBirthdayCampaign();
    expect(first.awarded).toBeGreaterThanOrEqual(1);
    // The points are the loyalty programme; the message is marketing. This
    // member opted out of marketing, so they get the gift and no note.
    expect(first.messaged).toBe(0);

    const second = await runBirthdayCampaign();
    const mine = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.loyaltyLedger)
      .where(
        and(
          eq(schema.loyaltyLedger.userId, userId),
          eq(schema.loyaltyLedger.reason, "birthday_gift"),
        ),
      );
    expect(mine[0]!.n).toBe(1);
    expect(second.awarded).toBe(0);
  });
});

/**
 * Farming the profile rewards.
 *
 * Salem asked the right question: what stops someone typing a fake birthday
 * for the points? The answer is not that we can detect a lie — we cannot, and
 * any system that claims to is really just punishing honest people who mistype
 * a year. The answer is that lying has to be worth less than the effort, and
 * that the one path where invented data turns into real cash is closed.
 *
 * The path was specific and cheap: a brand-new account earns 1,000 for signing
 * up, 500 for a date of birth and 1,000 for a party profile — 2,500, below
 * every redemption floor and therefore harmless. Set the birthday to tomorrow
 * and the annual 2,500 gift lands the next morning, taking the account to
 * exactly 5,000: the redemption floor, which buys a voucher at a partner café
 * that Ciao settles in cash. One SIM, one day, no booking.
 *
 * These tests pin that shut, and pin the arithmetic that makes it matter.
 */
describe("resistance to farming", () => {
  /*
   * Its own member, deliberately. The birthday gift is idempotent per calendar
   * year, so a test that shared the user above would be measuring "already
   * paid this year" and reporting it as "the tenure rule worked" — a green
   * test that proves nothing.
   */
  let farmId: string;
  let farmAuth: () => { authorization: string };
  const farmPhone = `+2189${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

  beforeAll(async () => {
    const [u] = await db.insert(schema.users).values({ phone: farmPhone, role: "guest" }).returning();
    farmId = u!.id;
    const t = await signAccessToken({ sub: farmId, role: "guest", phone: farmPhone });
    farmAuth = () => ({ authorization: `Bearer ${t}` });
  });

  afterAll(async () => {
    await db.delete(schema.loyaltyLedger).where(eq(schema.loyaltyLedger.userId, farmId));
    await db.delete(schema.userPreferences).where(eq(schema.userPreferences.userId, farmId));
    await db.delete(schema.events).where(eq(schema.events.userId, farmId));
    await db.delete(schema.users).where(eq(schema.users.id, farmId));
  });

  it("keeps a fresh account's unearned points below the redemption floor", async () => {
    const rules = POINT_RULES;
    const unearned = rules.signup + rules.birth_date_added + rules.party_profile_added;
    // Everything a new account can claim without booking, reviewing, or
    // referring anybody. It must not reach the floor on its own.
    expect(unearned).toBeLessThan(MIN_REDEEM_POINTS);
    // And the birthday gift is exactly what used to close the gap — which is
    // why it is the one that carries a tenure rule.
    expect(unearned + rules.birthday_gift).toBeGreaterThanOrEqual(MIN_REDEEM_POINTS);
  });

  it("pays no birthday gift on a date typed yesterday", async () => {
    const today = new Date();
    const birthDate = `1990-${String(today.getUTCMonth() + 1).padStart(2, "0")}-${String(
      today.getUTCDate(),
    ).padStart(2, "0")}`;
    // The attack, exactly: set your birthday to today, on a date-of-birth
    // field you filled in a moment ago.
    await db
      .insert(schema.userPreferences)
      .values({ userId: farmId, birthDate, birthDateSetAt: new Date(), marketingOptIn: false })
      .onConflictDoUpdate({
        target: schema.userPreferences.userId,
        set: { birthDate, birthDateSetAt: new Date() },
      });

    const result = await runBirthdayCampaign();
    const mine = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.loyaltyLedger)
      .where(
        and(
          eq(schema.loyaltyLedger.userId, farmId),
          eq(schema.loyaltyLedger.reason, "birthday_gift"),
        ),
      );
    expect(mine[0]!.n).toBe(0);
    expect(result.awarded).toBe(0);
  });

  it("pays it once the date has been on file long enough", async () => {
    const today = new Date();
    const birthDate = `1990-${String(today.getUTCMonth() + 1).padStart(2, "0")}-${String(
      today.getUTCDate(),
    ).padStart(2, "0")}`;
    const longAgo = new Date(Date.now() - (BIRTHDAY_TENURE_DAYS + 1) * 24 * 3600 * 1000);
    await db
      .update(schema.userPreferences)
      .set({ birthDate, birthDateSetAt: longAgo })
      .where(eq(schema.userPreferences.userId, farmId));

    const paid = await runBirthdayCampaign();
    expect(paid.awarded).toBeGreaterThanOrEqual(1);
    const mine = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.loyaltyLedger)
      .where(
        and(
          eq(schema.loyaltyLedger.userId, farmId),
          eq(schema.loyaltyLedger.reason, "birthday_gift"),
        ),
      );
    expect(mine[0]!.n).toBe(1);
  });

  it("restarts the clock when the date moves, so the lock cannot be waited out", async () => {
    /*
     * The subtler version of the attack: set a real date, wait out the tenure,
     * then spend your one correction on "tomorrow" and collect immediately.
     */
    const [before] = await db
      .select()
      .from(schema.userPreferences)
      .where(eq(schema.userPreferences.userId, farmId));
    expect(before!.birthDateSetAt!.getTime()).toBeLessThan(Date.now() - 1000);

    const res = await app.inject({
      method: "PATCH",
      url: "/v1/me/declared-profile",
      headers: farmAuth(),
      payload: { birthDate: "1991-06-15" },
    });
    expect(res.statusCode).toBe(200);

    const [after] = await db
      .select()
      .from(schema.userPreferences)
      .where(eq(schema.userPreferences.userId, farmId));
    // Clock reset, correction counted.
    expect(after!.birthDateSetAt!.getTime()).toBeGreaterThan(Date.now() - 10_000);
    expect(after!.birthDateChanges).toBeGreaterThanOrEqual(1);
  });

  it("locks the date after one correction, with a message that explains itself", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/me/declared-profile",
      headers: farmAuth(),
      payload: { birthDate: "1992-07-20" },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json() as { error: { problem: string; message: string } };
    expect(body.error.problem).toBe("locked");
    expect(body.error.message.length).toBeGreaterThan(40);
  });

  it("still lets a member withdraw the date entirely", async () => {
    // Locking corrections must never lock someone out of sharing less. A
    // privacy control that can only be tightened by support is a trap.
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/me/declared-profile",
      headers: farmAuth(),
      payload: { birthDate: null },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { profile: { birthDate: null } }).profile.birthDate).toBeNull();
  });

  it("pays for a party profile exactly once, however often it is rewritten", async () => {
    /*
     * An invented "40 adults" earns the same 1,000 as an honest answer and
     * cannot be re-earned — and it makes that member's own recommendations
     * worse, which is the right incentive and needs no enforcement. The thing
     * worth guarding is the till, not the truth.
     */
    const first = await app.inject({
      method: "PATCH",
      url: "/v1/me/declared-profile",
      headers: farmAuth(),
      payload: { party: { adults: 40, children: 20, bands: ["toddler"] } },
    });
    expect((first.json() as { earned: number }).earned).toBe(POINT_RULES.party_profile_added);

    for (let i = 0; i < 3; i++) {
      const again = await app.inject({
        method: "PATCH",
        url: "/v1/me/declared-profile",
        headers: farmAuth(),
        payload: { party: { adults: 2 + i, children: 0, bands: [] } },
      });
      expect((again.json() as { earned: number }).earned).toBe(0);
    }
  });
});
