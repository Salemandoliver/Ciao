"use client";
/**
 * Partner leads — people who tapped «اعرض مكانك» on the marketplace.
 *
 * This is a call list, not a CRM. Every design choice here follows from the
 * fact that the next action on any row is picking up a phone.
 *
 * **The number is the headline.** It is shown in the local 09… form, in Latin
 * digits, large and selectable, because an agent is going to read it out or
 * copy it into WhatsApp. Everything else on the row is smaller than it.
 *
 * **Claiming is one tap and visible to everyone.** Two agents opening this at
 * nine in the morning must not both ring the same owner — that is a bad first
 * impression from a company selling reliability. The server settles the race
 * first-write-wins and tells the loser rather than silently overruling them.
 *
 * **The queue is ordered newest-first and filtered by state, not searched.**
 * At the volume this will see for a long time, a search box is furniture. If
 * it ever needs one, that is a good problem and a later commit.
 *
 * Note the phone numbers on this screen: this is the one console surface that
 * exists to display them, so it sits behind `catalogue` — ops and admin, never
 * finance, whose remit is the books and nothing else.
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { localPhone } from "@ciao/shared";
import type { Locale } from "@/lib/i18n";
import { Pill, Section } from "./lib";

interface Lead {
  id: string;
  name: string;
  phone: string;
  surface: string;
  locale: string;
  status: string;
  note: string | null;
  claimedById: string | null;
  claimedByName: string | null;
  claimedAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
}

const STATUSES = ["new", "contacted", "visiting", "onboarded", "declined"] as const;
type Status = (typeof STATUSES)[number];

/** Pill tones read as a temperature: untouched → working → won / lost. */
const TONE: Record<Status, "amber" | "sand" | "green" | "red"> = {
  new: "amber",
  contacted: "sand",
  visiting: "sand",
  onboarded: "green",
  declined: "red",
};

const copy = {
  ar: {
    title: "طلبات عرض الأماكن",
    hint: "أصحاب أماكن تركوا أرقامهم من التطبيق. الرقم متأكَّد منه برمز، يعني يوصل.",
    empty: "ما فيش طلبات بعد.",
    all: "الكل",
    status: {
      new: "جديد",
      contacted: "تم الاتصال",
      visiting: "زيارة مرتّبة",
      onboarded: "انضم",
      declined: "اعتذر",
    } as Record<Status, string>,
    surface: { home: "الصفحة الرئيسية", about: "من نحن", listing: "صفحة مكان" } as Record<string, string>,
    claim: "خذ الطلب",
    release: "ارجعه",
    claimedBy: (who: string) => `مع ${who}`,
    claimedByYou: "معك",
    note: "ملاحظات المكالمة",
    notePlaceholder: "شنو قال، ووقت الزيارة…",
    save: "احفظ",
    saved: "اتحفظ",
    again: "رجع مرة ثانية",
    failed: "ما تمّش الحفظ. حاول مرة أخرى.",
    taken: "طلب هذا مع زميل ثاني — حدّث الصفحة.",
    forbidden: "ما عندكش صلاحية لهذا.",
  },
  en: {
    title: "Requests to list a place",
    hint: "Owners who left their number in the app. Each number was confirmed by code, so it reaches them.",
    empty: "No requests yet.",
    all: "All",
    status: {
      new: "New",
      contacted: "Called",
      visiting: "Visit booked",
      onboarded: "Joined",
      declined: "Declined",
    } as Record<Status, string>,
    surface: { home: "Home page", about: "About", listing: "A listing" } as Record<string, string>,
    claim: "Take it",
    release: "Hand back",
    claimedBy: (who: string) => `With ${who}`,
    claimedByYou: "With you",
    note: "Call notes",
    notePlaceholder: "What they said, when the visit is…",
    save: "Save",
    saved: "Saved",
    again: "Came back again",
    failed: "That didn't save. Try again.",
    taken: "A colleague has taken this one — refresh.",
    forbidden: "You don't have permission for that.",
  },
} satisfies Record<Locale, unknown>;

export function LeadsTab() {
  const locale = useLocale();
  const t = copy[locale];
  const [items, setItems] = useState<Lead[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<Status | "">("");
  const [error, setError] = useState("");
  const [savedId, setSavedId] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: Lead[]; counts: Record<string, number> }>(
        `/v1/biz/leads${filter ? `?status=${filter}` : ""}`,
      );
      setItems(r.items);
      setCounts(r.counts);
      setError("");
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? t.forbidden : t.failed);
    }
  }, [filter, t.forbidden, t.failed]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(id: string, body: Record<string, unknown>) {
    try {
      await api(`/v1/biz/leads/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      setSavedId(id);
      setError("");
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setError(t.forbidden);
      else if (e instanceof Error && e.message.includes("lead_already_claimed")) setError(t.taken);
      else setError(t.failed);
    }
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <Section title={t.title} hint={t.hint}>
      <div className="flex flex-wrap gap-2 mb-4">
        <FilterChip label={`${t.all} (${total})`} on={filter === ""} onClick={() => setFilter("")} />
        {STATUSES.map((s) => (
          <FilterChip
            key={s}
            label={`${t.status[s]} (${counts[s] ?? 0})`}
            on={filter === s}
            onClick={() => setFilter(s)}
          />
        ))}
      </div>

      {error ? <p className="text-danger text-sm font-bold mb-3">{error}</p> : null}

      {items.length === 0 ? (
        <p className="text-faint text-sm">{t.empty}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((lead) => (
            <li key={lead.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  {/* The number leads. It is what this screen is for. */}
                  <p dir="ltr" className="font-bold text-lg text-sea text-start select-all">
                    {localPhone(lead.phone)}
                  </p>
                  <p className="text-sm text-muted truncate">{lead.name}</p>
                  <p className="text-xs text-faint mt-1">
                    {new Date(lead.createdAt).toLocaleDateString(
                      locale === "ar" ? "ar-LY-u-nu-latn" : "en-GB",
                    )}
                    {" · "}
                    {t.surface[lead.surface] ?? lead.surface}
                    {lead.lastSeenAt ? ` · ${t.again}` : ""}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <Pill tone={TONE[lead.status as Status] ?? "sand"}>
                    {t.status[lead.status as Status] ?? lead.status}
                  </Pill>
                  {lead.claimedById ? (
                    <button
                      className="text-xs font-bold text-link"
                      onClick={() => void patch(lead.id, { claim: false })}
                    >
                      {lead.claimedByName ? t.claimedBy(lead.claimedByName) : t.claimedByYou} ·{" "}
                      {t.release}
                    </button>
                  ) : (
                    <button
                      className="text-xs font-bold text-link"
                      onClick={() => void patch(lead.id, { claim: true })}
                    >
                      {t.claim}
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 mt-3">
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    disabled={lead.status === s}
                    onClick={() => void patch(lead.id, { status: s })}
                    className={`rounded-full px-3 py-1 text-xs font-bold transition-colors ${
                      lead.status === s
                        ? "bg-amber text-sea-dark"
                        : "bg-sand text-muted hover:text-sea"
                    }`}
                  >
                    {t.status[s]}
                  </button>
                ))}
              </div>

              <label className="block text-xs font-bold text-muted mt-3">
                {t.note}
                <textarea
                  className="input !py-2 !text-sm mt-1"
                  rows={2}
                  placeholder={t.notePlaceholder}
                  value={notes[lead.id] ?? lead.note ?? ""}
                  onChange={(e) => setNotes((n) => ({ ...n, [lead.id]: e.target.value }))}
                />
              </label>
              <button
                className="btn-secondary !py-1.5 !text-sm mt-2"
                onClick={() => void patch(lead.id, { note: notes[lead.id] ?? lead.note ?? "" })}
              >
                {savedId === lead.id ? t.saved : t.save}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function FilterChip({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full px-3 py-1 text-xs font-bold transition-colors ${
        on ? "bg-sea text-white" : "bg-sand text-muted hover:text-sea"
      }`}
    >
      {label}
    </button>
  );
}
