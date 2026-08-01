"use client";
/**
 * Compact search — Airbnb-style pill. Collapsed: one slim bar
 * (أين | متى | من + 🔍). Tap → expands the fields. Small emoji tabs above.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { SERVICE_CATEGORIES } from "@/lib/services";

const CITIES: [string, string][] = [
  ["tripoli", "طرابلس"],
  ["misrata", "مصراتة"],
  ["benghazi", "بنغازي"],
];
const AREAS: Record<string, [string, string][]> = {
  tripoli: [
    ["", "كل المناطق"],
    ["janzour", "جنزور"],
    ["tajoura", "تاجوراء"],
    ["ain_zara", "عين زارة"],
    ["airport_road", "طريق المطار"],
  ],
  misrata: [["", "كل المناطق"]],
  benghazi: [["", "كل المناطق"]],
};
const CITY_AR = Object.fromEntries(CITIES);
const AREA_AR: Record<string, string> = {
  janzour: "جنزور",
  tajoura: "تاجوراء",
  ain_zara: "عين زارة",
  airport_road: "طريق المطار",
};

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
  const [type, setType] = useState(
    initial?.type === "hall" ? "hall" : initial?.type === "service" ? "service" : "coast",
  );
  const [category, setCategory] = useState(initial?.serviceCategory ?? "");
  const [city, setCity] = useState(initial?.city ?? "tripoli");
  const [area, setArea] = useState(initial?.area ?? "");
  const [checkIn, setCheckIn] = useState(initial?.checkIn ?? "");
  const [checkOut, setCheckOut] = useState(initial?.checkOut ?? "");
  const [guests, setGuests] = useState(initial?.guests ?? "");
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  function submit() {
    const q = new URLSearchParams({ type, city });
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

  const whereLabel = area ? AREA_AR[area] ?? area : CITY_AR[city] ?? city;
  const whenLabel =
    checkIn && checkOut ? `${checkIn.slice(5)} → ${checkOut.slice(5)}` : "أي تاريخ";
  const whoLabel = guests ? `${guests} ${type === "hall" ? "ضيفة" : "أشخاص"}` : "العدد";

  return (
    <div className="w-full max-w-xl mx-auto">
      {/* Small emoji tabs (never big blocks) */}
      <div className="flex justify-center gap-2 mb-2">
        {(
          [
            ["coast", "🏖", "شاليهات واستراحات"],
            ["hall", "💍", "قاعات أفراح"],
            ["service", "🛎", "خدمات"],
          ] as const
        ).map(([t, emoji, label]) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold transition-colors ${
              type === t
                ? "bg-white text-sea shadow"
                : compact
                  ? "bg-sand text-sea/70"
                  : "bg-white/25 text-white"
            }`}
          >
            <span aria-hidden>{emoji}</span> {label}
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
          compact ? "bg-white dark:bg-[color:var(--surface)]" : "hero-pill backdrop-blur-md"
        }`}
      >
        <button
          className="flex-1 min-w-0 flex items-baseline gap-1.5 text-start ps-4 py-1.5 rounded-full hover:bg-sand/40"
          onClick={() => setOpen((o) => !o)}
        >
          <span className="text-[11px] font-bold text-sea/55 shrink-0">أين؟</span>
          <span className="font-bold text-sea truncate">{whereLabel}</span>
        </button>
        <span className="w-px h-5 bg-sea/15 shrink-0" aria-hidden />
        <button
          className="flex-1 min-w-0 flex items-baseline gap-1.5 text-start ps-3 py-1.5 hover:bg-sand/40"
          onClick={() => setOpen((o) => !o)}
        >
          <span className="text-[11px] font-bold text-sea/55 shrink-0">
            {type === "hall" ? "الضيفات؟" : type === "service" ? "الخدمة؟" : "متى؟"}
          </span>
          <span
            className="font-bold text-sea truncate"
            dir={type === "coast" && checkIn ? "ltr" : undefined}
          >
            {type === "hall"
              ? whoLabel
              : type === "service"
                ? (SERVICE_CATEGORIES.find(([k]) => k === category)?.[2] ?? "كل الخدمات")
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
              <span className="text-[11px] font-bold text-sea/55 shrink-0">من؟</span>
              <span className="font-bold text-sea truncate">{whoLabel}</span>
            </button>
          </>
        ) : null}
        <button
          className="m-1 shrink-0 w-8 h-8 rounded-full bg-amber text-sea-dark flex items-center justify-center text-sm active:bg-amber-dark"
          onClick={() => (open ? submit() : setOpen(true))}
          aria-label="ابحث"
        >
          🔍
        </button>
      </div>

      {/* Expanded fields */}
      {open ? (
        <div className="card mt-2 p-3 space-y-2 shadow-lg text-sm">
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs font-bold text-sea/70">
              المدينة
              <select
                className="input !py-2 mt-1"
                value={city}
                onChange={(e) => {
                  setCity(e.target.value);
                  setArea("");
                }}
              >
                {CITIES.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-bold text-sea/70">
              المنطقة
              <select
                className="input !py-2 mt-1"
                value={area}
                onChange={(e) => setArea(e.target.value)}
              >
                {(AREAS[city] ?? [["", "كل المناطق"]]).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
            {type === "coast" ? (
              <>
                <label className="block text-xs font-bold text-sea/70">
                  الوصول
                  <input
                    type="date"
                    min={today}
                    className="input !py-2 mt-1"
                    value={checkIn}
                    onChange={(e) => setCheckIn(e.target.value)}
                  />
                </label>
                <label className="block text-xs font-bold text-sea/70">
                  المغادرة
                  <input
                    type="date"
                    min={checkIn || today}
                    className="input !py-2 mt-1"
                    value={checkOut}
                    onChange={(e) => setCheckOut(e.target.value)}
                  />
                </label>
                <label className="block text-xs font-bold text-sea/70 col-span-2">
                  عدد الأشخاص
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    placeholder="مثلًا 8"
                    className="input !py-2 mt-1"
                    value={guests}
                    onChange={(e) => setGuests(e.target.value)}
                  />
                </label>
              </>
            ) : type === "service" ? (
              <label className="block text-xs font-bold text-sea/70 col-span-2">
                نوع الخدمة
                <select
                  className="input !py-2 mt-1"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="">كل الخدمات</option>
                  {SERVICE_CATEGORIES.map(([k, e2, l]) => (
                    <option key={k} value={k}>{e2} {l}</option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="block text-xs font-bold text-sea/70 col-span-2">
                عدد الضيفات (القاعة النسائية)
                <input
                  type="number"
                  inputMode="numeric"
                  min={50}
                  step={50}
                  placeholder="مثلًا 400"
                  className="input !py-2 mt-1"
                  value={guests}
                  onChange={(e) => setGuests(e.target.value)}
                />
              </label>
            )}
          </div>
          <button className="btn-amber w-full !py-2 text-sm" onClick={submit}>
            🔍 ابحث
          </button>
        </div>
      ) : null}
    </div>
  );
}
