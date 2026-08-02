"use client";
/**
 * The calendar.
 *
 * What this replaces is worth remembering: the previous host screen asked
 * people to type "2026-08-15, 2026-08-16" into a text box. That is a data-entry
 * task wearing a calendar's name, and it goes a long way towards explaining why
 * host calendars in this market go stale — which is pitfall #2, the single
 * largest cause of double-booking.
 *
 * So: tap a day to select it, tap again to deselect, then close or open the
 * selection in one action. Drag-select was considered and rejected — it is
 * unreliable on a cheap Android touchscreen, and a mis-drag that closes a week
 * costs the partner real money.
 *
 * The grid starts on Saturday because the Libyan week does. A calendar whose
 * weekend sits in the middle is one people misread, and the weekend is
 * precisely the column they are looking for.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { fmtDate } from "@/lib/vocab";
import { listingTitle, textProps } from "@/lib/content";
import type { Locale } from "@/lib/i18n";
import { Section } from "@/components/panel";
import type { CalendarDay, PartnerMe } from "./types";

const copy = {
  ar: {
    title: "تقويمك",
    hint: "اضغط على الأيام لاختيارها، ثم اقفلها أو افتحها. الأيام المحجوزة عن طريق تشاو ما تنقفل من هنا.",
    close: "اقفل المحدد",
    open: "افتح المحدد",
    clear: "ألغِ التحديد",
    selected: (n: number) => `${n} يوم محدد`,
    prev: "السابق",
    next: "التالي",
    legendOpen: "متاح",
    legendBlocked: "مقفول",
    legendBooked: "محجوز عبر تشاو",
    legendJob: "عندك شغل",
    allListings: "كل الأنشطة",
    refusedBooked: (days: string[]) =>
      `ما قدرنا نغيّر ${days.join("، ")} — فيها حجوزات مدفوعة عبر تشاو.`,
    done: (n: number) => `تم تحديث ${n} يوم`,
    failed: "تعذر التحديث",
    full: "اليوم ممتلئ",
  },
  en: {
    title: "Your calendar",
    hint: "Tap days to select them, then close or open them. Days sold through Ciao can't be closed from here.",
    close: "Close selected",
    open: "Open selected",
    clear: "Clear selection",
    selected: (n: number) => (n === 1 ? "1 day selected" : `${n} days selected`),
    prev: "Previous",
    next: "Next",
    legendOpen: "Available",
    legendBlocked: "Closed",
    legendBooked: "Booked via Ciao",
    legendJob: "You have work",
    allListings: "All listings",
    refusedBooked: (days: string[]) =>
      `We couldn't change ${days.join(", ")} — those have paid Ciao bookings.`,
    done: (n: number) => (n === 1 ? "1 day updated" : `${n} days updated`),
    failed: "Could not update",
    full: "Day is full",
  },
} satisfies Record<Locale, unknown>;

/** Saturday-first, matching the Libyan week. ISO day numbers: Sat=6 … Fri=5. */
const WEEK_START_ISO = 6;
const WEEKDAY_KEYS = [6, 7, 1, 2, 3, 4, 5];

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function CalendarTab({ me }: { me: PartnerMe }) {
  const locale = useLocale();
  const c = copy[locale];
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [listingId, setListingId] = useState<string>("");
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const scope = `partnerId=${me.partnerId}`;

  const load = useCallback(async () => {
    try {
      const res = await api<{ days: CalendarDay[] }>(
        `/v1/partner/calendar?${scope}&month=${month}${listingId ? `&listingId=${listingId}` : ""}`,
      );
      setDays(res.days);
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : c.failed);
    }
  }, [scope, month, listingId, c.failed]);

  useEffect(() => {
    setSelected(new Set());
    void load();
  }, [load]);

  const byDay = useMemo(() => new Map(days.map((d) => [d.day, d])), [days]);

  /** Leading blanks so the 1st lands under the right weekday column. */
  const leading = useMemo(() => {
    const first = new Date(`${month}-01T00:00:00Z`);
    const iso = first.getUTCDay() === 0 ? 7 : first.getUTCDay();
    return (iso - WEEK_START_ISO + 7) % 7;
  }, [month]);

  function toggle(day: string) {
    const entry = byDay.get(day);
    // A sold day is not the partner's to close, so it is not selectable — and
    // it says why in its own tooltip rather than failing after the fact.
    if (entry?.state === "booked") return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  async function apply(action: "block" | "open") {
    if (selected.size === 0) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await api<{ changed: string[]; refused: string[] }>(
        `/v1/partner/calendar?${scope}`,
        {
          method: "POST",
          body: JSON.stringify({
            days: [...selected],
            action,
            ...(listingId ? { listingId } : {}),
          }),
        },
      );
      setMessage(
        res.refused.length > 0
          ? `${c.done(res.changed.length)} — ${c.refusedBooked(res.refused)}`
          : c.done(res.changed.length),
      );
      setSelected(new Set());
      await load();
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : c.failed);
    } finally {
      setBusy(false);
    }
  }

  function shiftMonth(delta: number) {
    const d = new Date(`${month}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + delta);
    setMonth(monthKey(d));
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <Section
        title={c.title}
        hint={c.hint}
        action={
          me.listings.length > 1 ? (
            <select
              className="input !py-1 !text-xs !w-auto"
              value={listingId}
              onChange={(e) => setListingId(e.target.value)}
            >
              <option value="">{c.allListings}</option>
              {/* A listing's title is Arabic-first; declared as such even
                  inside a select, so an English-reading manager's browser
                  orders it correctly. */}
              {me.listings.map((l) => {
                const title = listingTitle(locale, l);
                return (
                  <option key={l.id} value={l.id} {...textProps(title)}>
                    {title.text}
                  </option>
                );
              })}
            </select>
          ) : null
        }
      >
        <div className="flex items-center justify-between mb-3">
          <button className="chip !text-xs font-bold" onClick={() => shiftMonth(-1)}>
            {/* Arrows are written as words rather than glyphs: a ← in an RTL
                column points at the next month for half the readers. */}
            {c.prev}
          </button>
          <span className="font-bold text-sea">
            {fmtDate(locale, `${month}-01`, { month: "long", year: "numeric" })}
          </span>
          <button className="chip !text-xs font-bold" onClick={() => shiftMonth(1)}>
            {c.next}
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center">
          {WEEKDAY_KEYS.map((iso) => (
            <div key={iso} className="text-[10px] font-bold text-faint pb-1">
              {/* 2026-08-01 was a Saturday, so this walks the week from there. */}
              {fmtDate(locale, `2026-08-0${iso === 6 ? 1 : iso === 7 ? 2 : iso + 2}`, {
                weekday: "short",
              })}
            </div>
          ))}
          {Array.from({ length: leading }).map((_, i) => (
            <div key={`pad-${i}`} />
          ))}
          {days.map((d) => {
            const isSelected = selected.has(d.day);
            const dayNum = Number(d.day.slice(-2));
            const jobs = d.jobs.filter((j) => j.status === "confirmed" || j.status === "done");
            /*
             * State is carried by the swatch AND by a word in the label, never
             * by colour alone — the app is read in bright sun on cheap screens
             * where a pale tint is simply not there.
             */
            const base =
              d.state === "booked"
                ? "bg-sea text-white"
                : d.state === "blocked"
                  ? "bg-sea/15 text-muted line-through"
                  : d.state === "held"
                    ? "bg-amber/30 text-sea-dark"
                    : "bg-sand text-sea";
            return (
              <button
                key={d.day}
                onClick={() => toggle(d.day)}
                disabled={d.state === "booked"}
                aria-pressed={isSelected}
                title={
                  d.state === "booked"
                    ? c.legendBooked
                    : d.full
                      ? c.full
                      : jobs.length > 0
                        ? jobs.map((j) => j.titleAr).join(" · ")
                        : undefined
                }
                className={`relative aspect-square rounded-xl text-sm font-bold transition-colors ${base} ${
                  isSelected ? "ring-2 ring-[color:rgb(var(--amber))] ring-offset-1" : ""
                } ${d.day === today ? "outline outline-1 outline-sea/40" : ""} ${
                  d.state === "booked" ? "cursor-not-allowed" : ""
                }`}
              >
                <span className="tabular-nums">{dayNum}</span>
                {jobs.length > 0 ? (
                  <span
                    className="absolute inset-x-0 bottom-1 flex justify-center gap-0.5"
                    aria-hidden
                  >
                    {jobs.slice(0, 3).map((j, i) => (
                      <span
                        key={i}
                        className={`h-1 w-1 rounded-full ${
                          d.state === "booked" ? "bg-white/80" : "bg-link"
                        }`}
                      />
                    ))}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-3 text-[11px] text-faint mt-3">
          <span className="flex items-center gap-1">
            <i className="h-3 w-3 rounded bg-sand ring-1 ring-sea/20" aria-hidden />
            {c.legendOpen}
          </span>
          <span className="flex items-center gap-1">
            <i className="h-3 w-3 rounded bg-sea/15" aria-hidden />
            {c.legendBlocked}
          </span>
          <span className="flex items-center gap-1">
            <i className="h-3 w-3 rounded bg-sea" aria-hidden />
            {c.legendBooked}
          </span>
          <span className="flex items-center gap-1">
            <i className="h-1.5 w-1.5 rounded-full bg-link" aria-hidden />
            {c.legendJob}
          </span>
        </div>
      </Section>

      {selected.size > 0 ? (
        /*
          Sticky, because on a phone the selection happens at the top of a
          month grid and the buttons would otherwise be below the fold — which
          is how someone selects eight days and then loses them scrolling.
        */
        <div className="sticky bottom-3 z-10 mt-3 card p-3 flex flex-wrap items-center gap-2 shadow-md">
          <span className="text-sm font-bold text-sea">{c.selected(selected.size)}</span>
          <div className="flex gap-2 ms-auto">
            <button
              className="btn-primary !py-2 !px-4 !text-sm"
              disabled={busy}
              onClick={() => void apply("block")}
            >
              {c.close}
            </button>
            <button
              className="chip !text-sm font-bold"
              disabled={busy}
              onClick={() => void apply("open")}
            >
              {c.open}
            </button>
            <button className="text-sm text-faint underline" onClick={() => setSelected(new Set())}>
              {c.clear}
            </button>
          </div>
        </div>
      ) : null}

      {message ? <p className="card p-3 mt-3 text-sm font-bold text-sea">{message}</p> : null}
    </>
  );
}
