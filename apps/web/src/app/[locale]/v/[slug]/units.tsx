"use client";
/**
 * The unit picker on a venue storefront.
 *
 * Two things here are load-bearing and neither is obvious.
 *
 * **A sold-out unit stays on the page.** Lancaster prints "Sold out" beside
 * its VVIP duplex and leaves it on the price list, and that is not sloppiness,
 * it is the best argument for everything above it: a property where the best
 * unit has already gone is a property worth booking today. Ciao could only
 * hide it, which threw away the argument *and* the demand signal. So it is
 * shown, dimmed, unbookable, with the one useful thing a guest can do about
 * it — leave a number.
 *
 * **The rate says what it covers.** A card reading "3,600 د.ل" beside "6
 * ضيوف" when the rate covers two is not a rounding error, it is the
 * marketplace lying about a price, and it is the exact moment a first-time
 * user decides whether this is Facebook with extra steps or something better.
 * So `includedGuests` is printed next to the number, every time it is set.
 */
import { useState } from "react";
import { useRouter } from "@/lib/locale";
import { useLocale } from "@/lib/locale";
import { fmtLyd, api, ApiError } from "@/lib/api";
import { trackClient } from "@/lib/tracker";
import { BOARD, UNIT_KINDS_LABEL, term } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";
import { thumb } from "@/lib/types";

interface Unit {
  id: string;
  slug: string;
  titleAr: string;
  titleEn?: string | null;
  unitKind?: string | null;
  maxGuests?: number | null;
  includedGuests?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  boardBasis?: string | null;
  minNights?: number | null;
  media?: { url: string; thumbUrl?: string }[];
  fromNightly: number;
  soldOut: boolean;
}

const copy = {
  ar: {
    perNight: "/ الليلة",
    covers: (n: number) => `السعر يشمل ${n} ${n === 2 ? "ضيفين" : "ضيوف"}`,
    upTo: (n: number) => `تتسع لـ ${n}`,
    rooms: (n: number) => `${n} غرف`,
    baths: (n: number) => `${n} حمامات`,
    minNights: (n: number) => `أقل حجز ${n} ليالٍ`,
    soldOut: "محجوزة",
    book: "احجز",
    notify: "خبّرني لما تتفرّغ",
    notifyTitle: "خبّرني لما تتفرّغ",
    notifyBody:
      "اترك رقمك ونتصل بك أول ما تتفرّغ هذي الوحدة. ما نستعمل الرقم لأي شيء ثاني.",
    phone: "رقم الهاتف",
    phonePlaceholder: "091 2345678",
    sendCode: "أرسل رمز التأكيد",
    code: "الرمز اللي وصلك",
    confirm: "تأكيد",
    done: "تمام — نتصل بك أول ما تتفرّغ.",
    close: "إغلاق",
    demoCode: (c: string) => `رمز التجربة: ${c}`,
    failed: "ما تمّت العملية. حاول مرة أخرى.",
    offerHint: (code: string) => `لا تنسَ رمز الخصم ${code}`,
  },
  en: {
    perNight: "/ night",
    covers: (n: number) => `Rate covers ${n} guest${n === 1 ? "" : "s"}`,
    upTo: (n: number) => `Sleeps ${n}`,
    rooms: (n: number) => `${n} bedrooms`,
    baths: (n: number) => `${n} bathrooms`,
    minNights: (n: number) => `${n}-night minimum`,
    soldOut: "Booked",
    book: "Book",
    notify: "Tell me when it frees up",
    notifyTitle: "Tell me when it frees up",
    notifyBody:
      "Leave your number and we'll call you the moment this unit is free. We won't use it for anything else.",
    phone: "Phone number",
    phonePlaceholder: "091 2345678",
    sendCode: "Send confirmation code",
    code: "The code you received",
    confirm: "Confirm",
    done: "Done — we'll call you the moment it frees up.",
    close: "Close",
    demoCode: (c: string) => `Demo code: ${c}`,
    failed: "That didn't work. Try again.",
    offerHint: (code: string) => `Don't forget the code ${code}`,
  },
} satisfies Record<Locale, unknown>;

export function UnitList({
  units,
  venueId,
  src,
  offerCode,
  heading,
}: {
  units: Unit[];
  venueId: string;
  src: string;
  offerCode: string | null;
  heading: string;
}) {
  const locale = useLocale();
  const c = copy[locale];
  const router = useRouter();
  const [waitlistFor, setWaitlistFor] = useState<Unit | null>(null);

  if (units.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="font-bold text-lg text-sea mb-3">{heading}</h2>
      <ul className="space-y-3">
        {units.map((u) => {
          const title = locale === "en" ? (u.titleEn ?? u.titleAr) : u.titleAr;
          const kind = u.unitKind ? term(UNIT_KINDS_LABEL, locale, u.unitKind) : null;
          const board =
            u.boardBasis && u.boardBasis !== "room_only"
              ? term(BOARD, locale, u.boardBasis)
              : null;
          return (
            <li
              key={u.id}
              className={`card p-3 flex gap-3 ${u.soldOut ? "opacity-70" : ""}`}
            >
              {u.media?.[0]?.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={thumb(u.media[0])}
                  alt={title}
                  className="w-24 h-24 rounded-xl object-cover shrink-0"
                />
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-sea truncate">{title}</p>
                    <p className="text-xs text-faint mt-0.5">
                      {[
                        kind,
                        u.maxGuests ? c.upTo(u.maxGuests) : null,
                        u.bedrooms ? c.rooms(u.bedrooms) : null,
                        u.bathrooms ? c.baths(u.bathrooms) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  {u.soldOut ? (
                    <span className="chip bg-sand text-muted shrink-0">{c.soldOut}</span>
                  ) : null}
                </div>

                {board ? (
                  <p className="text-xs font-bold text-link mt-1">🍽 {board}</p>
                ) : null}

                <p className="mt-1">
                  <span className="font-bold text-sea">{fmtLyd(u.fromNightly, locale)}</span>
                  <span className="text-xs text-faint"> {c.perNight}</span>
                </p>
                {/*
                  The sentence that stops the price being a lie. A rate that
                  covers two on a unit that sleeps six is the normal shape of
                  Libyan resort pricing, and hiding it is how a guest arrives
                  at a total they did not expect.
                */}
                {u.includedGuests ? (
                  <p className="text-xs text-muted">{c.covers(u.includedGuests)}</p>
                ) : null}
                {u.minNights && u.minNights > 1 ? (
                  <p className="text-xs text-faint">{c.minNights(u.minNights)}</p>
                ) : null}

                <div className="mt-2">
                  {u.soldOut ? (
                    <button
                      className="btn-secondary !py-1.5 !text-sm"
                      onClick={() => {
                        trackClient("listing.sold_out_seen", { listingId: u.id, leadDays: null });
                        setWaitlistFor(u);
                      }}
                    >
                      {c.notify}
                    </button>
                  ) : (
                    <button
                      className="btn-primary !py-1.5 !text-sm"
                      onClick={() => {
                        trackClient("venue.unit_switched", {
                          venueId,
                          fromKind: null,
                          toKind: u.unitKind ?? null,
                        });
                        /*
                         * `src` travels with the tap. It is the whole reason a
                         * partner can be shown what their Facebook page earns
                         * them, and it has to survive the hop from the
                         * storefront to the unit or the chain breaks here.
                         */
                        const qs = new URLSearchParams({ src });
                        if (offerCode) qs.set("promo", offerCode);
                        router.push(`/l/${u.slug}?${qs}`);
                      }}
                    >
                      {c.book}
                    </button>
                  )}
                  {!u.soldOut && offerCode ? (
                    <span className="text-xs text-link font-bold ms-2">
                      {c.offerHint(offerCode)}
                    </span>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {waitlistFor ? (
        <WaitlistDialog unit={waitlistFor} onClose={() => setWaitlistFor(null)} />
      ) : null}
    </section>
  );
}

/**
 * The only honest thing to say to a family whose dates are gone.
 *
 * Not a shrug and six alternatives — a promise to ring them, and a number we
 * can actually ring. The code step is the same discipline as the partner-lead
 * form: an unverified list is a list nobody works, and the entire value of
 * this one is that somebody calls it.
 */
function WaitlistDialog({ unit, onClose }: { unit: Unit; onClose: () => void }) {
  const locale = useLocale();
  const c = copy[locale];
  const [stage, setStage] = useState<"phone" | "code" | "done">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function request() {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ devCode?: string }>("/v1/auth/otp/request", {
        method: "POST",
        body: JSON.stringify({ phone }),
      });
      if (r.devCode) setDevCode(r.devCode);
      setStage("code");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : c.failed);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await api("/v1/waitlist", {
        method: "POST",
        body: JSON.stringify({ listingId: unit.id, phone, code }),
      });
      setStage("done");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : c.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-sea-dark/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={c.notifyTitle}
    >
      <div
        className="bg-surface w-full sm:max-w-md rounded-t-3xl sm:rounded-bubble shadow-xl p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        {stage === "done" ? (
          <>
            <h2 className="font-bold text-xl text-sea">{c.done}</h2>
            <button className="btn-primary w-full" onClick={onClose}>
              {c.close}
            </button>
          </>
        ) : (
          <>
            <h2 className="font-bold text-xl text-sea">{c.notifyTitle}</h2>
            <p className="text-sm text-muted">{c.notifyBody}</p>
            {stage === "phone" ? (
              <>
                <label className="block text-xs font-bold text-muted">
                  {c.phone}
                  <input
                    dir="ltr"
                    inputMode="tel"
                    className="input mt-1 text-center"
                    placeholder={c.phonePlaceholder}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </label>
                <button
                  className="btn-primary w-full"
                  disabled={busy || phone.replace(/\D/g, "").length < 9}
                  onClick={request}
                >
                  {c.sendCode}
                </button>
              </>
            ) : (
              <>
                <input
                  dir="ltr"
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                  aria-label={c.code}
                  className="input text-center tracking-widest"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                />
                {devCode ? <p className="text-xs text-link">{c.demoCode(devCode)}</p> : null}
                <button
                  className="btn-primary w-full"
                  disabled={busy || code.length !== 6}
                  onClick={submit}
                >
                  {c.confirm}
                </button>
              </>
            )}
            {error ? <p className="text-danger text-sm font-bold">{error}</p> : null}
          </>
        )}
      </div>
    </div>
  );
}
