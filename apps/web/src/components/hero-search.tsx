"use client";
/**
 * Compact search — Airbnb-style pill. Collapsed: one slim bar
 * (أين | متى | من + 🔍). Tap → expands the fields. Small emoji tabs above.
 */
import { useState } from "react";
import { useRouter, useLocale } from "@/lib/locale";
import { serviceCategories } from "@/lib/services";
import { AREAS, CITIES, VERTICALS, term } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";

/**
 * Which areas belong to which city — keys only. The words come from vocab, so
 * that a place is named the same here, on the card and on the listing page.
 */
/*
 * Every city the vocabulary knows, in the order it lists them — west to east,
 * then south.
 *
 * This was a hand-written array of seven, which is why the dropdown offered
 * Tripoli, Misrata, Benghazi and four western towns and nothing else: the
 * vocabulary could grow all it liked and this list would not. Somebody in
 * Derna or Sabha opened the search and could not name where they live.
 *
 * Deriving it means the two can never disagree again. A city added to `CITIES`
 * is a city you can search, and a city with nothing listed in it answers
 * honestly — "nothing here yet" beats "that town does not exist".
 */
const CITY_KEYS = Object.keys(CITIES.en);
const AREA_KEYS: Record<string, string[]> = {
  tripoli: ["janzour", "tajoura", "ain_zara", "airport_road", "gargaresh", "regatta"],
  misrata: [],
  benghazi: [],
  sabratha: ["talil"],
  zawiya: [],
  zuwara: [],
  khoms: [],
};

const copy = {
  ar: {
    allAreas: "كل المناطق",
    anyDate: "أي تاريخ",
    guestsPlaceholder: "العدد",
    women: (n: string) => `${n} ضيفة`,
    people: (n: string) => `${n} أشخاص`,
    where: "أين؟",
    when: "متى؟",
    womenGuestsShort: "الضيفات؟",
    serviceShort: "الخدمة؟",
    who: "من؟",
    allServices: "كل الخدمات",
    search: "ابحث",
    city: "المدينة",
    allCities: "كل ليبيا",
    area: "المنطقة",
    checkIn: "الوصول",
    checkOut: "المغادرة",
    people_: "عدد الأشخاص",
    peopleEg: "مثلًا 8",
    serviceType: "نوع الخدمة",
    womenCount: "عدد الضيفات (القاعة النسائية)",
    womenEg: "مثلًا 400",
  },
  en: {
    allAreas: "All areas",
    anyDate: "Any dates",
    guestsPlaceholder: "Guests",
    women: (n: string) => `${n} women guests`,
    people: (n: string) => `${n} people`,
    where: "Where?",
    when: "When?",
    womenGuestsShort: "How many?",
    serviceShort: "Service?",
    who: "Who?",
    allServices: "All services",
    search: "Search",
    city: "City",
    allCities: "All of Libya",
    area: "Area",
    checkIn: "Check-in",
    checkOut: "Check-out",
    people_: "Number of people",
    peopleEg: "e.g. 8",
    serviceType: "Type of service",
    womenCount: "Women guests (the women's hall)",
    womenEg: "e.g. 400",
  },
} satisfies Record<Locale, unknown>;

export function HeroSearch({
  initial,
  compact = false,
}: {
  initial?: Partial<
    Record<"type" | "city" | "area" | "checkIn" | "checkOut" | "guests" | "serviceCategory", string>
  >;
  compact?: boolean;
}) {
  const router = useRouter();
  const locale = useLocale();
  const c = copy[locale];
  const [type, setType] = useState(
    initial?.type === "hall" ? "hall" : initial?.type === "service" ? "service" : "coast",
  );
  const [category, setCategory] = useState(initial?.serviceCategory ?? "");
  /*
   * Empty means everywhere, and that is the default.
   *
   * It used to open on Tripoli, which quietly made the capital the product and
   * every other town an act of correction. A guest in Derna had to notice a
   * dropdown, find their city in it, and only then see what Ciao had — and if
   * they did not notice, the answer they got was Tripoli's.
   */
  const [city, setCity] = useState(initial?.city ?? "");
  const [area, setArea] = useState(initial?.area ?? "");
  const [checkIn, setCheckIn] = useState(initial?.checkIn ?? "");
  const [checkOut, setCheckOut] = useState(initial?.checkOut ?? "");
  const [guests, setGuests] = useState(initial?.guests ?? "");
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const categories = serviceCategories(locale);

  function submit() {
    const q = new URLSearchParams({ type });
    // No city means no city filter, rather than a filter on the empty string.
    if (city) q.set("city", city);
    if (area) q.set("area", area);
    if (type === "service" && category) q.set("serviceCategory", category);
    if (type === "coast" && checkIn && checkOut && checkOut > checkIn) {
      q.set("checkIn", checkIn);
      q.set("checkOut", checkOut);
    }
    if (guests) q.set(type === "hall" ? "womensCapacity" : "maxGuests", guests);
    setOpen(false);
    router.push(`/search?${q}`);
  }

  const whereLabel = area
    ? term(AREAS, locale, area)
    : city
      ? term(CITIES, locale, city)
      : c.allCities;
  const whenLabel =
    checkIn && checkOut ? `${checkIn.slice(5)} → ${checkOut.slice(5)}` : c.anyDate;
  const whoLabel = guests
    ? type === "hall"
      ? c.women(guests)
      : c.people(guests)
    : c.guestsPlaceholder;

  return (
    <div className="w-full max-w-xl mx-auto">
      {/* Small emoji tabs (never big blocks) */}
      <div className="flex justify-center gap-2 mb-2">
        {(
          [
            ["coast", "🏖"],
            ["hall", "💍"],
            ["service", "🛎"],
          ] as const
        ).map(([t, emoji]) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold transition-colors ${
              /*
                Over the hero photo these tabs must stay legible against an
                image, not against the page ground — so the active tab keeps a
                light glass fill with dark ink in both themes. In compact mode
                there is no photo behind them and they follow the theme.
              */
              type === t
                ? compact
                  ? "bg-surface text-sea shadow"
                  : "bg-white text-[#0d1b2a] shadow"
                : compact
                  ? "bg-sand text-muted"
                  : "tab-on-photo"
            }`}
          >
            <span aria-hidden>{emoji}</span> {term(VERTICALS, locale, t)}
          </button>
        ))}
      </div>

      {/*
        The pill — one line, not two.
        Label and value sit side by side on a single row so the bar stays
        slim and the photography behind it keeps the frame. The background is
        translucent with a blur: enough of the hero shows through to feel like
        part of the picture, enough opacity behind the text to stay readable
        in Tripoli sunlight (§3.3). On the search page (compact) it goes solid,
        because there is no photo behind it to reveal.
      */}
      <div
        className={`rounded-full shadow-lg flex items-center text-sm ${
          compact ? "bg-surface" : "hero-pill backdrop-blur-md"
        }`}
      >
        <button
          className="flex-1 min-w-0 flex items-baseline gap-1.5 text-start ps-4 py-1.5 rounded-full hover:bg-sand/40"
          onClick={() => setOpen((o) => !o)}
        >
          <span className="text-[11px] font-bold text-faint shrink-0">{c.where}</span>
          <span className="font-bold text-sea truncate">{whereLabel}</span>
        </button>
        <span className="w-px h-5 bg-sea/15 shrink-0" aria-hidden />
        <button
          className="flex-1 min-w-0 flex items-baseline gap-1.5 text-start ps-3 py-1.5 hover:bg-sand/40"
          onClick={() => setOpen((o) => !o)}
        >
          <span className="text-[11px] font-bold text-faint shrink-0">
            {type === "hall" ? c.womenGuestsShort : type === "service" ? c.serviceShort : c.when}
          </span>
          <span
            className="font-bold text-sea truncate"
            dir={type === "coast" && checkIn ? "ltr" : undefined}
          >
            {type === "hall"
              ? whoLabel
              : type === "service"
                ? (categories.find(([k]) => k === category)?.[2] ?? c.allServices)
                : whenLabel}
          </span>
        </button>
        {type === "coast" ? (
          <>
            <span className="w-px h-5 bg-sea/15 shrink-0 hidden sm:block" aria-hidden />
            <button
              className="flex-1 min-w-0 items-baseline gap-1.5 text-start ps-3 py-1.5 hidden sm:flex hover:bg-sand/40"
              onClick={() => setOpen((o) => !o)}
            >
              <span className="text-[11px] font-bold text-faint shrink-0">{c.who}</span>
              <span className="font-bold text-sea truncate">{whoLabel}</span>
            </button>
          </>
        ) : null}
        <button
          className="m-1 shrink-0 w-8 h-8 rounded-full bg-amber text-sea-dark flex items-center justify-center text-sm active:bg-amber-dark"
          onClick={() => (open ? submit() : setOpen(true))}
          aria-label={c.search}
        >
          🔍
        </button>
      </div>

      {/* Expanded fields */}
      {open ? (
        <div className="card mt-2 p-3 space-y-2 shadow-lg text-sm">
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs font-bold text-muted">
              {c.city}
              <select
                className="input !py-2 mt-1"
                value={city}
                onChange={(e) => {
                  setCity(e.target.value);
                  setArea("");
                }}
              >
                <option value="">{c.allCities}</option>
                {CITY_KEYS.map((k) => (
                  <option key={k} value={k}>{term(CITIES, locale, k)}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-bold text-muted">
              {c.area}
              <select
                className="input !py-2 mt-1"
                value={area}
                onChange={(e) => setArea(e.target.value)}
              >
                <option value="">{c.allAreas}</option>
                {(AREA_KEYS[city] ?? []).map((k) => (
                  <option key={k} value={k}>{term(AREAS, locale, k)}</option>
                ))}
              </select>
            </label>
            {type === "coast" ? (
              <>
                <label className="block text-xs font-bold text-muted">
                  {c.checkIn}
                  <input
                    type="date"
                    min={today}
                    className="input !py-2 mt-1"
                    value={checkIn}
                    onChange={(e) => setCheckIn(e.target.value)}
                  />
                </label>
                <label className="block text-xs font-bold text-muted">
                  {c.checkOut}
                  <input
                    type="date"
                    min={checkIn || today}
                    className="input !py-2 mt-1"
                    value={checkOut}
                    onChange={(e) => setCheckOut(e.target.value)}
                  />
                </label>
                <label className="block text-xs font-bold text-muted col-span-2">
                  {c.people_}
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    placeholder={c.peopleEg}
                    className="input !py-2 mt-1"
                    value={guests}
                    onChange={(e) => setGuests(e.target.value)}
                  />
                </label>
              </>
            ) : type === "service" ? (
              <label className="block text-xs font-bold text-muted col-span-2">
                {c.serviceType}
                <select
                  className="input !py-2 mt-1"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="">{c.allServices}</option>
                  {categories.map(([k, e2, l]) => (
                    <option key={k} value={k}>{e2} {l}</option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="block text-xs font-bold text-muted col-span-2">
                {c.womenCount}
                <input
                  type="number"
                  inputMode="numeric"
                  min={50}
                  step={50}
                  placeholder={c.womenEg}
                  className="input !py-2 mt-1"
                  value={guests}
                  onChange={(e) => setGuests(e.target.value)}
                />
              </label>
            )}
          </div>
          <button className="btn-amber w-full !py-2 text-sm" onClick={submit}>
            🔍 {c.search}
          </button>
        </div>
      ) : null}
    </div>
  );
}
