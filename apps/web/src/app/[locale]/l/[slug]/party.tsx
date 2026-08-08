"use client";
/**
 * Who is coming, and what they must bring.
 *
 * Two blocks that live together because they answer the same question — will
 * this booking survive contact with the gate — and because they are the two
 * things the checkout used to skip entirely.
 *
 * **The party.** The old checkout posted dates and a payment rail. Nothing
 * else. `guestCount` was a nullable integer on the booking that the public
 * flow never sent, and the price was the room price whoever turned up. That is
 * survivable for a 600 د.ل chalet with one price; it is not survivable for the
 * supply this market actually has, where a resort's rate covers two guests of
 * six and children under five are free while six-to-tens are half. A family of
 * two adults and three young children quoted as five adults is a quote wrong
 * in the direction that loses the booking, to precisely the demographic the
 * marketplace exists for.
 *
 * Ages rather than a child count, because the ages *are* the price. Asking for
 * three numbers instead of one is real friction, and it is paid for by the
 * quote underneath updating as they are entered — the family watches the total
 * come down as they tell us about their children, which is the opposite of how
 * every form they have ever filled in behaves.
 *
 * **The requirements.** «يشترط إحضار إثبات الوضع العائلي» — proof of family
 * status required — is the last line of a real Libyan resort's price list. It
 * is not a preference and not a filter: it is a condition of entry, and a
 * family that pays a deposit, drives seventy kilometres to Sabratha and is
 * turned away at the barrier is the worst outcome this product can produce.
 * Worse than a double-booking, because we took the money for it.
 *
 * So they are ticked, not read. The tick is what puts the requirement on the
 * voucher the guest opens at the gate with one bar of signal, and the server
 * refuses the booking without it — because the form is the thing an
 * integration will one day skip.
 */
import { useEffect, useState } from "react";
import { useLocale } from "@/lib/locale";
import { trackClient } from "@/lib/tracker";
import { REQUIREMENTS, term } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";
import type { PublicListing } from "@/lib/types";

export interface PartyValue {
  adults: number;
  childAges: number[];
  extraBeds: number;
}

export const DEFAULT_PARTY: PartyValue = { adults: 2, childAges: [], extraBeds: 0 };

const copy = {
  ar: {
    who: "مين جاي؟",
    adults: "كبار",
    children: "أطفال",
    childAge: (i: number) => `عمر الطفل ${i}`,
    years: "سنة",
    extraBeds: "أسرّة إضافية",
    covers: (n: number, fee: string) =>
      `السعر يشمل ${n === 2 ? "ضيفين" : `${n} ضيوف`} — وكل ضيف زيادة ${fee} د.ل لليلة.`,
    childFree: (n: number) => `أقل من ${n} سنوات مجانًا`,
    childHalf: (n: number, pct: number) => `من ${n} سنوات: خصم ${pct}٪`,
    overCapacity: (n: number) => `هذا المكان يتسع لـ ${n} فقط — قلّل العدد أو اختر وحدة أكبر.`,
    bedPrice: (p: string) => `${p} د.ل للسرير في الليلة`,
    rules: "شروط الدخول",
    rulesBody: "لازم توافق على هذي الشروط قبل الحجز — تنطبق عند الوصول.",
    mustBring: "لازم تجيب معاك",
  },
  en: {
    who: "Who's coming?",
    adults: "Adults",
    children: "Children",
    childAge: (i: number) => `Child ${i}'s age`,
    years: "yrs",
    extraBeds: "Extra beds",
    covers: (n: number, fee: string) =>
      `The rate covers ${n} guest${n === 1 ? "" : "s"} — each further guest is ${fee} د.ل a night.`,
    childFree: (n: number) => `Under ${n} free`,
    childHalf: (n: number, pct: number) => `From ${n}: ${pct}% off`,
    overCapacity: (n: number) =>
      `This unit sleeps ${n} — reduce the party or pick a larger one.`,
    bedPrice: (p: string) => `${p} د.ل per bed per night`,
    rules: "Conditions of entry",
    rulesBody: "You'll need to agree to these before booking — they apply on arrival.",
    mustBring: "Bring with you",
  },
} satisfies Record<Locale, unknown>;

export function PartyPicker({
  listing,
  value,
  onChange,
}: {
  listing: PublicListing;
  value: PartyValue;
  onChange: (v: PartyValue) => void;
}) {
  const locale = useLocale();
  const c = copy[locale];
  const heads = value.adults + value.childAges.length;
  const over = Boolean(listing.maxGuests && heads > listing.maxGuests);
  const policy = listing.childPolicy;

  useEffect(() => {
    trackClient("quote.party_set", {
      listingId: listing.id,
      adults: value.adults,
      children: value.childAges.length,
      childrenFree: policy
        ? value.childAges.filter((a) => a < policy.freeUnder).length
        : 0,
      childrenReduced: policy
        ? value.childAges.filter((a) => a >= policy.freeUnder && a < policy.reducedUnder).length
        : 0,
      overCapacity: over,
    });
    // Only when the shape of the party changes, not on every keystroke.
  }, [listing.id, value.adults, value.childAges.length, over, policy]);

  function setChildren(n: number) {
    const next = [...value.childAges];
    while (next.length < n) next.push(policy ? policy.freeUnder : 5);
    next.length = n;
    onChange({ ...value, childAges: next });
  }

  return (
    <div className="rounded-xl bg-sand p-3 space-y-2">
      <p className="text-sm font-bold text-sea">{c.who}</p>

      <div className="grid grid-cols-2 gap-2">
        <Stepper
          label={c.adults}
          value={value.adults}
          min={1}
          max={40}
          onChange={(n) => onChange({ ...value, adults: n })}
        />
        <Stepper
          label={c.children}
          value={value.childAges.length}
          min={0}
          max={12}
          onChange={setChildren}
        />
      </div>

      {/*
        One age field per child. Fiddlier than a single number and worth it:
        the ages are the price, and the total below updates as they are set,
        so the family sees the discount arrive rather than being told about it.
      */}
      {value.childAges.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {value.childAges.map((age, i) => (
            <label key={i} className="text-xs font-bold text-muted">
              <span className="sr-only">{c.childAge(i + 1)}</span>
              <span className="flex items-center gap-1">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={24}
                  aria-label={c.childAge(i + 1)}
                  className="input !py-1 !px-2 !text-sm w-16 text-center"
                  value={age}
                  onChange={(e) => {
                    const next = [...value.childAges];
                    next[i] = Math.max(0, Math.min(24, Number(e.target.value) || 0));
                    onChange({ ...value, childAges: next });
                  }}
                />
                {c.years}
              </span>
            </label>
          ))}
        </div>
      ) : null}

      {listing.extraBedPrice ? (
        <Stepper
          label={`${c.extraBeds} · ${c.bedPrice(String(listing.extraBedPrice / 1000))}`}
          value={value.extraBeds}
          min={0}
          max={10}
          onChange={(n) => onChange({ ...value, extraBeds: n })}
        />
      ) : null}

      {listing.includedGuests && listing.extraGuestFee ? (
        <p className="text-xs text-muted">
          {c.covers(listing.includedGuests, String(listing.extraGuestFee / 1000))}
        </p>
      ) : null}
      {policy ? (
        <p className="text-xs text-faint">
          {c.childFree(policy.freeUnder)} · {c.childHalf(policy.freeUnder, policy.reducedBps / 100)}
        </p>
      ) : null}
      {over ? (
        <p className="text-xs font-bold text-danger">{c.overCapacity(listing.maxGuests!)}</p>
      ) : null}
    </div>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div>
      <p className="text-xs font-bold text-muted">{label}</p>
      {/*
        Buttons rather than a number input. This is filled in on a phone, one
        thumb, often while walking; a spinner control that demands a keyboard
        for "how many adults" is friction with nothing behind it.
      */}
      <div className="flex items-center gap-2 mt-1">
        <button
          type="button"
          aria-label="−"
          className="w-8 h-8 rounded-full bg-surface text-sea font-bold shrink-0 disabled:opacity-40"
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
        >
          −
        </button>
        <span className="font-bold text-sea w-6 text-center">{value}</span>
        <button
          type="button"
          aria-label="+"
          className="w-8 h-8 rounded-full bg-surface text-sea font-bold shrink-0 disabled:opacity-40"
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
        >
          +
        </button>
      </div>
    </div>
  );
}

export function RequirementsGate({
  listing,
  accepted,
  onChange,
}: {
  listing: PublicListing;
  accepted: string[];
  onChange: (keys: string[]) => void;
}) {
  const locale = useLocale();
  const c = copy[locale];
  const reqs = listing.requirements ?? [];
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    if (reqs.length > 0 && !seen) {
      setSeen(true);
      trackClient("requirements.acknowledged", {
        listingId: listing.id,
        keys: reqs.map((r) => r.key).join("|"),
      });
    }
  }, [reqs, seen, listing.id]);

  if (reqs.length === 0) return null;

  const mustTick = reqs.filter((r) => r.mustAcknowledge);
  const informational = reqs.filter((r) => !r.mustAcknowledge);

  return (
    <div className="rounded-xl bg-sand p-3 space-y-2">
      <p className="text-sm font-bold text-sea">{c.rules}</p>
      {mustTick.length > 0 ? <p className="text-xs text-muted">{c.rulesBody}</p> : null}

      {mustTick.map((r) => {
        const on = accepted.includes(r.key);
        const detail = locale === "en" ? (r.detailEn ?? r.detailAr) : r.detailAr;
        return (
          <label key={r.key} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1 shrink-0"
              checked={on}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...accepted, r.key]
                    : accepted.filter((k) => k !== r.key),
                )
              }
            />
            <span>
              <span className="font-bold text-sea">{term(REQUIREMENTS, locale, r.key)}</span>
              {detail ? <span className="text-muted"> — {detail}</span> : null}
            </span>
          </label>
        );
      })}

      {informational.length > 0 ? (
        <ul className="text-xs text-muted space-y-0.5 pt-1">
          {informational.map((r) => (
            <li key={r.key}>· {term(REQUIREMENTS, locale, r.key)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The keys a booking cannot proceed without. */
export function unmetRequirements(listing: PublicListing, accepted: string[]): string[] {
  return (listing.requirements ?? [])
    .filter((r) => r.mustAcknowledge)
    .map((r) => r.key)
    .filter((k) => !accepted.includes(k));
}
