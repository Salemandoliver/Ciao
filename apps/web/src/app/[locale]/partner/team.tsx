"use client";
/**
 * The team.
 *
 * A hall has staff. A resort has a manager. The owner is very often not the
 * person holding the phone at nine at night — and without this screen the only
 * way to let a manager confirm bookings is to hand them the owner's login,
 * which is exactly what happens today, and is why "who cancelled that booking"
 * is an unanswerable question in this market.
 *
 * The role descriptions are written as consequences, not as capability lists:
 * an owner adding their nephew needs to know what the nephew will be able to
 * see, and "diary, clients, money" does not tell them that.
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { PARTNER_ROLES, PARTNER_ROLE_HINT, UI, fmtDate, term } from "@/lib/vocab";
import { localPhone } from "@ciao/shared";
import type { Locale } from "@/lib/i18n";
import { Pill, Section } from "@/components/panel";
import type { PartnerMe, TeamMember } from "./types";

const copy = {
  ar: {
    title: "فريقك",
    hint: "أضف من يشتغل معك برقم تلفونه. كل واحد يدخل بحسابه، وكل تغيير يتسجّل باسمه.",
    add: "أضف عضو",
    phone: "رقم التلفون",
    name: "الاسم",
    role: "الصلاحية",
    save: "أضف",
    remove: "أزل",
    empty: "ما عندك أحد في الفريق — أنت الوحيد.",
    owner: "أنت صاحب النشاط",
    ownerNote:
      "صلاحية «صاحب النشاط» ما تُعطى لأحد ثاني: هي اللي تتحكم في حساب استلام الأموال، وشخص ثاني يقدر يغيّره هو بالضبط الخطر اللي نحمي منه.",
    disabled: "موقوف",
    added: "تمت الإضافة",
    failed: "تعذر التنفيذ",
    confirmRemove: "متأكد أنك تبي تزيله من الفريق؟",
  },
  en: {
    title: "Your team",
    hint: "Add the people who work with you by phone number. Each signs in as themselves, and every change is recorded against their name.",
    add: "Add someone",
    phone: "Phone number",
    name: "Name",
    role: "What they can do",
    save: "Add",
    remove: "Remove",
    empty: "Nobody on the team yet — it's just you.",
    owner: "You are the owner",
    ownerNote:
      "The owner role can't be granted to anyone else: it controls where payouts go, and a second person who can change that is precisely the risk this protects against.",
    disabled: "Disabled",
    added: "Added",
    failed: "Could not do that",
    confirmRemove: "Remove them from the team?",
  },
} satisfies Record<Locale, unknown>;

export function TeamTab({ me }: { me: PartnerMe }) {
  const locale = useLocale();
  const c = copy[locale];
  const [items, setItems] = useState<TeamMember[]>([]);
  const [draft, setDraft] = useState<{ phone: string; nameAr: string; role: "manager" | "staff" } | null>(
    null,
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const scope = `partnerId=${me.partnerId}`;

  const load = useCallback(async () => {
    try {
      const res = await api<{ items: TeamMember[] }>(`/v1/partner/team?${scope}`);
      setItems(res.items);
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : c.failed);
    }
  }, [scope, c.failed]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    if (!draft?.phone.trim()) return;
    setBusy(true);
    try {
      await api(`/v1/partner/team?${scope}`, {
        method: "POST",
        body: JSON.stringify({ phone: draft.phone, role: draft.role, nameAr: draft.nameAr || undefined }),
      });
      setMessage(c.added);
      setDraft(null);
      await load();
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : c.failed);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    // A confirm, because removing the wrong person mid-season locks a manager
    // out of the calendar on a Thursday.
    if (!window.confirm(c.confirmRemove)) return;
    setBusy(true);
    try {
      await api(`/v1/partner/team/${id}?${scope}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : c.failed);
    } finally {
      setBusy(false);
    }
  }

  const live = items.filter((i) => !i.disabledAt);

  return (
    <>
      <Section
        title={c.title}
        hint={c.hint}
        action={
          <button
            className="btn-primary !py-1.5 !px-3 !text-xs"
            onClick={() => setDraft({ phone: "", nameAr: "", role: "staff" })}
          >
            + {c.add}
          </button>
        }
      >
        <div className="rounded-2xl bg-sand p-3 mb-2">
          <p className="font-bold text-sea text-sm">{c.owner}</p>
          <p className="text-[11px] text-faint">{c.ownerNote}</p>
        </div>

        {live.length === 0 ? (
          <p className="text-sm text-faint">{c.empty}</p>
        ) : (
          <ul className="space-y-2">
            {live.map((m) => (
              <li key={m.id} className="rounded-2xl bg-sand p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold text-sea text-sm truncate">
                    {m.name ?? localPhone(m.phone)}
                  </p>
                  <p className="text-[11px] text-muted" dir="ltr">
                    {localPhone(m.phone)}
                  </p>
                  <p className="text-[11px] text-faint">
                    {term(PARTNER_ROLE_HINT, locale, m.role)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Pill tone={m.role === "manager" ? "amber" : "sand"}>
                    {term(PARTNER_ROLES, locale, m.role)}
                  </Pill>
                  <button
                    className="text-xs underline text-faint"
                    disabled={busy}
                    onClick={() => void remove(m.id)}
                  >
                    {c.remove}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {draft ? (
        <Section title={c.add}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="text-xs font-bold text-muted">{c.phone}</span>
              <input
                className="input !py-2 !text-sm mt-1"
                dir="ltr"
                inputMode="tel"
                placeholder="0912345678"
                value={draft.phone}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <span className="text-xs font-bold text-muted">{c.name}</span>
              <input
                className="input !py-2 !text-sm mt-1"
                value={draft.nameAr}
                onChange={(e) => setDraft({ ...draft, nameAr: e.target.value })}
              />
            </label>
            <fieldset className="sm:col-span-2">
              <legend className="text-xs font-bold text-muted mb-1">{c.role}</legend>
              <div className="space-y-2">
                {(["manager", "staff"] as const).map((role) => (
                  <label key={role} className="flex items-start gap-2 text-sm">
                    <input
                      type="radio"
                      name="partner-role"
                      className="mt-1"
                      checked={draft.role === role}
                      onChange={() => setDraft({ ...draft, role })}
                    />
                    <span>
                      <span className="font-bold text-sea">
                        {term(PARTNER_ROLES, locale, role)}
                      </span>
                      <span className="block text-[11px] text-faint">
                        {term(PARTNER_ROLE_HINT, locale, role)}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <div className="flex gap-2 mt-4">
            <button className="btn-primary !py-2 !px-5 !text-sm" disabled={busy} onClick={() => void add()}>
              {c.save}
            </button>
            <button className="chip !text-sm font-bold" onClick={() => setDraft(null)}>
              {term(UI, locale, "cancel")}
            </button>
          </div>
        </Section>
      ) : null}

      {message ? <p className="card p-3 mt-3 text-sm font-bold text-sea">{message}</p> : null}
      {live.length > 0 ? (
        <p className="text-[11px] text-faint mt-3">
          {locale === "en"
            ? `Members added: ${live
                .map((m) => fmtDate(locale, m.createdAt, { day: "numeric", month: "short" }))
                .join(", ")}`
            : `تاريخ الإضافة: ${live
                .map((m) => fmtDate(locale, m.createdAt, { day: "numeric", month: "short" }))
                .join("، ")}`}
        </p>
      ) : null}
    </>
  );
}
