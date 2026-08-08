"use client";
/**
 * The Facebook kit.
 *
 * Every venue worth signing in this market already sells on a Facebook page and
 * a WhatsApp number. The price list is a photograph of a poster. Availability is
 * a reply. A booking is a phone call between eleven and five, to an office that
 * may not even be in the same building as the property. Lancaster Al Salam has
 * forty-four thousand followers and nowhere to send a single one of them at
 * midnight.
 *
 * So this screen is not a marketing dashboard. It is a kit: **a link to pin, a
 * post to paste, and a code to announce** — in that order, because that is the
 * order the value arrives in. A receptionist who opens this tab and taps twice
 * should have an Arabic post sitting in her clipboard, ready for the composer.
 * Everything else on the page is subordinate to that.
 *
 * Three decisions worth stating, because they are not obvious from the code:
 *
 *  - **The link is copied with a channel tag** (`?src=fb`, `?src=wa`,
 *    `?src=ig`). The partner does not care about attribution today. They care
 *    about it enormously the first time this screen can tell them their
 *    Instagram brought four bookings and their Facebook brought forty — and the
 *    only moment we can capture that is the moment they copy the link. Hence
 *    three buttons rather than one, each named after the place it is going.
 *  - **The post body is always Arabic**, whichever language the console is in.
 *    Its reader is not the partner; it is the venue's followers, and they read
 *    Arabic. An English-reading manager gets English labels around an Arabic
 *    post, which is exactly right and is why that text does not live in the
 *    bilingual `copy` object below.
 *  - **Posting the link needs `diary`; deciding what it costs needs `money`.**
 *    The person who runs the Facebook page at a Libyan resort is very often the
 *    receptionist, and gating the link behind the money screens would stop the
 *    right person doing the one thing we most want done. The offer form is
 *    absent — not disabled — for anyone without `money`, matching how the rest
 *    of the console treats capability.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, api, fmtLyd } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { CITIES, UI, fmtDateTime, term } from "@/lib/vocab";
import { hostText, textProps } from "@/lib/content";
import type { Locale } from "@/lib/i18n";
import { Bars, Pill, Section } from "@/components/panel";
import type { PartnerMe, PartnerOffer, Storefront, StorefrontVenue } from "./types";

/** The percentages a partner actually reaches for, and the free field for the rest. */
const PCT_CHIPS = [5, 10, 15, 20];
/** A flash offer that outlives a weekend is not a flash offer. */
const HOUR_CHIPS = [24, 48, 72];

const copy = {
  ar: {
    title: "كيت الفيسبوك",
    hint: "عندك صفحة ومتابعين — ينقصك رابط تبعتهم عليه. هذا هو، وهذا منشور جاهز تلصقه فيه.",
    failed: "تعذر التحميل — تأكد من الاتصال وأعد المحاولة",
    noVenues:
      "ما في مكان مربوط بحسابك بعد. كلّم فريق تشاو وإحنا نربطه ونجهّز لك الرابط.",
    linkTitle: "رابط الحجز حقك",
    linkHint: "ثبّته في أعلى صفحتك وفي البايو — يشتغل ليل نهار وما يحتاج مكالمة.",
    noSlug: "الرابط قيد التجهيز",
    noSlugBody:
      "فريق تشاو لسه يجهّز رابط هذا المكان. كلّمهم وإحنا نفعّله لك — ما نبي نعطيك رابط ينكسر قدام متابعينك.",
    copyFb: "انسخ للفيسبوك",
    copyWa: "انسخ للواتساب",
    copyIg: "انسخ للإنستقرام",
    copied: "انتسخ",
    tagHint: "كل زر ينسخ نفس الرابط بعلامة تدل من وين جاك الحجز — عشان تعرف بعدين أي قناة تجيب لك شغل.",
    postTitle: "منشور جاهز للنشر",
    postHint: "انسخه والصقه في صفحتك مباشرة. عدّل عليه براحتك — هو نقطة بداية مش نص مقدّس.",
    copyPost: "انسخ المنشور",
    offerTitle: "عرض سريع",
    offerHint: "خصم بمدة محددة، ينتهي لحاله. هو اللي يخلي الناس تحجز اليوم بدل ما تفكر.",
    livePrefix: "عرض شغّال",
    code: "الكود",
    used: (n: number, max: number | null) =>
      max === null ? `استُخدم ${n} مرة` : `استُخدم ${n} من ${max}`,
    endsAt: (when: string) => `ينتهي ${when}`,
    remaining: (h: number, m: number) =>
      h > 0 ? `باقي ${h} ساعة و${m} دقيقة` : `باقي ${m} دقيقة`,
    remainingSoon: "على وشك الانتهاء",
    stop: "أوقف العرض",
    stopped: "وقّفنا العرض",
    newOffer: "أطلق عرض",
    replaceOffer: "عرض جديد بدل هذا",
    pct: "نسبة الخصم",
    pctOther: "أو اكتب نسبة",
    hours: "مدة العرض",
    hoursUnit: (h: number) => `${h} ساعة`,
    maxRedemptions: "أقصى عدد استخدامات (اختياري)",
    maxRedemptionsHint: "خلّيه فاضي لو ما تبي سقف.",
    description: "سطر يوصف العرض (اختياري)",
    descriptionPh: "شامل الإفطار",
    whoseMoney: "الخصم من فلوسك أنت",
    whoseMoneyBody: (pct: number) =>
      `خصم ${pct}% ينزل من سعرك أنت، مش من عمولة تشاو. وعمولتنا نسبة من إجمالي الحجز، يعني هي كمان تنزل ${pct}% معاك. ما في طرف يدفع عن الثاني.`,
    launch: "أطلق العرض",
    launching: "جارٍ الإطلاق…",
    launched: "انطلق العرض — انسخ المنشور فوق وانشره",
    supersedes: "عندك عرض شغّال على هذا المكان — العرض الجديد يوقفه ويحل محله.",
    offerFailed: "تعذر إطلاق العرض",
    noOffer: "ما في عرض شغّال على هذا المكان.",
    attrTitle: "من وين جاك الحجز",
    attrHint: "قيمة الحجوزات حسب القناة اللي جا منها الزبون.",
    attrEmpty:
      "ما في حجوزات من الرابط بعد. انشر الرابط في صفحتك وارجع لهنا بعد أسبوع — الأرقام تبين هنا لحالها.",
    sources: {
      fb: "فيسبوك",
      wa: "واتساب",
      ig: "إنستقرام",
      qr: "كود QR",
      tt: "تيك توك",
      direct: "مباشر",
    } as Record<string, string>,
    bookingsCount: (n: number) => `${n} حجز`,
  },
  en: {
    title: "Facebook kit",
    hint: "You have the page and the followers — what's missing is a link to send them to. Here it is, with a post ready to paste.",
    failed: "Could not load — check your connection and try again",
    noVenues:
      "No place is attached to your account yet. Talk to the Ciao team and we'll link it and prepare your link.",
    linkTitle: "Your booking link",
    linkHint: "Pin it to the top of your page and put it in the bio — it works day and night, and it needs no phone call.",
    noSlug: "Your link is being prepared",
    noSlugBody:
      "The Ciao team is still setting up this place's link. Talk to them and we'll turn it on — we won't hand you a link that breaks in front of your followers.",
    copyFb: "Copy for Facebook",
    copyWa: "Copy for WhatsApp",
    copyIg: "Copy for Instagram",
    copied: "Copied",
    tagHint: "Each button copies the same link with a tag saying where it went — that's how you'll know later which channel actually brings you work.",
    postTitle: "A post, ready to publish",
    postHint: "Copy it and paste it straight onto your page. Change whatever you like — it's a starting point, not scripture.",
    copyPost: "Copy the post",
    offerTitle: "Flash offer",
    offerHint: "A discount with an end time that arrives by itself. It's what makes people book today instead of thinking about it.",
    livePrefix: "Offer running",
    code: "Code",
    used: (n: number, max: number | null) => (max === null ? `Used ${n} times` : `Used ${n} of ${max}`),
    endsAt: (when: string) => `Ends ${when}`,
    remaining: (h: number, m: number) => (h > 0 ? `${h}h ${m}m left` : `${m}m left`),
    remainingSoon: "About to end",
    stop: "Stop the offer",
    stopped: "Offer stopped",
    newOffer: "Run an offer",
    replaceOffer: "Replace it with a new one",
    pct: "Discount",
    pctOther: "Or type a percentage",
    hours: "How long it runs",
    hoursUnit: (h: number) => `${h} hours`,
    maxRedemptions: "Maximum redemptions (optional)",
    maxRedemptionsHint: "Leave it empty for no cap.",
    description: "A line describing the offer (optional)",
    descriptionPh: "Breakfast included",
    whoseMoney: "The discount is your money",
    whoseMoneyBody: (pct: number) =>
      `A ${pct}% offer comes off your price, not off Ciao's commission. Our commission is a percentage of the booking total, so it falls ${pct}% with you. Neither side subsidises the other.`,
    launch: "Launch the offer",
    launching: "Launching…",
    launched: "The offer is live — copy the post above and publish it",
    supersedes: "You already have an offer running on this place — a new one stops it and takes its place.",
    offerFailed: "Could not launch the offer",
    noOffer: "No offer is running on this place.",
    attrTitle: "Where your bookings came from",
    attrHint: "The value of bookings, by the channel the guest arrived through.",
    attrEmpty:
      "No bookings through the link yet. Publish it on your page and come back in a week — the numbers appear here on their own.",
    sources: {
      fb: "Facebook",
      wa: "WhatsApp",
      ig: "Instagram",
      qr: "QR code",
      tt: "TikTok",
      direct: "Direct",
    } as Record<string, string>,
    bookingsCount: (n: number) => `${n} booking(s)`,
  },
} satisfies Record<Locale, unknown>;

/**
 * The post the partner publishes.
 *
 * Deliberately outside the bilingual `copy` object: its audience is the venue's
 * Arabic-reading followers, so it is Arabic in both consoles. It is written the
 * way a Libyan page owner writes — short lines, one idea each, no corporate
 * throat-clearing — and the digits are Western, because that is what a Facebook
 * post in Libya actually uses even when everything around it is Arabic.
 *
 * The URL goes on its own line: Facebook only builds a link preview card when
 * the URL is not buried mid-sentence, and that card is most of the reason
 * someone taps.
 */
function facebookPost(name: string, url: string, offer: PartnerOffer | null, hoursLeft: number) {
  const lines = [`${name} 🌊`, ""];
  if (offer) {
    lines.push(`عرض خاص: خصم ${Math.round(offer.value / 100)}% على الحجز.`);
    if (offer.descriptionAr) lines.push(offer.descriptionAr);
    lines.push(`الكود: ${offer.code}`);
    // "Less than an hour" rather than "0 hours left" — the second one reads as
    // a bug and kills the urgency the whole post is built on.
    lines.push(hoursLeft >= 1 ? `باقي ${hoursLeft} ساعة على نهايته ⏳` : "العرض على وشك الانتهاء ⏳");
    lines.push("");
    lines.push("احجز من هنا واكتب الكود عند الحجز:");
  } else {
    lines.push("تقدر تحجز من هنا مباشرة — أي وقت، ليل نهار، بلا مكالمات ولا انتظار.");
    lines.push("تشوف الأسعار والتواريخ المتاحة وتأكد حجزك في دقيقة.");
    lines.push("");
  }
  lines.push(url);
  return lines.join("\n");
}

/**
 * Copy, with the confirmation attached to the button that was pressed.
 *
 * Three copy buttons sit side by side here, and a single shared "copied"
 * message somewhere else on the page would leave the partner unsure which tag
 * they just took. When the clipboard is unavailable — an old webview, or the
 * console served over plain http on someone's laptop — nothing is claimed: the
 * link and the post are both selectable text on the screen, which is the
 * fallback.
 */
function CopyButton({
  label,
  copiedLabel,
  text,
  className = "chip !text-xs font-bold",
}: {
  label: string;
  copiedLabel: string;
  text: string;
  className?: string;
}) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 2500);
    return () => clearTimeout(t);
  }, [done]);
  async function run() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
    } catch {
      /* no clipboard — the text stays on screen and selectable */
    }
  }
  return (
    <button type="button" className={className} onClick={() => void run()}>
      {done ? `✓ ${copiedLabel}` : label}
    </button>
  );
}

/** A clock that only ticks while there is a countdown on the screen to move. */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    // Half a minute: fast enough that "2h 14m left" is never visibly stale,
    // slow enough that a partner leaving this tab open on a phone all afternoon
    // is not re-rendering it once a second for no reason.
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

interface Draft {
  pct: string;
  hours: number;
  maxRedemptions: string;
  descriptionAr: string;
}

const EMPTY_DRAFT: Draft = { pct: "10", hours: 24, maxRedemptions: "", descriptionAr: "" };

export function FacebookTab({ me }: { me: PartnerMe }) {
  const locale = useLocale();
  const c = copy[locale];
  const [data, setData] = useState<Storefront | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  /** Which venue's offer form is open. One at a time — this is a phone screen. */
  const [drafting, setDrafting] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  /*
   * The `partnerId` scope every other tab sends, so a manager working for
   * someone else's business asks about that business rather than their own.
   * The storefront routes resolve the partner from the session today and do not
   * yet read this parameter; sending it costs nothing and means this screen is
   * already correct the day they do.
   */
  const scope = `partnerId=${me.partnerId}`;
  const canPrice = me.capabilities.includes("money");

  const load = useCallback(async () => {
    try {
      setData(await api<Storefront>(`/v1/partner/storefront?${scope}`));
      setState("ready");
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : c.failed);
      setState("error");
    }
  }, [scope, c.failed]);

  useEffect(() => {
    void load();
  }, [load]);

  const liveOffers = useMemo(() => {
    const map = new Map<string, PartnerOffer>();
    for (const o of data?.offers ?? []) {
      if (o.live && !map.has(o.venueId)) map.set(o.venueId, o);
    }
    return map;
  }, [data]);

  const now = useNow(liveOffers.size > 0);

  /*
   * The percentage, twice over: once as a validity test for the button, and
   * once clamped for the sentence that quotes it back at them. The second one
   * has to keep making sense while somebody is halfway through typing "15",
   * which is why it clamps rather than refusing.
   */
  const pctValue = Number(draft.pct);
  const pctValid = Number.isFinite(pctValue) && pctValue >= 1 && pctValue <= 40;
  const pctPreview = Math.max(0, Math.min(40, Number.isFinite(pctValue) ? pctValue : 0));

  async function launch(venue: StorefrontVenue) {
    const pct = Number(draft.pct);
    if (!Number.isFinite(pct) || pct < 1 || pct > 40) return;
    setBusy(true);
    setMessage("");
    try {
      await api(`/v1/partner/offers?${scope}`, {
        method: "POST",
        body: JSON.stringify({
          venueId: venue.id,
          valueBps: Math.round(pct * 100),
          hours: draft.hours,
          ...(draft.descriptionAr.trim() ? { descriptionAr: draft.descriptionAr.trim() } : {}),
          ...(Number(draft.maxRedemptions) > 0
            ? { maxRedemptions: Number(draft.maxRedemptions) }
            : {}),
        }),
      });
      setDrafting(null);
      setDraft(EMPTY_DRAFT);
      setMessage(c.launched);
      await load();
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : c.offerFailed);
    } finally {
      setBusy(false);
    }
  }

  async function stop(offer: PartnerOffer) {
    setBusy(true);
    try {
      await api(`/v1/partner/offers/${offer.id}/stop?${scope}`, { method: "POST" });
      setMessage(c.stopped);
      await load();
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : c.offerFailed);
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return <p className="p-4 text-faint">{term(UI, locale, "loading")}</p>;
  if (state === "error" || !data)
    return (
      <Section title={c.title}>
        <p className="text-sm text-muted">{message || c.failed}</p>
        <button className="btn-primary !py-2 !px-5 !text-sm mt-3" onClick={() => void load()}>
          {term(UI, locale, "retry")}
        </button>
      </Section>
    );

  if (data.venues.length === 0)
    return (
      <Section title={c.title} hint={c.hint}>
        <p className="text-sm text-muted">{c.noVenues}</p>
      </Section>
    );

  return (
    <>
      {/*
        One paragraph of why, above the kit itself. A partner who has never
        heard the argument needs it once; after that this is furniture and the
        link below it is the product.
      */}
      <div className="card p-4">
        <h2 className="font-bold text-sea">{c.title}</h2>
        <p className="text-sm text-muted mt-1">{c.hint}</p>
      </div>

      {data.venues.map((venue) => {
        /*
          The venue's own name, marked as whichever language it is actually in.
          «لانكستر السلام» inside an otherwise English console has to declare
          itself as Arabic, or a screen reader spells it out letter by letter in
          an English accent — the same rule the listing titles follow.
        */
        const name = hostText(locale, venue.nameAr, venue.nameEn);
        const url = venue.storefrontPath ? `${data.webBaseUrl}${venue.storefrontPath}` : null;
        const offer = liveOffers.get(venue.id) ?? null;
        const msLeft = offer?.endsAt ? Math.max(0, new Date(offer.endsAt).getTime() - now) : 0;
        const hoursLeft = Math.floor(msLeft / 3_600_000);
        const minutesLeft = Math.floor((msLeft % 3_600_000) / 60_000);
        const post = url ? facebookPost(venue.nameAr, `${url}?src=fb`, offer, hoursLeft) : "";
        const rows = data.attribution
          .filter((a) => a.venueId === venue.id && a.value > 0)
          .sort((a, b) => b.value - a.value);

        return (
          <section key={venue.id} className="mt-6">
            <div className="flex items-center gap-2 flex-wrap px-1">
              <h2
                className="font-bold text-sea text-lg"
                {...(name ? textProps(name) : {})}
              >
                {name?.text ?? venue.slug ?? ""}
              </h2>
              <span className="text-xs text-faint">{term(CITIES, locale, venue.city)}</span>
              {offer ? <Pill tone="green">{c.livePrefix}</Pill> : null}
            </div>

            <Section title={c.linkTitle} hint={url ? c.linkHint : undefined}>
              {url ? (
                <>
                  {/*
                    The link, first and largest.

                    `select-all` so one long-press on a phone takes the whole
                    URL: a partner whose browser refuses the clipboard still has
                    to be able to get the link out, and a half-selected URL is
                    how somebody ends up publishing a broken one. `dir="ltr"`
                    because a URL is Latin text inside a right-to-left page and
                    would otherwise be reordered around its slashes.
                  */}
                  <p
                    className="select-all break-all font-inter font-bold text-lg text-link bg-sand rounded-2xl p-3"
                    dir="ltr"
                  >
                    {url}
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <CopyButton
                      label={c.copyFb}
                      copiedLabel={c.copied}
                      text={`${url}?src=fb`}
                      className="btn-primary !py-2 !px-4 !text-sm"
                    />
                    <CopyButton label={c.copyWa} copiedLabel={c.copied} text={`${url}?src=wa`} />
                    <CopyButton label={c.copyIg} copiedLabel={c.copied} text={`${url}?src=ig`} />
                  </div>
                  <p className="text-[11px] text-faint mt-2">{c.tagHint}</p>
                </>
              ) : (
                /*
                  No slug yet. Ops assigns these by hand, and the honest thing is
                  to say the link is coming — a partner who pins a 404 in front
                  of forty-four thousand followers does not come back and pin the
                  real one later.
                */
                <>
                  <p className="font-bold text-sea">{c.noSlug}</p>
                  <p className="text-sm text-muted mt-1">{c.noSlugBody}</p>
                </>
              )}
            </Section>

            {/*
              The post. This is the whole screen's reason to exist: opening the
              tab and tapping copy is two taps, and what lands in the clipboard
              is publishable as it stands.
            */}
            {url ? (
              <Section
                title={c.postTitle}
                hint={c.postHint}
                action={
                  <CopyButton
                    label={c.copyPost}
                    copiedLabel={c.copied}
                    text={post}
                    className="btn-primary !py-2 !px-4 !text-sm"
                  />
                }
              >
                <p
                  className="whitespace-pre-line select-all rounded-2xl bg-sand p-3 text-sm text-sea border-s-4 border-amber"
                  lang="ar"
                  dir="rtl"
                >
                  {post}
                </p>
              </Section>
            ) : null}

            {/*
              Offers. Absent, not disabled, for anyone without `money` — the
              receptionist posts the link, the owner decides what it costs, and a
              screen that exists to refuse is a screen somebody works around.
            */}
            {canPrice ? (
              <Section title={c.offerTitle} hint={c.offerHint}>
                {offer ? (
                  <div className="rounded-2xl bg-sand p-4">
                    <p className="text-[11px] font-bold text-muted">{c.code}</p>
                    {/*
                      The code is set large, spaced and selectable because it is
                      retyped off one phone screen by somebody holding another
                      one. The alphabet the API draws from already excludes
                      0/O and 1/I for the same reason.
                    */}
                    <p
                      className="select-all font-inter font-extrabold text-3xl tracking-widest text-sea"
                      dir="ltr"
                    >
                      {offer.code}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <Pill tone="amber">
                        {msLeft > 0 ? c.remaining(hoursLeft, minutesLeft) : c.remainingSoon}
                      </Pill>
                      <Pill>{`${Math.round(offer.value / 100)}%`}</Pill>
                      <Pill>{c.used(offer.timesUsed, offer.maxRedemptions)}</Pill>
                    </div>
                    {offer.descriptionAr ? (
                      <p className="text-sm text-muted mt-2" lang="ar" dir="rtl">
                        {offer.descriptionAr}
                      </p>
                    ) : null}
                    {offer.endsAt ? (
                      <p className="text-[11px] text-faint mt-2">
                        {c.endsAt(fmtDateTime(locale, offer.endsAt))}
                      </p>
                    ) : null}
                    <button
                      className="btn-secondary !py-2 !px-4 !text-sm mt-3"
                      disabled={busy}
                      onClick={() => void stop(offer)}
                    >
                      {c.stop}
                    </button>
                  </div>
                ) : drafting === venue.id ? null : (
                  <p className="text-sm text-faint">{c.noOffer}</p>
                )}

                {drafting === venue.id ? (
                  <div className="mt-3">
                    <p className="text-xs font-bold text-muted">{c.pct}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      {PCT_CHIPS.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setDraft({ ...draft, pct: String(p) })}
                          className={`rounded-full px-3 py-1 text-[11px] font-bold ${
                            /*
                              `text-surface` rather than `text-white`: it is
                              white in the light theme and gets re-pointed with
                              the rest of the palette in the dark one, and this
                              app is audited for contrast in both.
                            */
                            Number(draft.pct) === p ? "bg-sea text-surface" : "bg-sand text-muted"
                          }`}
                        >
                          {p}%
                        </button>
                      ))}
                      {/*
                        The free field is not a fallback for the chips, it is the
                        escape hatch for the partner who has already decided on
                        12%. Digits only, and the API refuses anything over 40%
                        anyway — a bigger discount than that is a typo, not a
                        campaign.
                      */}
                      <label className="flex items-center gap-1 text-[11px] text-faint ms-1">
                        <span>{c.pctOther}</span>
                        <input
                          className="input !py-1 !px-2 !text-sm !w-16 tabular-nums"
                          inputMode="numeric"
                          dir="ltr"
                          value={draft.pct}
                          onChange={(e) =>
                            setDraft({ ...draft, pct: e.target.value.replace(/[^0-9]/g, "") })
                          }
                        />
                      </label>
                    </div>

                    <p className="text-xs font-bold text-muted mt-3">{c.hours}</p>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {HOUR_CHIPS.map((h) => (
                        <button
                          key={h}
                          type="button"
                          onClick={() => setDraft({ ...draft, hours: h })}
                          className={`rounded-full px-3 py-1 text-[11px] font-bold ${
                            draft.hours === h ? "bg-sea text-surface" : "bg-sand text-muted"
                          }`}
                        >
                          {c.hoursUnit(h)}
                        </button>
                      ))}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 mt-3">
                      <label className="text-sm">
                        <span className="text-xs font-bold text-muted">{c.maxRedemptions}</span>
                        <input
                          className="input !py-2 !text-sm mt-1 tabular-nums"
                          inputMode="numeric"
                          dir="ltr"
                          value={draft.maxRedemptions}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              maxRedemptions: e.target.value.replace(/[^0-9]/g, ""),
                            })
                          }
                        />
                        <span className="block text-[11px] text-faint mt-1">
                          {c.maxRedemptionsHint}
                        </span>
                      </label>
                      <label className="text-sm">
                        {/*
                          The description is published to guests, who read
                          Arabic — so the field is Arabic in both consoles, the
                          same rule the post body follows.
                        */}
                        <span className="text-xs font-bold text-muted">{c.description}</span>
                        <input
                          className="input !py-2 !text-sm mt-1"
                          lang="ar"
                          dir="rtl"
                          maxLength={160}
                          placeholder={c.descriptionPh}
                          value={draft.descriptionAr}
                          onChange={(e) => setDraft({ ...draft, descriptionAr: e.target.value })}
                        />
                      </label>
                    </div>

                    {/*
                      Whose money this is, said before they commit rather than
                      discovered in a statement three weeks later. Ciao-funded
                      promo codes come out of our commission; a partner's flash
                      offer is their own price coming down, and our commission —
                      being a percentage of the total — falls proportionally
                      with it. Both halves are stated, because a partner who
                      believes we are untouched by their discount stops
                      believing the numbers next to it.
                    */}
                    <div className="rounded-2xl bg-sand p-3 mt-3">
                      <p className="font-bold text-sea text-sm">{c.whoseMoney}</p>
                      <p className="text-sm text-muted mt-1">{c.whoseMoneyBody(pctPreview)}</p>
                    </div>

                    {offer ? <p className="text-[11px] text-danger mt-2">{c.supersedes}</p> : null}

                    <div className="flex gap-2 mt-3">
                      <button
                        className="btn-primary !py-2 !px-5 !text-sm"
                        disabled={busy || !pctValid}
                        onClick={() => void launch(venue)}
                      >
                        {busy ? c.launching : c.launch}
                      </button>
                      <button className="chip !text-sm font-bold" onClick={() => setDrafting(null)}>
                        {term(UI, locale, "cancel")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className={
                      offer ? "chip !text-sm font-bold mt-3" : "btn-primary !py-2 !px-5 !text-sm mt-3"
                    }
                    onClick={() => {
                      setDrafting(venue.id);
                      setDraft(EMPTY_DRAFT);
                    }}
                  >
                    {offer ? c.replaceOffer : c.newOffer}
                  </button>
                )}
              </Section>
            ) : null}

            {/*
              What the page is worth.

              Money by channel, one measure per panel, with the booking count
              printed in the label rather than encoded in the picture. An empty
              chart would imply we measured and found zero; before the link has
              been published there is nothing to measure, so it says that
              instead.
            */}
            <Section title={c.attrTitle} hint={rows.length > 0 ? c.attrHint : undefined}>
              {rows.length === 0 ? (
                <p className="text-sm text-faint">{c.attrEmpty}</p>
              ) : (
                <Bars
                  rows={rows.map((a) => ({
                    label: `${c.sources[a.source] ?? a.source} · ${c.bookingsCount(a.bookings)}`,
                    value: a.value,
                  }))}
                  format={(n) => fmtLyd(n, locale)}
                />
              )}
            </Section>
          </section>
        );
      })}

      {message ? <p className="card p-3 mt-4 text-sm font-bold text-sea">{message}</p> : null}
    </>
  );
}
