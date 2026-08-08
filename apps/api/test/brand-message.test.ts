/**
 * The brand message: the rule that picks one, and the endpoints around it.
 *
 * The selection rule gets pure tests because it is the piece two apps depend
 * on agreeing about — the marketplace deciding what to render and the Ciao
 * Business composer showing an operator what she is about to publish. Every
 * one of these cases is a way a message could look saved and not be on screen,
 * which is the only failure mode this feature really has.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import {
  brandMessageState,
  isScheduledOn,
  libyaDay,
  matchesAudience,
  pickBrandMessage,
  renderBrandMessage,
  type BrandMessage,
} from "@ciao/shared";
import { buildApp } from "../src/app.js";
import { db, pool, schema } from "../src/db/client.js";
import { signAccessToken } from "../src/lib/auth.js";
import { STANDING_MESSAGE } from "../src/modules/business/brand-messages.js";

const run = Date.now().toString().slice(-7);
let app: FastifyInstance;
let opsToken = "";
let guestToken = "";

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

function msg(over: Partial<BrandMessage> & { id: string }): BrandMessage {
  return {
    name: over.id,
    overlineAr: null,
    overlineEn: null,
    headlineAr: "عنوان",
    headlineEn: null,
    accentAr: null,
    accentEn: null,
    bodyAr: null,
    bodyEn: null,
    imageUrl: null,
    imageAltAr: null,
    imageAltEn: null,
    ctaLabelAr: null,
    ctaLabelEn: null,
    ctaHref: null,
    startsOn: null,
    endsOn: null,
    city: null,
    vertical: null,
    priority: 0,
    active: true,
    ...over,
  };
}

beforeAll(async () => {
  app = await buildApp();
  const [ops] = await db
    .insert(schema.users)
    .values({ phone: `+21894700${run.slice(-4)}`, role: "ops" })
    .returning();
  opsToken = await signAccessToken({ sub: ops!.id, role: "ops", phone: ops!.phone }, "biz");
  const [guest] = await db
    .insert(schema.users)
    .values({ phone: `+21894701${run.slice(-4)}`, role: "guest" })
    .returning();
  guestToken = await signAccessToken({ sub: guest!.id, role: "guest", phone: guest!.phone }, "app");
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("the schedule", () => {
  it("treats both ends of the window as days the message runs", () => {
    /*
     * The inclusive end is the whole point. An operator who types "ends on the
     * 16th" means the 16th is an Eid day; an exclusive end would take the
     * greeting down on the morning of the holiday and she would have no way to
     * say what she meant except by typing the 17th and hoping.
     */
    const m = msg({ id: "a", startsOn: "2027-03-12", endsOn: "2027-03-16" });
    expect(isScheduledOn(m, "2027-03-11")).toBe(false);
    expect(isScheduledOn(m, "2027-03-12")).toBe(true);
    expect(isScheduledOn(m, "2027-03-16")).toBe(true);
    expect(isScheduledOn(m, "2027-03-17")).toBe(false);
  });

  it("runs forever at whichever end was left open", () => {
    expect(isScheduledOn(msg({ id: "a", endsOn: "2027-01-01" }), "1999-01-01")).toBe(true);
    expect(isScheduledOn(msg({ id: "a", startsOn: "2027-01-01" }), "2099-01-01")).toBe(true);
    expect(isScheduledOn(msg({ id: "a" }), "2027-06-06")).toBe(true);
  });

  it("never shows a retired message, whatever the dates say", () => {
    expect(isScheduledOn(msg({ id: "a", active: false }), "2027-06-06")).toBe(false);
  });

  it("names the Libyan day, not the UTC one", () => {
    /*
     * Libya is UTC+2 and has not observed daylight saving since 2013. Between
     * midnight and 02:00 local, `toISOString().slice(0,10)` still says
     * yesterday — so a greeting scheduled to start "today" would not appear
     * until two in the morning, during the exact two hours somebody is most
     * likely to be publishing it in a hurry.
     */
    expect(libyaDay(new Date("2027-03-12T00:30:00Z"))).toBe("2027-03-12");
    expect(libyaDay(new Date("2027-03-11T22:30:00Z"))).toBe("2027-03-12");
    expect(libyaDay(new Date("2027-03-11T21:30:00Z"))).toBe("2027-03-11");
  });
});

describe("the audience", () => {
  it("shows an untargeted message to everybody, including a stranger", () => {
    const m = msg({ id: "a" });
    expect(matchesAudience(m, {})).toBe(true);
    expect(matchesAudience(m, { city: "tripoli", vertical: "hall" })).toBe(true);
  });

  it("keeps a targeted message off a page that does not know the audience", () => {
    /*
     * The home page is a static shell served from a CDN: it knows no city. A
     * Tripoli message shown there would reach Misrata, so it is shown nowhere
     * until a page can say who is reading — which is what the composer warns
     * about the moment a city is chosen.
     */
    const tripoli = msg({ id: "a", city: "tripoli" });
    expect(matchesAudience(tripoli, {})).toBe(false);
    expect(matchesAudience(tripoli, { city: "misrata" })).toBe(false);
    expect(matchesAudience(tripoli, { city: "tripoli" })).toBe(true);
  });

  it("requires every named dimension to match, not just one", () => {
    const m = msg({ id: "a", city: "tripoli", vertical: "hall" });
    expect(matchesAudience(m, { city: "tripoli", vertical: "coast" })).toBe(false);
    expect(matchesAudience(m, { city: "tripoli", vertical: "hall" })).toBe(true);
  });
});

describe("which message wins", () => {
  const day = "2027-03-14";

  it("takes the higher priority", () => {
    const winner = pickBrandMessage(
      [msg({ id: "a", priority: 1 }), msg({ id: "b", priority: 9 })],
      day,
    );
    expect(winner?.id).toBe("b");
  });

  it("prefers the more specific message when priorities tie", () => {
    /*
     * This is the rule that stops a routine edit wrecking a campaign. The
     * standing copy is untargeted and never expires, so it is always a
     * candidate; without specificity beating recency, editing it would make it
     * the newest row and silently outrank a Tripoli campaign scheduled a
     * fortnight ago.
     */
    const winner = pickBrandMessage(
      [msg({ id: "general" }), msg({ id: "tripoli-halls", city: "tripoli", vertical: "hall" })],
      day,
      { city: "tripoli", vertical: "hall" },
    );
    expect(winner?.id).toBe("tripoli-halls");
  });

  it("does not depend on the order the rows came back in", () => {
    const rows = [
      msg({ id: "11111111-1111-1111-1111-111111111111", priority: 5 }),
      msg({ id: "22222222-2222-2222-2222-222222222222", priority: 5 }),
    ];
    const forwards = pickBrandMessage(rows, day)?.id;
    const backwards = pickBrandMessage([...rows].reverse(), day)?.id;
    expect(forwards).toBe(backwards);
  });

  it("returns nothing rather than something out of season", () => {
    expect(pickBrandMessage([msg({ id: "a", endsOn: "2027-01-01" })], day)).toBeNull();
  });

  it("explains why a message is not on screen", () => {
    const eid = msg({ id: "eid", priority: 9 });
    const all = [eid, msg({ id: "quiet", priority: 1 }), msg({ id: "old", endsOn: "2020-01-01" })];
    expect(brandMessageState(eid, all, day)).toBe("live");
    expect(brandMessageState(all[1]!, all, day)).toBe("outranked");
    expect(brandMessageState(all[2]!, all, day)).toBe("expired");
    expect(brandMessageState(msg({ id: "z", startsOn: "2099-01-01" }), all, day)).toBe("scheduled");
    expect(brandMessageState(msg({ id: "z", active: false }), all, day)).toBe("retired");
  });
});

describe("what it says in each language", () => {
  it("falls back field by field, keeping the translation that exists", () => {
    /*
     * The common half-translated message: somebody translated the headline and
     * not the paragraph. Falling back wholesale would throw away the work that
     * was done, and marking the whole band Arabic would then lie about the
     * headline — which is why the flag is per field.
     */
    const m = msg({
      id: "a",
      headlineAr: "عيد مبارك",
      headlineEn: "Eid Mubarak",
      bodyAr: "كل عام وأنتم بخير",
    });
    const en = renderBrandMessage(m, "en");
    expect(en.headline).toEqual({ text: "Eid Mubarak", ar: false });
    expect(en.body).toEqual({ text: "كل عام وأنتم بخير", ar: true });
  });

  it("marks an untranslated headline as Arabic so the page can declare it", () => {
    const en = renderBrandMessage(msg({ id: "a", headlineAr: "عيد مبارك" }), "en");
    expect(en.headline.ar).toBe(true);
  });

  it("never marks the Arabic page's own Arabic as a fallback", () => {
    const ar = renderBrandMessage(msg({ id: "a", headlineAr: "عيد مبارك" }), "ar");
    expect(ar.headline.ar).toBe(false);
  });

  it("treats whitespace as absent, because a space is not a translation", () => {
    const en = renderBrandMessage(msg({ id: "a", headlineAr: "عيد", headlineEn: "   " }), "en");
    expect(en.headline).toEqual({ text: "عيد", ar: true });
  });
});

describe("over HTTP", () => {
  /*
   * These run against a database somebody else's fixtures — and, in staging,
   * somebody's actual content calendar — have already written to. Selection is
   * global by design: an untargeted message addresses everyone, so a live row
   * anywhere changes what `/v1/brand-message` answers.
   *
   * So nothing here asserts "the standing copy is showing", which is a claim
   * about the whole table. That property belongs to `pickBrandMessage` and is
   * tested purely above, where a clean world can actually be constructed. What
   * is asserted here is what this layer alone owns: a message these tests
   * created outranks whatever else is live, disappears when retired, and is
   * withheld from an audience it was not addressed to.
   *
   * Priority 90 is the isolation. It is above anything an operator would
   * plausibly type and below the ceiling, so a test message wins for as long
   * as the test wants it to and nothing has to be deleted first.
   */
  const TEST_PRIORITY = 90;
  const created: string[] = [];

  afterAll(async () => {
    for (const id of created)
      await db.delete(schema.brandMessages).where(eq(schema.brandMessages.id, id));
  });

  async function create(payload: Record<string, unknown>) {
    const res = await app.inject({
      method: "POST",
      url: "/v1/biz/brand-messages",
      headers: auth(opsToken),
      payload: { name: `t-${run}`, headlineAr: "عنوان", priority: TEST_PRIORITY, ...payload },
    });
    if (res.statusCode === 201) created.push(res.json().id);
    return res;
  }

  const headlineNow = async (query = "locale=ar") =>
    (await app.inject({ method: "GET", url: `/v1/brand-message?${query}` })).json().headline.text;

  it("always answers with something to put on the page", async () => {
    /*
     * The band must never be empty, whatever the table contains — including
     * nothing. The founder's line is a constant in the bundle rather than a
     * seeded row precisely so it survives an empty database and an operator
     * who retires everything on a Thursday afternoon.
     */
    const res = await app.inject({ method: "GET", url: "/v1/brand-message?locale=ar" });
    expect(res.statusCode).toBe(200);
    expect(res.json().headline.text.length).toBeGreaterThan(0);
  });

  it("shows the standing copy when it is the only thing in the world", () => {
    expect(pickBrandMessage([STANDING_MESSAGE], libyaDay())?.headlineAr).toBe(
      STANDING_MESSAGE.headlineAr,
    );
  });

  it("puts a scheduled message on the page and takes it off again", async () => {
    const today = libyaDay();
    const headline = `عيد مبارك ${run}`;
    const r = await create({
      name: `eid-${run}`,
      headlineAr: headline,
      startsOn: today,
      endsOn: today,
    });
    expect(r.statusCode).toBe(201);
    expect(await headlineNow()).toBe(headline);

    await app.inject({
      method: "DELETE",
      url: `/v1/biz/brand-messages/${r.json().id}`,
      headers: auth(opsToken),
    });
    expect(await headlineNow()).not.toBe(headline);
  });

  it("stops showing a message the day after it ends", async () => {
    /*
     * The window is enforced in SQL as well as in the shared rule, and this is
     * the assertion that catches the two disagreeing — a message whose end
     * date has passed must not even be a candidate.
     */
    const headline = `أمس ${run}`;
    const r = await create({ headlineAr: headline, endsOn: "2020-01-01" });
    expect(r.statusCode).toBe(201);
    expect(await headlineNow()).not.toBe(headline);
  });

  it("keeps a city message off the home page and shows it on that city's search", async () => {
    const headline = `عروض طرابلس ${run}`;
    const r = await create({
      name: `tripoli-${run}`,
      headlineAr: headline,
      city: "tripoli",
      priority: TEST_PRIORITY + 5,
    });
    expect(r.statusCode).toBe(201);

    // The home page asks with no audience — a static shell knows nobody.
    expect(await headlineNow("locale=ar")).not.toBe(headline);
    expect(await headlineNow("locale=ar&city=misrata")).not.toBe(headline);
    expect(await headlineNow("locale=ar&city=tripoli&vertical=coast")).toBe(headline);
  });

  it("refuses a window that ends before it starts", async () => {
    const res = await create({ startsOn: "2027-03-16", endsOn: "2027-03-12" });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toContain("window_ends_before_it_starts");
  });

  it("refuses to point the band anywhere but Ciao", async () => {
    /*
     * The most prominent band on the home page is the last place an open
     * redirect belongs. `//evil.example` is the interesting one: a browser
     * reads a protocol-relative URL as another origin, so refusing only
     * `http://` would leave the hole open.
     */
    for (const href of ["https://evil.example", "//evil.example", "javascript:alert(1)"]) {
      const res = await create({ ctaLabelAr: "اضغط", ctaHref: href });
      expect(res.statusCode, href).toBe(400);
    }
    const ok = await create({ ctaLabelAr: "اضغط", ctaHref: "/search?type=hall" });
    expect(ok.statusCode).toBe(201);
  });

  it("refuses a marketplace session, however valid", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/biz/brand-messages",
      headers: auth(guestToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it("keeps a retired message in the calendar rather than deleting it", async () => {
    const r = await create({ name: `retire-${run}`, headlineAr: "قديم" });
    await app.inject({
      method: "DELETE",
      url: `/v1/biz/brand-messages/${r.json().id}`,
      headers: auth(opsToken),
    });
    const list = await app.inject({
      method: "GET",
      url: "/v1/biz/brand-messages",
      headers: auth(opsToken),
    });
    const row = list.json().items.find((i: { id: string }) => i.id === r.json().id);
    expect(row, "a retired message is still in the list").toBeTruthy();
    expect(row.active).toBe(false);
  });
});
