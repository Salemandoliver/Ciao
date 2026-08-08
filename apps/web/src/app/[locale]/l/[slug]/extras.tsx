"use client";
/**
 * The host's extras, offers and questions, on the listing page.
 *
 * This is the half of a Libyan booking that currently happens on WhatsApp: is
 * the barbecue included, can we get in early, how many children are coming.
 * Doing it here rather than in a thread has two effects that matter more than
 * convenience. The guest sees the true total before they pay a deposit rather
 * than after, and the host gets the answers they need attached to the booking
 * instead of chasing them across three days.
 *
 * Deliberate restraint: this is a compact section, not a configurator. The
 * things on offer are a handful of extras and a few questions, and a guest on
 * a phone at 11pm deciding between two chalets will not work through a wizard.
 * Everything is visible at once, quantities are steppers rather than dropdowns,
 * and nothing here blocks the booking button unless the host said it must.
 */
import { useEffect, useMemo } from "react";
import { fmtLyd } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { hostText, textProps } from "@/lib/content";
import type { Locale } from "@/lib/i18n";

export interface CatalogueAddon {
  id: string;
  serviceId: string | null;
  nameAr: string;
  nameEn: string | null;
  descriptionAr: string | null;
  price: number;
  priceModel: string;
  maxQty: number;
  required: boolean;
}

export interface CatalogueOffer {
  id: string;
  labelAr: string;
  labelEn: string | null;
  kind: string;
  valueBps: number;
  valueFlat: number;
  code: string | null;
  minSpend: number;
  travelFromDay: string | null;
  travelToDay: string | null;
}

export interface CatalogueQuestion {
  id: string;
  promptAr: string;
  promptEn: string | null;
  helpAr: string | null;
  fieldType: string;
  options: { valueAr: string }[];
  required: boolean;
}

export interface ListingCatalogue {
  addons: CatalogueAddon[];
  offers: CatalogueOffer[];
  questions?: CatalogueQuestion[];
}

const copy = {
  ar: {
    extras: "إضافات من المضيف",
    extrasHint: "اختر اللي تحتاجه — يتحسب على الباقي عند الوصول، مش على العربون.",
    required: "إجباري",
    perNight: "لكل ليلة",
    perPerson: "لكل شخص",
    once: "مرة وحدة",
    offers: "عروض المضيف",
    offerAuto: "يتطبّق تلقائيًا",
    offerCode: "بالكود",
    minSpend: (v: string) => `لحجوزات ${v} فما فوق`,
    questions: "أسئلة المضيف",
    questionsHint: "إجاباتك توصل المضيف مع الحجز — يوفّر عليك مكالمات.",
    yes: "نعم",
    no: "لا",
    choose: "اختر",
  },
  en: {
    extras: "Extras from the host",
    extrasHint: "Pick what you need — it's added to the balance on arrival, not to the deposit.",
    required: "Required",
    perNight: "per night",
    perPerson: "per person",
    once: "once",
    offers: "Host offers",
    offerAuto: "Applied automatically",
    offerCode: "With a code",
    minSpend: (v: string) => `on bookings of ${v} or more`,
    questions: "The host's questions",
    questionsHint: "Your answers reach the host with the booking — it saves you the phone calls.",
    yes: "Yes",
    no: "No",
    choose: "Choose",
  },
} satisfies Record<Locale, unknown>;

export function Extras({
  catalogue,
  qty,
  onQty,
  answers,
  onAnswer,
  nights,
  guests,
}: {
  catalogue: ListingCatalogue;
  qty: Record<string, number>;
  onQty: (id: string, next: number) => void;
  answers: Record<string, string>;
  onAnswer: (id: string, value: string) => void;
  nights: number;
  guests: number;
}) {
  const locale = useLocale();
  const c = copy[locale];

  const addons = catalogue.addons ?? [];
  const offers = catalogue.offers ?? [];
  const questions = catalogue.questions ?? [];

  /*
   * Required extras are pre-selected rather than merely labelled.
   *
   * The server adds them regardless — it has to, or omitting one from the
   * request would shave a mandatory fee off the total. Showing them unticked
   * would mean the number on this page disagrees with the number on the
   * confirmation, which is precisely the surprise this section exists to
   * remove.
   */
  useEffect(() => {
    for (const a of addons) {
      if (a.required && !qty[a.id]) onQty(a.id, 1);
    }
    // Only when the catalogue itself changes; `qty` is deliberately not a
    // dependency or clearing a quantity would immediately re-add it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addons]);

  const modelLabel = (m: string) =>
    m === "per_unit" ? c.perNight : m === "per_person" ? c.perPerson : c.once;

  const extrasTotal = useMemo(
    () =>
      addons.reduce((sum, a) => {
        const n = qty[a.id] ?? 0;
        if (!n) return sum;
        const multiplier =
          a.priceModel === "per_unit"
            ? Math.max(1, nights)
            : a.priceModel === "per_person"
              ? Math.max(1, guests)
              : 1;
        return sum + a.price * n * multiplier;
      }, 0),
    [addons, qty, nights, guests],
  );

  if (addons.length === 0 && offers.length === 0 && questions.length === 0) return null;

  return (
    <div className="space-y-4">
      {offers.length > 0 ? (
        <section>
          <h3 className="font-bold text-sea text-sm">{c.offers}</h3>
          <ul className="mt-2 space-y-1.5">
            {offers.map((o) => {
              const label = hostText(locale, o.labelAr, o.labelEn);
              return (
                <li
                  key={o.id}
                  className="rounded-2xl bg-amber/15 px-3 py-2 text-sm flex items-center justify-between gap-2"
                >
                  <span className="min-w-0">
                    <span className="font-bold text-sea" {...(label ? textProps(label) : {})}>
                      {label?.text}
                    </span>
                    <span className="block text-[11px] text-muted">
                      {o.code ? `${c.offerCode} · ${o.code}` : c.offerAuto}
                      {o.minSpend > 0 ? ` · ${c.minSpend(fmtLyd(o.minSpend, locale))}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 font-extrabold text-sea tabular-nums" dir="ltr">
                    {o.kind === "percent"
                      ? `−${(o.valueBps / 100).toFixed(0)}%`
                      : `−${fmtLyd(o.valueFlat, locale)}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {addons.length > 0 ? (
        <section>
          <h3 className="font-bold text-sea text-sm">{c.extras}</h3>
          <p className="text-[11px] text-faint">{c.extrasHint}</p>
          <ul className="mt-2 space-y-2">
            {addons.map((a) => {
              const name = hostText(locale, a.nameAr, a.nameEn);
              const n = qty[a.id] ?? 0;
              return (
                <li key={a.id} className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="text-sm font-bold text-sea" {...(name ? textProps(name) : {})}>
                      {name?.text}
                    </span>
                    <span className="block text-[11px] text-muted tabular-nums" dir="ltr">
                      {fmtLyd(a.price, locale)} · {modelLabel(a.priceModel)}
                      {a.required ? ` · ${c.required}` : ""}
                    </span>
                  </span>
                  {a.required ? (
                    <span className="text-xs font-bold text-muted shrink-0">✓</span>
                  ) : (
                    <span className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        aria-label="−"
                        className="chip !px-3 !text-sm"
                        disabled={n === 0}
                        onClick={() => onQty(a.id, Math.max(0, n - 1))}
                      >
                        −
                      </button>
                      <span className="w-5 text-center tabular-nums text-sm font-bold text-sea">
                        {n}
                      </span>
                      <button
                        type="button"
                        aria-label="+"
                        className="chip !px-3 !text-sm"
                        disabled={n >= a.maxQty}
                        onClick={() => onQty(a.id, Math.min(a.maxQty, n + 1))}
                      >
                        +
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {extrasTotal > 0 ? (
            <p className="text-xs text-muted mt-2 tabular-nums" dir="ltr">
              + {fmtLyd(extrasTotal, locale)}
            </p>
          ) : null}
        </section>
      ) : null}

      {questions.length > 0 ? (
        <section>
          <h3 className="font-bold text-sea text-sm">{c.questions}</h3>
          <p className="text-[11px] text-faint">{c.questionsHint}</p>
          <div className="mt-2 space-y-2">
            {questions.map((q) => {
              const prompt = hostText(locale, q.promptAr, q.promptEn);
              return (
                <label key={q.id} className="block text-sm">
                  <span
                    className="text-xs font-bold text-muted"
                    {...(prompt ? textProps(prompt) : {})}
                  >
                    {prompt?.text}
                    {q.required ? " *" : ""}
                  </span>
                  {q.fieldType === "choice" ? (
                    <select
                      className="input !py-2 !text-sm mt-1"
                      value={answers[q.id] ?? ""}
                      onChange={(e) => onAnswer(q.id, e.target.value)}
                    >
                      <option value="">{c.choose}</option>
                      {q.options.map((o) => (
                        <option key={o.valueAr} value={o.valueAr}>
                          {o.valueAr}
                        </option>
                      ))}
                    </select>
                  ) : q.fieldType === "boolean" ? (
                    <select
                      className="input !py-2 !text-sm mt-1"
                      value={answers[q.id] ?? ""}
                      onChange={(e) => onAnswer(q.id, e.target.value)}
                    >
                      <option value="">{c.choose}</option>
                      <option value={c.yes}>{c.yes}</option>
                      <option value={c.no}>{c.no}</option>
                    </select>
                  ) : (
                    <input
                      className="input !py-2 !text-sm mt-1"
                      type={q.fieldType === "date" ? "date" : "text"}
                      inputMode={
                        q.fieldType === "number" || q.fieldType === "phone" ? "numeric" : "text"
                      }
                      value={answers[q.id] ?? ""}
                      onChange={(e) => onAnswer(q.id, e.target.value)}
                    />
                  )}
                  {q.helpAr ? (
                    <span className="block text-[11px] text-faint mt-1" lang="ar" dir="rtl">
                      {q.helpAr}
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
