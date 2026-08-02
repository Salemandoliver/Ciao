"use client";
/**
 * The diary.
 *
 * This is the screen that makes the argument. A partner can put work here that
 * Ciao had nothing to do with — the cousin's wedding booked over WhatsApp, the
 * walk-in, the returning client — and the form says so in as many words: no
 * commission, we don't contact your customer, it is yours.
 *
 * That promise is not decoration. It is the reason the diary fills up, and a
 * full diary is what closes the double-booking hole and produces the only
 * honest picture anyone has of this market. The moment we monetise it, it
 * empties.
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError, api, fmtLyd } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import {
  JOB_KINDS,
  JOB_SOURCES,
  JOB_STATUS,
  JOB_STATUS_TONE,
  UI,
  fmtDate,
  term,
} from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";
import { listingTitle, textProps } from "@/lib/content";
import { Pill, Section } from "@/components/panel";
import type { Job, PartnerMe } from "./types";

const SOURCE_OPTIONS = ["whatsapp", "phone", "walk_in", "instagram", "facebook", "repeat", "other"];
const STATUS_OPTIONS = ["enquiry", "confirmed", "done", "cancelled", "no_show"];

const copy = {
  ar: {
    title: "الحجوزات والشغل",
    hint: "كل شغلك — اللي جاك من تشاو واللي جاك من برّا.",
    add: "أضف شغل",
    edit: "تعديل",
    save: "احفظ",
    cancel: "إلغاء",
    empty: "ما عندك شيء مسجّل بعد.",
    ownPromise:
      "الشغل اللي تسجّله بنفسك يخصّك: تشاو ما تاخذ منه عمولة، وما نتواصل مع زبونك. نسجّله عشان تقويمك يكون صادق ويمنع الحجز المزدوج.",
    lockedNote: "هذا حجز عبر تشاو — التواريخ والمبالغ تتغيّر من صفحة الحجز نفسها. تقدر تعدّل ملاحظاتك.",
    fTitle: "وش الشغل؟",
    fTitlePh: "عرس هدى — تصوير",
    fClient: "اسم الزبون",
    fPhone: "رقمه",
    fDay: "التاريخ",
    fEndDay: "لآخر يوم (اختياري)",
    fStart: "الساعة",
    fPrice: "السعر",
    fPaid: "المدفوع",
    fLocation: "المكان",
    fNotes: "ملاحظات",
    fSource: "جاك من وين؟",
    fKind: "النوع",
    fStatus: "الحالة",
    fListing: "على أي نشاط؟",
    fNoListing: "بلا ربط بنشاط",
    fBlocks: "اقفل هذي الأيام في تقويم تشاو",
    blocksHint: "يمنع تشاو من بيع نفس اليوم لضيف ثاني.",
    clash: "عندك شغل ثاني في هذا اليوم",
    owed: "الباقي",
    saved: "تم الحفظ",
    failed: "تعذر الحفظ",
    filterAll: "الكل",
    dinars: "بالدينار",
  },
  en: {
    title: "Bookings & work",
    hint: "Everything you're doing — what came from Ciao and what came from anywhere else.",
    add: "Add a job",
    edit: "Edit",
    save: "Save",
    cancel: "Cancel",
    empty: "Nothing recorded yet.",
    ownPromise:
      "Work you add yourself is yours: Ciao takes no commission on it and never contacts your customer. We record it so your calendar tells the truth and no date gets sold twice.",
    lockedNote:
      "This is a Ciao booking — its dates and amounts change from the booking itself. Your notes are still yours to edit.",
    fTitle: "What is the job?",
    fTitlePh: "Huda's wedding — photography",
    fClient: "Client name",
    fPhone: "Their number",
    fDay: "Date",
    fEndDay: "Last day (optional)",
    fStart: "Time",
    fPrice: "Price",
    fPaid: "Paid so far",
    fLocation: "Where",
    fNotes: "Notes",
    fSource: "Where did it come from?",
    fKind: "Type",
    fStatus: "Status",
    fListing: "Which listing?",
    fNoListing: "Not tied to a listing",
    fBlocks: "Close these days on the Ciao calendar",
    blocksHint: "Stops Ciao selling the same day to someone else.",
    clash: "You already have work that day",
    owed: "Still owed",
    saved: "Saved",
    failed: "Could not save",
    filterAll: "All",
    dinars: "in dinars",
  },
} satisfies Record<Locale, unknown>;

interface Draft {
  id?: string;
  titleAr: string;
  clientName: string;
  clientPhone: string;
  day: string;
  endDay: string;
  startTime: string;
  price: string;
  amountPaid: string;
  locationAr: string;
  notesAr: string;
  source: string;
  kind: string;
  status: string;
  listingId: string;
  blocksCalendar: boolean;
  locked: boolean;
}

function emptyDraft(me: PartnerMe): Draft {
  return {
    titleAr: "",
    clientName: "",
    clientPhone: "",
    day: new Date().toISOString().slice(0, 10),
    endDay: "",
    startTime: "",
    price: "",
    amountPaid: "",
    locationAr: "",
    notesAr: "",
    source: "whatsapp",
    kind: me.profile.kind === "service" ? "appointment" : me.profile.kind === "hall" ? "event" : "stay",
    status: "confirmed",
    listingId: me.listings[0]?.id ?? "",
    blocksCalendar: true,
    locked: false,
  };
}

/** Dinars in the form, dirhams on the wire. Nobody types thousandths. */
function toDirhams(value: string): number {
  const n = Number(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 1000) : 0;
}
function toDinars(dirhams: number): string {
  return dirhams > 0 ? String(Math.round(dirhams / 1000)) : "";
}

export function JobsTab({ me }: { me: PartnerMe }) {
  const locale = useLocale();
  const c = copy[locale];
  const [jobs, setJobs] = useState<Job[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [clash, setClash] = useState(false);
  const scope = `partnerId=${me.partnerId}`;
  const showMoney = me.capabilities.includes("money");

  const load = useCallback(async () => {
    try {
      const res = await api<{ items: Job[] }>(
        `/v1/partner/jobs?${scope}${filter ? `&status=${filter}` : ""}`,
      );
      setJobs(res.items);
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : c.failed);
    }
  }, [scope, filter, c.failed]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * Check the clash as they pick the date, not when they save. A refusal after
   * the form is filled in is the moment people decide a tool is fighting them.
   */
  useEffect(() => {
    if (!draft?.day) return setClash(false);
    const days = [draft.day, draft.endDay].filter(Boolean).join(",");
    let cancelled = false;
    api<{ days: { day: string; full: boolean }[] }>(
      `/v1/partner/jobs/load?${scope}&days=${days}${draft.id ? `&excludeJobId=${draft.id}` : ""}`,
    )
      .then((res) => {
        if (!cancelled) setClash(res.days.some((d) => d.full));
      })
      .catch(() => setClash(false));
    return () => {
      cancelled = true;
    };
  }, [draft?.day, draft?.endDay, draft?.id, scope]);

  function startEdit(job: Job) {
    setDraft({
      id: job.id,
      titleAr: job.titleAr,
      clientName: job.clientNameAr ?? "",
      clientPhone: job.clientPhone ?? "",
      day: job.day,
      endDay: job.endDay ?? "",
      startTime: job.startTime ?? "",
      price: toDinars(job.price),
      amountPaid: toDinars(job.amountPaid),
      locationAr: job.locationAr ?? "",
      notesAr: job.notesAr ?? "",
      source: job.source,
      kind: job.kind,
      status: job.status,
      listingId: job.listingId ?? "",
      blocksCalendar: job.blocksCalendar,
      locked: job.locked,
    });
  }

  async function save() {
    if (!draft || !draft.titleAr.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      // A Ciao booking's dates and money belong to the booking; the diary sends
      // only what is genuinely the partner's to change.
      const body = draft.locked
        ? {
            titleAr: draft.titleAr,
            locationAr: draft.locationAr || null,
            notesAr: draft.notesAr || null,
          }
        : {
            titleAr: draft.titleAr,
            ...(draft.clientName
              ? { client: { nameAr: draft.clientName, phone: draft.clientPhone || null } }
              : {}),
            day: draft.day,
            endDay: draft.endDay || null,
            startTime: draft.startTime || null,
            source: draft.source,
            kind: draft.kind,
            status: draft.status,
            ...(showMoney
              ? { price: toDirhams(draft.price), amountPaid: toDirhams(draft.amountPaid) }
              : {}),
            locationAr: draft.locationAr || null,
            notesAr: draft.notesAr || null,
            listingId: draft.listingId || null,
            blocksCalendar: draft.blocksCalendar,
          };

      if (draft.id) {
        await api(`/v1/partner/jobs/${draft.id}?${scope}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else {
        await api(`/v1/partner/jobs?${scope}`, { method: "POST", body: JSON.stringify(body) });
      }
      setMessage(c.saved);
      setDraft(null);
      await load();
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : c.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Section
        title={c.title}
        hint={c.hint}
        action={
          me.directJobsEnabled ? (
            <button
              className="btn-primary !py-1.5 !px-3 !text-xs"
              onClick={() => setDraft(emptyDraft(me))}
            >
              + {c.add}
            </button>
          ) : null
        }
      >
        <div className="flex gap-1.5 overflow-x-auto pb-2 mb-2">
          {["", ...STATUS_OPTIONS].map((s) => (
            <button
              key={s || "all"}
              onClick={() => setFilter(s)}
              className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-bold ${
                filter === s ? "bg-sea text-white" : "bg-sand text-muted"
              }`}
            >
              {s ? term(JOB_STATUS, locale, s) : c.filterAll}
            </button>
          ))}
        </div>

        {jobs.length === 0 ? (
          <p className="text-sm text-faint">{c.empty}</p>
        ) : (
          <ul className="space-y-2">
            {jobs.map((j) => (
              <li key={j.id} className="rounded-2xl bg-sand p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-sea leading-tight" lang="ar" dir="rtl">
                      {j.titleAr}
                    </p>
                    <p className="text-[11px] text-muted tabular-nums">
                      {fmtDate(locale, j.day, { day: "numeric", month: "short", year: "numeric" })}
                      {j.endDay && j.endDay !== j.day
                        ? ` → ${fmtDate(locale, j.endDay, { day: "numeric", month: "short" })}`
                        : ""}
                      {j.startTime ? ` · ${j.startTime}` : ""}
                    </p>
                    {j.clientNameAr ? (
                      <p className="text-[11px] text-faint" lang="ar" dir="rtl">
                        {j.clientNameAr}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Pill tone={JOB_STATUS_TONE[j.status] ?? "sand"}>
                      {term(JOB_STATUS, locale, j.status)}
                    </Pill>
                    <span className="text-[11px] text-faint">
                      {term(JOB_SOURCES, locale, j.source)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-2">
                  {showMoney && j.price > 0 ? (
                    <span className="text-xs font-bold text-sea tabular-nums">
                      {fmtLyd(j.price, locale)}
                      {j.balanceDue > 0 ? (
                        <span className="text-link font-bold ms-2">
                          {c.owed} {fmtLyd(j.balanceDue, locale)}
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                  <button
                    className="text-xs underline text-sea font-bold ms-auto"
                    onClick={() => startEdit(j)}
                  >
                    {c.edit}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {draft ? (
        <Section title={draft.id ? c.edit : c.add} hint={draft.locked ? c.lockedNote : c.ownPromise}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2 text-sm">
              <span className="text-xs font-bold text-muted">{c.fTitle}</span>
              <input
                className="input !py-2 !text-sm mt-1"
                placeholder={c.fTitlePh}
                value={draft.titleAr}
                onChange={(e) => setDraft({ ...draft, titleAr: e.target.value })}
              />
            </label>

            {!draft.locked ? (
              <>
                <label className="text-sm">
                  <span className="text-xs font-bold text-muted">{c.fClient}</span>
                  <input
                    className="input !py-2 !text-sm mt-1"
                    value={draft.clientName}
                    onChange={(e) => setDraft({ ...draft, clientName: e.target.value })}
                  />
                </label>
                <label className="text-sm">
                  <span className="text-xs font-bold text-muted">{c.fPhone}</span>
                  <input
                    className="input !py-2 !text-sm mt-1"
                    dir="ltr"
                    inputMode="tel"
                    placeholder="0912345678"
                    value={draft.clientPhone}
                    onChange={(e) => setDraft({ ...draft, clientPhone: e.target.value })}
                  />
                </label>
                <label className="text-sm">
                  <span className="text-xs font-bold text-muted">{c.fDay}</span>
                  <input
                    type="date"
                    dir="ltr"
                    className="input !py-2 !text-sm mt-1"
                    value={draft.day}
                    onChange={(e) => setDraft({ ...draft, day: e.target.value })}
                  />
                </label>
                <label className="text-sm">
                  <span className="text-xs font-bold text-muted">{c.fEndDay}</span>
                  <input
                    type="date"
                    dir="ltr"
                    className="input !py-2 !text-sm mt-1"
                    value={draft.endDay}
                    onChange={(e) => setDraft({ ...draft, endDay: e.target.value })}
                  />
                </label>
                <label className="text-sm">
                  <span className="text-xs font-bold text-muted">{c.fStart}</span>
                  <input
                    type="time"
                    dir="ltr"
                    className="input !py-2 !text-sm mt-1"
                    value={draft.startTime}
                    onChange={(e) => setDraft({ ...draft, startTime: e.target.value })}
                  />
                </label>
                <label className="text-sm">
                  <span className="text-xs font-bold text-muted">{c.fSource}</span>
                  <select
                    className="input !py-2 !text-sm mt-1"
                    value={draft.source}
                    onChange={(e) => setDraft({ ...draft, source: e.target.value })}
                  >
                    {SOURCE_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {term(JOB_SOURCES, locale, s)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="text-xs font-bold text-muted">{c.fKind}</span>
                  <select
                    className="input !py-2 !text-sm mt-1"
                    value={draft.kind}
                    onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
                  >
                    {["stay", "day_use", "event", "session", "appointment", "visit"].map((k) => (
                      <option key={k} value={k}>
                        {term(JOB_KINDS, locale, k)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="text-xs font-bold text-muted">{c.fStatus}</span>
                  <select
                    className="input !py-2 !text-sm mt-1"
                    value={draft.status}
                    onChange={(e) => setDraft({ ...draft, status: e.target.value })}
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {term(JOB_STATUS, locale, s)}
                      </option>
                    ))}
                  </select>
                </label>
                {showMoney ? (
                  <>
                    <label className="text-sm">
                      <span className="text-xs font-bold text-muted">
                        {c.fPrice} <span className="text-faint font-normal">({c.dinars})</span>
                      </span>
                      <input
                        className="input !py-2 !text-sm mt-1"
                        dir="ltr"
                        inputMode="numeric"
                        value={draft.price}
                        onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                      />
                    </label>
                    <label className="text-sm">
                      <span className="text-xs font-bold text-muted">
                        {c.fPaid} <span className="text-faint font-normal">({c.dinars})</span>
                      </span>
                      <input
                        className="input !py-2 !text-sm mt-1"
                        dir="ltr"
                        inputMode="numeric"
                        value={draft.amountPaid}
                        onChange={(e) => setDraft({ ...draft, amountPaid: e.target.value })}
                      />
                    </label>
                  </>
                ) : null}
                {me.listings.length > 0 ? (
                  <label className="text-sm">
                    <span className="text-xs font-bold text-muted">{c.fListing}</span>
                    <select
                      className="input !py-2 !text-sm mt-1"
                      value={draft.listingId}
                      onChange={(e) => setDraft({ ...draft, listingId: e.target.value })}
                    >
                      <option value="">{c.fNoListing}</option>
                      {me.listings.map((l) => {
                        const title = listingTitle(locale, l);
                        return (
                          <option key={l.id} value={l.id} {...textProps(title)}>
                            {title.text}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                ) : null}
              </>
            ) : null}

            <label className="text-sm">
              <span className="text-xs font-bold text-muted">{c.fLocation}</span>
              <input
                className="input !py-2 !text-sm mt-1"
                value={draft.locationAr}
                onChange={(e) => setDraft({ ...draft, locationAr: e.target.value })}
              />
            </label>
            <label className="sm:col-span-2 text-sm">
              <span className="text-xs font-bold text-muted">{c.fNotes}</span>
              <textarea
                className="input !py-2 !text-sm mt-1"
                rows={2}
                value={draft.notesAr}
                onChange={(e) => setDraft({ ...draft, notesAr: e.target.value })}
              />
            </label>

            {!draft.locked && draft.listingId ? (
              <label className="sm:col-span-2 flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={draft.blocksCalendar}
                  onChange={(e) => setDraft({ ...draft, blocksCalendar: e.target.checked })}
                />
                <span>
                  <span className="font-bold text-sea">{c.fBlocks}</span>
                  <span className="block text-[11px] text-faint">{c.blocksHint}</span>
                </span>
              </label>
            ) : null}
          </div>

          {clash && !draft.locked ? (
            <p className="text-sm text-link font-bold mt-3">⚠︎ {c.clash}</p>
          ) : null}

          <div className="flex gap-2 mt-4">
            <button className="btn-primary !py-2 !px-5 !text-sm" disabled={busy} onClick={() => void save()}>
              {c.save}
            </button>
            <button className="chip !text-sm font-bold" onClick={() => setDraft(null)}>
              {term(UI, locale, "cancel")}
            </button>
          </div>
        </Section>
      ) : null}

      {message ? <p className="card p-3 mt-3 text-sm font-bold text-sea">{message}</p> : null}
    </>
  );
}
