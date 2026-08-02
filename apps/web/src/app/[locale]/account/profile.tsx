"use client";
/**
 * The declared profile — a date of birth, who usually travels with you, and
 * the months that matter.
 *
 * Everything on this screen was typed here by the member and can be untyped
 * here too. That is the same promise the preferences screen makes, and it is
 * why this sits next to it rather than in some onboarding funnel the user
 * cannot find again.
 *
 * Two shapes are deliberately absent, and the API has no field for either:
 *
 *  - A **family register.** The question is "who usually travels with you" —
 *    two counts and a coarse age band. No names, no relationships, no exact
 *    ages. Counts answer every question an offer actually asks ("somewhere
 *    for 8 adults and 3 children", "a walled, shallow pool") and, unlike a
 *    stored "daughter, aged 4", they do not rot within a year.
 *  - A **date** for an occasion. A month is all a nudge needs. Asking for the
 *    day as well would buy nothing and cost the trust that makes people
 *    answer the first question honestly.
 *
 * Every field is optional and says so. The points are stated next to each one
 * because a form that pays should say what it pays before you fill it in, not
 * after.
 */
import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { fmtDate, fmtNum } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";

export interface DeclaredProfile {
  birthDate: string | null;
  party: { adults: number; children: number; bands: string[] } | null;
  occasions: { kind: string; month: number }[];
  plannedEvent: { kind: string; date: string } | null;
  /** True while that reward is still unclaimed. */
  rewards: { birthDate: boolean; party: boolean };
}

const BANDS = ["toddler", "child", "teen"] as const;
const OCCASION_KINDS = ["anniversary", "family_birthday", "graduation", "other"] as const;
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const MAX_OCCASIONS = 6;

const copy = {
  ar: {
    optionalAll:
      "كل شيء هنا اختياري. تخطَّ أي سؤال ما تحب تجاوب عليه، وتقدر تعدّله أو تحذفه في أي وقت.",
    saveFailed: "تعذر الحفظ — حاول مرة أخرى",
    saved: "تم الحفظ ✅",
    earned: (points: string) => `تم الحفظ — كسبت ${points} نقطة ✅`,
    save: "حفظ",
    remove: "احذفه",
    worth: (points: string) => `+${points} نقطة`,
    optional: "اختياري",

    birthTitle: "تاريخ ميلادك",
    birthWhy:
      "لسببين فقط: نهنّيك في يوم ميلادك، ونعرف نوع الأماكن اللي تناسب فئتك العمرية. لا نعرضه لأحد.",
    birthGift: (points: string) => `وفي كل عيد ميلاد تصلك ${points} نقطة هدية.`,
    birthMarketing:
      "نقاط عيد ميلادك تصلك سواء وافقت على الرسائل التسويقية أو لا — الموافقة مطلوبة للرسالة نفسها فقط.",
    birthLabel: "تاريخ الميلاد",
    birthRemoved: "حُذف تاريخ ميلادك.",

    partyTitle: "مين يسافر معك عادة؟",
    partyWhy:
      "أعداد فقط — بدون أسماء ولا أعمار بالضبط. نستخدمها لنقترح أماكن بحجم مجموعتك، ولنعرف إذا كان المسبح آمنًا للصغار.",
    partyNotRegister: "ما نحفظ سجلًا لعائلتك: عدد الكبار، عدد الصغار، والفئة العمرية فقط.",
    adults: "عدد الكبار",
    children: "عدد الصغار",
    bandsLabel: "الفئة العمرية للصغار",
    bands: {
      toddler: "صغير جدًا (0–3)",
      child: "طفل (4–9)",
      teen: "مراهق (10–17)",
    } as Record<string, string>,

    occasionsTitle: "مناسباتك المتكررة",
    occasionsWhy:
      "الشهر فقط — لا نسأل عن اليوم ولا السنة. نذكّرك قبلها بوقت كافٍ إذا حبيت تحجز.",
    occasionsAdd: "أضف مناسبة",
    occasionsFull: (n: string) => `الحد ${n} مناسبات.`,
    occasionMonth: "الشهر",
    kinds: {
      anniversary: "ذكرى الزواج",
      family_birthday: "عيد ميلاد في العائلة",
      graduation: "تخرّج",
      other: "مناسبة أخرى",
    } as Record<string, string>,
  },
  en: {
    optionalAll:
      "Everything here is optional. Skip anything you would rather not answer — and you can change or delete any of it later.",
    saveFailed: "Could not save — try again",
    saved: "Saved ✅",
    earned: (points: string) => `Saved — you earned ${points} points ✅`,
    save: "Save",
    remove: "Delete it",
    worth: (points: string) => `+${points} points`,
    optional: "Optional",

    birthTitle: "Your date of birth",
    birthWhy:
      "Two reasons only: so we can wish you a happy birthday, and so we have some idea which places suit you. Nobody else sees it.",
    birthGift: (points: string) => `Every birthday we send you ${points} points as a gift.`,
    birthMarketing:
      "Your birthday points arrive whether or not you accept marketing messages — only the message itself needs your permission.",
    birthLabel: "Date of birth",
    birthRemoved: "Your date of birth has been deleted.",

    partyTitle: "Who usually travels with you?",
    partyWhy:
      "Numbers only — no names, no exact ages. We use them to suggest places the right size for your group, and to know whether a pool is safe for little ones.",
    partyNotRegister:
      "We do not keep a register of your family: how many adults, how many children, and a rough age band. That is all.",
    adults: "Adults",
    children: "Children",
    bandsLabel: "How old are the children?",
    bands: {
      toddler: "Toddler (0–3)",
      child: "Child (4–9)",
      teen: "Teen (10–17)",
    } as Record<string, string>,

    occasionsTitle: "Dates that come round every year",
    occasionsWhy:
      "The month only — we do not ask for the day or the year. We give you enough notice to book if you want to.",
    occasionsAdd: "Add an occasion",
    occasionsFull: (n: string) => `${n} is the limit.`,
    occasionMonth: "Month",
    kinds: {
      anniversary: "Wedding anniversary",
      family_birthday: "A birthday in the family",
      graduation: "Graduation",
      other: "Something else",
    } as Record<string, string>,
  },
} satisfies Record<Locale, unknown>;

/** Month names, in the reader's language. The year is arbitrary and unused. */
function monthName(locale: Locale, month: number): string {
  return fmtDate(locale, new Date(2001, month - 1, 1), { month: "long" });
}

interface SaveResult {
  profile: DeclaredProfile;
  earned: number;
}

/**
 * Read the message the API wrote for this failure.
 *
 * The birth-date refusals are written to explain themselves — under 18 is
 * refused because a booking is a contract, and the message says so and
 * suggests a parent books instead. Replacing that with "invalid input" would
 * leave someone retyping the same date, so the server's own words are shown
 * verbatim. `message` is the Arabic; `messageEn` rides alongside it.
 */
function apiMessage(e: unknown, locale: Locale, fallback: string): string {
  if (!(e instanceof ApiError)) return fallback;
  const en = e.detail?.messageEn;
  if (locale === "en" && typeof en === "string" && en) return en;
  return e.message || fallback;
}

export function ProfileFields({
  profile,
  rules,
  onChange,
}: {
  profile: DeclaredProfile | null;
  /** Point values, straight from the loyalty config — never hardcoded here. */
  rules: Record<string, number>;
  onChange: () => void | Promise<void>;
}) {
  const locale = useLocale();
  const c = copy[locale];

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted leading-relaxed">{c.optionalAll}</p>
      <BirthDateCard profile={profile} rules={rules} onChange={onChange} />
      <PartyCard profile={profile} rules={rules} onChange={onChange} />
      <OccasionsCard profile={profile} onChange={onChange} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────── date of birth

function BirthDateCard({
  profile,
  rules,
  onChange,
}: {
  profile: DeclaredProfile | null;
  rules: Record<string, number>;
  onChange: () => void | Promise<void>;
}) {
  const locale = useLocale();
  const c = copy[locale];
  const [value, setValue] = useState(profile?.birthDate ?? "");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => setValue(profile?.birthDate ?? ""), [profile?.birthDate]);

  // A date picker that offers tomorrow invites a typo we would then have to
  // refuse. Computed on the client so it is the member's own today.
  const today = new Date().toISOString().slice(0, 10);

  async function save(next: string | null) {
    setBusy(true);
    setMsg("");
    setErr("");
    try {
      const res = await api<SaveResult>("/v1/me/declared-profile", {
        method: "PATCH",
        body: JSON.stringify({ birthDate: next }),
      });
      setMsg(next === null ? c.birthRemoved : res.earned ? c.earned(fmtNum(locale, res.earned)) : c.saved);
      await onChange();
    } catch (e) {
      setErr(apiMessage(e, locale, c.saveFailed));
    } finally {
      setBusy(false);
    }
  }

  const points = rules.birth_date_added ?? 0;
  const gift = rules.birthday_gift ?? 0;

  return (
    <Card title={c.birthTitle} worth={points ? c.worth(fmtNum(locale, points)) : undefined}>
      <p className="text-xs text-muted leading-relaxed">
        {c.birthWhy} {gift ? c.birthGift(fmtNum(locale, gift)) : null}
      </p>
      {/* The consent line. It is here, next to the field, because this is
          where someone decides whether to trust the rest of the form. */}
      <p className="text-[11px] text-faint mt-2 leading-relaxed">{c.birthMarketing}</p>

      <label className="block text-xs font-bold text-muted mt-3 mb-1">
        {c.birthLabel} <span className="font-normal text-faint">· {c.optional}</span>
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          type="date"
          dir="ltr"
          max={today}
          className="input !py-2 !text-sm max-w-[12rem]"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          className="chip shrink-0"
          disabled={busy || !value || value === profile?.birthDate}
          onClick={() => void save(value)}
        >
          {c.save}
        </button>
        {profile?.birthDate ? (
          <button className="chip shrink-0" disabled={busy} onClick={() => void save(null)}>
            {c.remove}
          </button>
        ) : null}
      </div>

      {err ? <p className="text-sm text-danger font-bold mt-2 leading-relaxed">{err}</p> : null}
      {msg ? <p className="text-sm font-bold text-sea mt-2">{msg}</p> : null}
    </Card>
  );
}

// ───────────────────────────────────────────────────────── who travels with you

function PartyCard({
  profile,
  rules,
  onChange,
}: {
  profile: DeclaredProfile | null;
  rules: Record<string, number>;
  onChange: () => void | Promise<void>;
}) {
  const locale = useLocale();
  const c = copy[locale];
  const [adults, setAdults] = useState(profile?.party ? String(profile.party.adults) : "");
  const [children, setChildren] = useState(profile?.party ? String(profile.party.children) : "");
  const [bands, setBands] = useState<string[]>(profile?.party?.bands ?? []);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAdults(profile?.party ? String(profile.party.adults) : "");
    setChildren(profile?.party ? String(profile.party.children) : "");
    setBands(profile?.party?.bands ?? []);
  }, [profile?.party]);

  const adultCount = Number(adults);
  const childCount = children === "" ? 0 : Number(children);
  const valid = Number.isFinite(adultCount) && adultCount >= 1 && adultCount <= 40 && childCount <= 20;

  async function save() {
    setBusy(true);
    setMsg("");
    setErr("");
    try {
      const res = await api<SaveResult>("/v1/me/declared-profile", {
        method: "PATCH",
        body: JSON.stringify({
          party: {
            adults: adultCount,
            children: childCount,
            // Bands without children is a half-filled form, not an answer.
            bands: childCount > 0 ? bands : [],
          },
        }),
      });
      setMsg(res.earned ? c.earned(fmtNum(locale, res.earned)) : c.saved);
      await onChange();
    } catch (e) {
      setErr(apiMessage(e, locale, c.saveFailed));
    } finally {
      setBusy(false);
    }
  }

  const points = rules.party_profile_added ?? 0;

  return (
    <Card title={c.partyTitle} worth={points ? c.worth(fmtNum(locale, points)) : undefined}>
      <p className="text-xs text-muted leading-relaxed">{c.partyWhy}</p>
      <p className="text-[11px] text-faint mt-2 leading-relaxed">{c.partyNotRegister}</p>

      <div className="grid grid-cols-2 gap-2 mt-3">
        <Counter label={c.adults} value={adults} min={1} max={40} onChange={setAdults} />
        <Counter label={c.children} value={children} min={0} max={20} onChange={setChildren} />
      </div>

      {childCount > 0 ? (
        <>
          <p className="text-xs font-bold text-muted mt-3 mb-1.5">
            {c.bandsLabel} <span className="font-normal text-faint">· {c.optional}</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {BANDS.map((b) => {
              const on = bands.includes(b);
              return (
                <button
                  key={b}
                  className={`chip ${on ? "!bg-sea !text-white" : ""}`}
                  aria-pressed={on}
                  onClick={() => setBands(on ? bands.filter((x) => x !== b) : [...bands, b])}
                >
                  {c.bands[b]}
                </button>
              );
            })}
          </div>
        </>
      ) : null}

      <button className="chip mt-3" disabled={busy || !valid} onClick={() => void save()}>
        {c.save}
      </button>

      {err ? <p className="text-sm text-danger font-bold mt-2">{err}</p> : null}
      {msg ? <p className="text-sm font-bold text-sea mt-2">{msg}</p> : null}
    </Card>
  );
}

/** A plain number field. Counts only — see the note at the top of the file. */
function Counter({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  min: number;
  max: number;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-muted mb-1">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        dir="ltr"
        min={min}
        max={max}
        className="input !py-2 !text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

// ──────────────────────────────────────────────────────────────── occasions

function OccasionsCard({
  profile,
  onChange,
}: {
  profile: DeclaredProfile | null;
  onChange: () => void | Promise<void>;
}) {
  const locale = useLocale();
  const c = copy[locale];
  const [rows, setRows] = useState<{ kind: string; month: number }[]>(profile?.occasions ?? []);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => setRows(profile?.occasions ?? []), [profile?.occasions]);

  async function save(next: { kind: string; month: number }[]) {
    setBusy(true);
    setMsg("");
    setErr("");
    try {
      const res = await api<SaveResult>("/v1/me/declared-profile", {
        method: "PATCH",
        body: JSON.stringify({ occasions: next }),
      });
      setMsg(res.earned ? c.earned(fmtNum(locale, res.earned)) : c.saved);
      await onChange();
    } catch (e) {
      setErr(apiMessage(e, locale, c.saveFailed));
    } finally {
      setBusy(false);
    }
  }

  function patch(i: number, part: Partial<{ kind: string; month: number }>) {
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...part } : r)));
  }

  return (
    <Card title={c.occasionsTitle}>
      <p className="text-xs text-muted leading-relaxed">{c.occasionsWhy}</p>

      <div className="space-y-2 mt-3">
        {rows.map((row, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1.5">
            <select
              className="chip !py-1.5"
              value={row.kind}
              onChange={(e) => patch(i, { kind: e.target.value })}
              aria-label={c.occasionsTitle}
            >
              {OCCASION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {c.kinds[k]}
                </option>
              ))}
            </select>
            {/* A month, never a date. */}
            <select
              className="chip !py-1.5"
              value={row.month}
              onChange={(e) => patch(i, { month: Number(e.target.value) })}
              aria-label={c.occasionMonth}
            >
              {MONTHS.map((m) => (
                <option key={m} value={m}>
                  {monthName(locale, m)}
                </option>
              ))}
            </select>
            <button
              className="chip !px-2"
              aria-label={c.remove}
              onClick={() => setRows(rows.filter((_, idx) => idx !== i))}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button
          className="chip"
          disabled={rows.length >= MAX_OCCASIONS}
          onClick={() => setRows([...rows, { kind: "anniversary", month: 1 }])}
        >
          + {c.occasionsAdd}
        </button>
        <button className="chip" disabled={busy} onClick={() => void save(rows)}>
          {c.save}
        </button>
        {rows.length >= MAX_OCCASIONS ? (
          <span className="text-[11px] text-faint">{c.occasionsFull(fmtNum(locale, MAX_OCCASIONS))}</span>
        ) : null}
      </div>

      {err ? <p className="text-sm text-danger font-bold mt-2">{err}</p> : null}
      {msg ? <p className="text-sm font-bold text-sea mt-2">{msg}</p> : null}
    </Card>
  );
}

function Card({
  title,
  worth,
  children,
}: {
  title: string;
  worth?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-4">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <h3 className="font-bold text-sea text-sm">{title}</h3>
        {worth ? <span className="badge-success rounded-full px-2 py-0.5 text-[11px] font-bold shrink-0">{worth}</span> : null}
      </div>
      {children}
    </section>
  );
}
