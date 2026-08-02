"use client";
/**
 * How this business works.
 *
 * Every field here exists because getting it wrong costs the partner a
 * booking or costs them a Thursday. `maxJobsPerDay` is the one that makes a
 * single console work for a chalet and for a make-up artist: a venue is one
 * job a day and a make-up artist is four, and without the setting the calendar
 * is wrong for one of them from the first screen.
 *
 * The agenda hour is a real choice, not a preference. A caterer wants
 * tomorrow's list at four in the afternoon while there is still time to buy;
 * a chalet owner wants it at nine when he has finished the day.
 */
import { useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { AREAS, UI, term } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";
import { Section } from "@/components/panel";
import type { PartnerMe } from "./types";

const AREA_KEYS = ["janzour", "tajoura", "ain_zara", "airport_road"];
const WEEKDAYS = [6, 7, 1, 2, 3, 4, 5]; // Saturday-first, the Libyan week

const copy = {
  ar: {
    title: "إعدادات نشاطك",
    hint: "الإعدادات هذي تحدد شكل تقويمك وكيف يوصلك التذكير.",
    nameAr: "اسم نشاطك (عربي)",
    nameEn: "اسمه بالإنجليزي (اختياري)",
    kind: "نوع النشاط",
    kinds: { venue: "شاليه أو استراحة", hall: "قاعة أفراح", service: "خدمة" },
    maxJobs: "كم شغلة تقدر تاخذ في اليوم؟",
    maxJobsHint: "شاليه عادة ١. ميكب آرتيست ممكن ٣ أو ٤ في الصبح.",
    notice: "كم ساعة تحتاج قبل الموعد؟",
    noticeHint: "طلب يوصلك متأخر عن كذا يضرّك أكثر ما ينفعك.",
    workingDays: "أيام شغلك",
    hours: "ساعات الدوام",
    from: "من",
    to: "إلى",
    travels: "تروح لعند الزبون",
    travelFee: "أجرة التنقل (د.ل)",
    areas: "المناطق اللي تخدمها",
    deposit: "العربون الافتراضي في عروضك (%)",
    agenda: "تذكير برنامج بكرة",
    agendaHint: "نرسل لك شغل بكرة على واتساب في الوقت اللي تختاره.",
    agendaHour: "الساعة",
    save: "احفظ",
    saved: "تم الحفظ",
    failed: "تعذر الحفظ",
    onlyOwner: "الإعدادات لصاحب النشاط أو المدير.",
  },
  en: {
    title: "How your business works",
    hint: "These settings shape your calendar and how your reminders reach you.",
    nameAr: "Business name (Arabic)",
    nameEn: "Business name in English (optional)",
    kind: "Type of business",
    kinds: { venue: "Chalet or estiraha", hall: "Wedding hall", service: "Service" },
    maxJobs: "How many jobs can you take in a day?",
    maxJobsHint: "A chalet is usually 1. A make-up artist might do 3 or 4 in a morning.",
    notice: "How much notice do you need?",
    noticeHint: "A request that arrives later than this costs you more than it earns.",
    workingDays: "Days you work",
    hours: "Working hours",
    from: "From",
    to: "To",
    travels: "You travel to the client",
    travelFee: "Travel fee (LYD)",
    areas: "Areas you serve",
    deposit: "Default deposit on your quotes (%)",
    agenda: "Tomorrow's agenda reminder",
    agendaHint: "We send you tomorrow's work on WhatsApp at the hour you choose.",
    agendaHour: "Hour",
    save: "Save",
    saved: "Saved",
    failed: "Could not save",
    onlyOwner: "Settings are for the owner or a manager.",
  },
} satisfies Record<Locale, unknown>;

export function SettingsTab({ me, onSaved }: { me: PartnerMe; onSaved: () => void }) {
  const locale = useLocale();
  const c = copy[locale];
  const p = me.profile;
  const [form, setForm] = useState({
    businessNameAr: p.businessNameAr ?? "",
    businessNameEn: p.businessNameEn ?? "",
    kind: p.kind,
    maxJobsPerDay: String(p.maxJobsPerDay),
    noticeHours: String(p.noticeHours),
    workingDays: (p.workingDays ?? []) as number[],
    from: p.workingHours?.from ?? "",
    to: p.workingHours?.to ?? "",
    travelsToClient: p.travelsToClient,
    travelFee: p.travelFee > 0 ? String(Math.round(p.travelFee / 1000)) : "",
    serviceAreas: (p.serviceAreas ?? []) as string[],
    depositPct: String(Math.round(p.defaultDepositBps / 100)),
    agendaEnabled: p.agendaEnabled,
    agendaHour: String(p.agendaHour),
  });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const scope = `partnerId=${me.partnerId}`;

  function toggleIn<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  async function save() {
    setBusy(true);
    setMessage("");
    try {
      await api(`/v1/partner/profile?${scope}`, {
        method: "PATCH",
        body: JSON.stringify({
          businessNameAr: form.businessNameAr || null,
          businessNameEn: form.businessNameEn || null,
          kind: form.kind,
          maxJobsPerDay: Math.max(1, Number(form.maxJobsPerDay) || 1),
          noticeHours: Math.max(0, Number(form.noticeHours) || 0),
          workingDays: form.workingDays,
          workingHours: form.from && form.to ? { from: form.from, to: form.to } : null,
          travelsToClient: form.travelsToClient,
          travelFee: Math.round((Number(form.travelFee) || 0) * 1000),
          serviceAreas: form.serviceAreas,
          defaultDepositBps: Math.round((Number(form.depositPct) || 0) * 100),
          agendaEnabled: form.agendaEnabled,
          agendaHour: Math.min(23, Math.max(0, Number(form.agendaHour) || 18)),
          onboarded: true,
        }),
      });
      setMessage(c.saved);
      onSaved();
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : c.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={c.title} hint={c.hint}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="text-xs font-bold text-muted">{c.nameAr}</span>
          <input
            className="input !py-2 !text-sm mt-1"
            value={form.businessNameAr}
            onChange={(e) => setForm({ ...form, businessNameAr: e.target.value })}
          />
        </label>
        <label className="text-sm">
          <span className="text-xs font-bold text-muted">{c.nameEn}</span>
          <input
            className="input !py-2 !text-sm mt-1"
            dir="ltr"
            value={form.businessNameEn}
            onChange={(e) => setForm({ ...form, businessNameEn: e.target.value })}
          />
        </label>

        <label className="text-sm">
          <span className="text-xs font-bold text-muted">{c.kind}</span>
          <select
            className="input !py-2 !text-sm mt-1"
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value as typeof form.kind })}
          >
            {(["venue", "hall", "service"] as const).map((k) => (
              <option key={k} value={k}>
                {c.kinds[k]}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="text-xs font-bold text-muted">{c.maxJobs}</span>
          <input
            className="input !py-2 !text-sm mt-1"
            dir="ltr"
            inputMode="numeric"
            value={form.maxJobsPerDay}
            onChange={(e) => setForm({ ...form, maxJobsPerDay: e.target.value })}
          />
          <span className="block text-[11px] text-faint mt-1">{c.maxJobsHint}</span>
        </label>

        <label className="text-sm">
          <span className="text-xs font-bold text-muted">{c.notice}</span>
          <input
            className="input !py-2 !text-sm mt-1"
            dir="ltr"
            inputMode="numeric"
            value={form.noticeHours}
            onChange={(e) => setForm({ ...form, noticeHours: e.target.value })}
          />
          <span className="block text-[11px] text-faint mt-1">{c.noticeHint}</span>
        </label>

        <label className="text-sm">
          <span className="text-xs font-bold text-muted">{c.deposit}</span>
          <input
            className="input !py-2 !text-sm mt-1"
            dir="ltr"
            inputMode="numeric"
            value={form.depositPct}
            onChange={(e) => setForm({ ...form, depositPct: e.target.value })}
          />
        </label>

        <fieldset className="sm:col-span-2">
          <legend className="text-xs font-bold text-muted mb-1">{c.workingDays}</legend>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((iso) => {
              const on = form.workingDays.includes(iso);
              return (
                <button
                  key={iso}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setForm({ ...form, workingDays: toggleIn(form.workingDays, iso) })}
                  className={`rounded-full px-3 py-1 text-[11px] font-bold ${
                    on ? "bg-sea text-white" : "bg-sand text-muted"
                  }`}
                >
                  {new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "ar-LY", {
                    weekday: "short",
                    timeZone: "UTC",
                  }).format(new Date(Date.UTC(2026, 7, iso === 6 ? 1 : iso === 7 ? 2 : iso + 2)))}
                </button>
              );
            })}
          </div>
        </fieldset>

        <label className="text-sm">
          <span className="text-xs font-bold text-muted">
            {c.hours} — {c.from}
          </span>
          <input
            type="time"
            dir="ltr"
            className="input !py-2 !text-sm mt-1"
            value={form.from}
            onChange={(e) => setForm({ ...form, from: e.target.value })}
          />
        </label>
        <label className="text-sm">
          <span className="text-xs font-bold text-muted">
            {c.hours} — {c.to}
          </span>
          <input
            type="time"
            dir="ltr"
            className="input !py-2 !text-sm mt-1"
            value={form.to}
            onChange={(e) => setForm({ ...form, to: e.target.value })}
          />
        </label>

        {form.kind === "service" ? (
          <>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={form.travelsToClient}
                onChange={(e) => setForm({ ...form, travelsToClient: e.target.checked })}
              />
              <span className="font-bold text-sea">{c.travels}</span>
            </label>
            {form.travelsToClient ? (
              <label className="text-sm">
                <span className="text-xs font-bold text-muted">{c.travelFee}</span>
                <input
                  className="input !py-2 !text-sm mt-1"
                  dir="ltr"
                  inputMode="numeric"
                  value={form.travelFee}
                  onChange={(e) => setForm({ ...form, travelFee: e.target.value })}
                />
              </label>
            ) : null}
            <fieldset className="sm:col-span-2">
              <legend className="text-xs font-bold text-muted mb-1">{c.areas}</legend>
              <div className="flex flex-wrap gap-1.5">
                {AREA_KEYS.map((a) => {
                  const on = form.serviceAreas.includes(a);
                  return (
                    <button
                      key={a}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setForm({ ...form, serviceAreas: toggleIn(form.serviceAreas, a) })
                      }
                      className={`rounded-full px-3 py-1 text-[11px] font-bold ${
                        on ? "bg-sea text-white" : "bg-sand text-muted"
                      }`}
                    >
                      {term(AREAS, locale, a)}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </>
        ) : null}

        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={form.agendaEnabled}
            onChange={(e) => setForm({ ...form, agendaEnabled: e.target.checked })}
          />
          <span>
            <span className="font-bold text-sea">{c.agenda}</span>
            <span className="block text-[11px] text-faint">{c.agendaHint}</span>
          </span>
        </label>
        {form.agendaEnabled ? (
          <label className="text-sm">
            <span className="text-xs font-bold text-muted">{c.agendaHour}</span>
            <select
              className="input !py-2 !text-sm mt-1"
              value={form.agendaHour}
              onChange={(e) => setForm({ ...form, agendaHour: e.target.value })}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className="flex gap-2 mt-4">
        <button className="btn-primary !py-2 !px-5 !text-sm" disabled={busy} onClick={() => void save()}>
          {c.save}
        </button>
        {message ? <span className="self-center text-sm font-bold text-sea">{message}</span> : null}
        <span className="sr-only">{term(UI, locale, "save")}</span>
      </div>
    </Section>
  );
}
