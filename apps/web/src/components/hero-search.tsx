"use client";
/** Front-page search — vertical, place, dates, guests → /search. */
import { useState } from "react";
import { useRouter } from "next/navigation";

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

export function HeroSearch({
  initial,
  compact = false,
}: {
  initial?: Partial<Record<"type" | "city" | "area" | "checkIn" | "checkOut" | "guests", string>>;
  compact?: boolean;
}) {
  const router = useRouter();
  const [type, setType] = useState(initial?.type === "hall" ? "hall" : "coast");
  const [city, setCity] = useState(initial?.city ?? "tripoli");
  const [area, setArea] = useState(initial?.area ?? "");
  const [checkIn, setCheckIn] = useState(initial?.checkIn ?? "");
  const [checkOut, setCheckOut] = useState(initial?.checkOut ?? "");
  const [guests, setGuests] = useState(initial?.guests ?? "");
  const today = new Date().toISOString().slice(0, 10);

  function submit() {
    const q = new URLSearchParams({ type, city });
    if (area) q.set("area", area);
    if (type === "coast" && checkIn && checkOut && checkOut > checkIn) {
      q.set("checkIn", checkIn);
      q.set("checkOut", checkOut);
    }
    if (guests) q.set(type === "hall" ? "womensCapacity" : "maxGuests", guests);
    router.push(`/search?${q}`);
  }

  return (
    <div
      className={`card p-3 sm:p-4 ${compact ? "" : "shadow-lg"} space-y-3`}
      role="search"
    >
      {/* Vertical tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setType("coast")}
          className={`flex-1 rounded-xl py-2 font-bold text-sm transition-colors ${
            type === "coast" ? "bg-sea text-white" : "bg-sand text-sea"
          }`}
        >
          🏖 شاليهات واستراحات
        </button>
        <button
          onClick={() => setType("hall")}
          className={`flex-1 rounded-xl py-2 font-bold text-sm transition-colors ${
            type === "hall" ? "bg-sea text-white" : "bg-sand text-sea"
          }`}
        >
          💍 قاعات أفراح
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <label className="block text-xs font-bold text-sea/70">
          المدينة
          <select
            className="input !py-2.5 mt-1 text-base"
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
            className="input !py-2.5 mt-1 text-base"
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
                className="input !py-2.5 mt-1 text-base"
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
              />
            </label>
            <label className="block text-xs font-bold text-sea/70">
              المغادرة
              <input
                type="date"
                min={checkIn || today}
                className="input !py-2.5 mt-1 text-base"
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
              />
            </label>
          </>
        ) : (
          <label className="block text-xs font-bold text-sea/70 col-span-2">
            عدد الضيفات (القاعة النسائية)
            <input
              type="number"
              inputMode="numeric"
              min={50}
              step={50}
              placeholder="مثلًا 400"
              className="input !py-2.5 mt-1 text-base"
              value={guests}
              onChange={(e) => setGuests(e.target.value)}
            />
          </label>
        )}
      </div>

      {type === "coast" ? (
        <div className="flex items-end gap-2">
          <label className="block text-xs font-bold text-sea/70 flex-1">
            عدد الأشخاص
            <input
              type="number"
              inputMode="numeric"
              min={1}
              placeholder="مثلًا 8"
              className="input !py-2.5 mt-1 text-base"
              value={guests}
              onChange={(e) => setGuests(e.target.value)}
            />
          </label>
          <button className="btn-amber flex-[2] !py-2.5" onClick={submit}>
            🔍 ابحث
          </button>
        </div>
      ) : (
        <button className="btn-amber w-full !py-2.5" onClick={submit}>
          🔍 ابحث عن قاعة
        </button>
      )}
    </div>
  );
}
