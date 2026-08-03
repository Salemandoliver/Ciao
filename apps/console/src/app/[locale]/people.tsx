"use client";
/**
 * People — users and what they're allowed to do.
 *
 * Role changes are the highest-consequence action in this console: granting
 * ops hands someone the ability to move money. So the change is admin-only on
 * the server, it is audited with a name attached forever, and the UI asks for
 * confirmation rather than firing on a select change.
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { ROLES, fmtDate, fmtNum, term } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";
import { Money, Pill } from "./lib";

interface BizUser {
  id: string;
  phone: string;
  displayName: string | null;
  publicName: string | null;
  role: string;
  createdAt: string;
  bookings: number;
  gmv: number;
}

const ROLE_KEYS = ["guest", "host", "agent", "finance", "ops", "admin"];

interface TeamMember {
  id: string;
  phone: string;
  displayName: string | null;
  role: string;
  disabled: boolean;
  hasPassword: boolean;
  mustChange: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  inviteOutstanding: boolean;
}

const copy = {
  ar: {
    loadFailed: "تعذر تحميل المستخدمين",
    /* The role change reads right-to-left in Arabic and left-to-right in
       English, so the arrow has to flip with the language or it points at the
       role being replaced. */
    arrow: "←",
    confirmRole: (label: string) =>
      `تأكيد تغيير الصلاحية؟\n${label}\n\nسيُسجَّل هذا في سجل التدقيق باسمك.`,
    adminOnly: "تغيير الصلاحيات للمدير فقط",
    changeFailed: "تعذر تغيير الصلاحية",
    all: "الكل",
    searchPlaceholder: "بحث بالاسم أو الرقم",
    userCount: (n: string) => `${n} مستخدم`,
    thUser: "المستخدم",
    thRole: "الصلاحية",
    thBookings: "حجوزات",
    thSpend: "إنفاق",
    thSince: "منذ",
    noResults: "لا نتائج",
    team: "فريق التشغيل",
    teamBody:
      "كل من يحمل صلاحية دخول هذا النظام، وحالة حسابه. الدعوة ترسل رابطًا لمرة واحدة يختار منه كلمة سرّه — لا أحد في تشاو يعرف كلمة سر أحد.",
    thState: "الحساب",
    stActive: "نشط",
    stLocked: "موقوف مؤقتًا",
    stMustChange: "ينتظر تغيير كلمة السر",
    stInvited: "دعوة مرسلة",
    stNone: "بلا كلمة سر",
    lastLogin: (d: string) => `آخر دخول ${d}`,
    invite: "أرسل رابط كلمة السر",
    reinvite: "أعد إرسال الرابط",
    invited: "أُرسل الرابط ✅",
    inviteFailed: "تعذر إرسال الدعوة",
    copyLink: "انسخ الرابط",
    copied: "نُسخ ✅",
    privacyNote:
      "لا تُعرض أسماء المستخدمين كاملة في أي شاشة عامة — العلن يرى الأحرف الأولى فقط (§11.5). هذه الشاشة داخلية ومحمية بالصلاحيات، وكل تغيير صلاحية يُسجَّل باسم من نفّذه.",
  },
  en: {
    loadFailed: "Could not load the users",
    arrow: "→",
    confirmRole: (label: string) =>
      `Change this role?\n${label}\n\nIt goes into the audit trail under your name.`,
    adminOnly: "Only an admin can change roles",
    changeFailed: "Could not change the role",
    all: "All",
    searchPlaceholder: "Search by name or number",
    userCount: (n: string) => `${n} users`,
    thUser: "User",
    thRole: "Role",
    thBookings: "Bookings",
    thSpend: "Spend",
    thSince: "Since",
    noResults: "No results",
    team: "The console team",
    teamBody:
      "Everyone who can sign in to this system, and the state of their account. An invite sends a one-time link they choose their own password from — nobody at Ciao knows anyone's password.",
    thState: "Account",
    stActive: "Active",
    stLocked: "Temporarily locked",
    stMustChange: "Must change password",
    stInvited: "Invite sent",
    stNone: "No password yet",
    lastLogin: (d: string) => `Last sign-in ${d}`,
    invite: "Send set-password link",
    reinvite: "Re-send the link",
    invited: "Link sent ✅",
    inviteFailed: "Could not send the invite",
    copyLink: "Copy link",
    copied: "Copied ✅",
    privacyNote:
      "Full user names are never shown on a public screen — the public sees initials only (§11.5). This screen is internal and permission-gated, and every role change is recorded against the name of whoever made it.",
  },
} satisfies Record<Locale, unknown>;

/**
 * The console team roster: who can open this system, and whether their
 * credential is healthy. Sits above the full user table because "who can get
 * in here" is the question this screen exists to answer first — and because an
 * invite that is quietly never accepted is the sort of loose credential this
 * panel makes visible.
 */
function TeamSection({ isAdmin, note }: { isAdmin: boolean; note: (m: string) => void }) {
  const locale = useLocale();
  const c = copy[locale];
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [busy, setBusy] = useState("");
  const [link, setLink] = useState<{ userId: string; url: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ items: TeamMember[] }>("/v1/biz/team");
      setTeam(res.items);
    } catch {
      /* the roster is people-gated; finance simply doesn't see it */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function invite(m: TeamMember) {
    setBusy(m.id);
    try {
      const res = await api<{ ok: boolean; link: string }>(`/v1/biz/team/${m.id}/invite`, {
        method: "POST",
        body: JSON.stringify({ send: true }),
      });
      // Shown once so an admin on the phone with a colleague can paste it into
      // WhatsApp themselves if the messaging channel is being slow.
      setLink({ userId: m.id, url: res.link });
      note(c.invited);
      await load();
    } catch {
      note(c.inviteFailed);
    } finally {
      setBusy("");
    }
  }

  function stateOf(m: TeamMember): { label: string; tone: "sand" | "amber" | "green" } {
    if (m.lockedUntil) return { label: c.stLocked, tone: "amber" };
    if (!m.hasPassword)
      return m.inviteOutstanding
        ? { label: c.stInvited, tone: "amber" }
        : { label: c.stNone, tone: "sand" };
    if (m.mustChange) return { label: c.stMustChange, tone: "amber" };
    return { label: c.stActive, tone: "green" };
  }

  if (team.length === 0) return null;

  return (
    <div className="card p-4 mb-4">
      <p className="font-bold text-sea">{c.team}</p>
      <p className="text-xs text-faint mt-1 mb-3">{c.teamBody}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-sand/60 text-muted">
            <tr>
              <th className="text-start p-2">{c.thUser}</th>
              <th className="text-start p-2">{c.thRole}</th>
              <th className="text-start p-2">{c.thState}</th>
              {isAdmin ? <th className="text-start p-2" /> : null}
            </tr>
          </thead>
          <tbody>
            {team.map((m) => {
              const st = stateOf(m);
              return (
                <tr key={m.id} className="border-t border-sand">
                  <td className="p-2">
                    <div className="font-bold text-sea">{m.displayName ?? "—"}</div>
                    <div className="text-[11px] text-faint" dir="ltr">{m.phone}</div>
                  </td>
                  <td className="p-2">
                    <Pill tone={m.role === "admin" ? "amber" : "sand"}>
                      {term(ROLES, locale, m.role)}
                    </Pill>
                  </td>
                  <td className="p-2">
                    <Pill tone={st.tone}>{st.label}</Pill>
                    {m.lastLoginAt ? (
                      <div className="text-[11px] text-faint mt-0.5">
                        {c.lastLogin(
                          fmtDate(locale, m.lastLoginAt, { day: "2-digit", month: "2-digit" }),
                        )}
                      </div>
                    ) : null}
                  </td>
                  {isAdmin ? (
                    <td className="p-2">
                      <button
                        className="chip !text-[11px]"
                        disabled={busy === m.id}
                        onClick={() => invite(m)}
                      >
                        {m.hasPassword || m.inviteOutstanding ? c.reinvite : c.invite}
                      </button>
                      {link?.userId === m.id ? (
                        <button
                          className="chip !text-[11px] ms-1"
                          onClick={() => {
                            void navigator.clipboard?.writeText(link.url).then(() => note(c.copied));
                          }}
                        >
                          {c.copyLink}
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function PeopleTab({ isAdmin }: { isAdmin: boolean }) {
  const locale = useLocale();
  const c = copy[locale];
  const [items, setItems] = useState<BizUser[]>([]);
  const [total, setTotal] = useState(0);
  const [role, setRole] = useState("all");
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const q = new URLSearchParams({ role, limit: "100" });
    if (search) q.set("search", search);
    try {
      const res = await api<{ total: number; items: BizUser[] }>(`/v1/biz/users?${q}`);
      setItems(res.items);
      setTotal(res.total);
    } catch {
      setMsg(c.loadFailed);
    }
  }, [role, search, c]);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeRole(u: BizUser, next: string) {
    if (next === u.role) return;
    const label = `${u.displayName ?? u.phone}: ${term(ROLES, locale, u.role)} ${c.arrow} ${term(
      ROLES,
      locale,
      next,
    )}`;
    if (!window.confirm(c.confirmRole(label))) return;
    try {
      await api(`/v1/biz/users/${u.id}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role: next }),
      });
      setMsg(`✅ ${label}`);
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError && e.status === 403 ? c.adminOnly : c.changeFailed);
    }
  }

  return (
    <div>
      <TeamSection isAdmin={isAdmin} note={setMsg} />

      <div className="flex flex-wrap items-center gap-2 mb-3">
        {["all", ...ROLE_KEYS].map((r) => (
          <button
            key={r}
            onClick={() => setRole(r)}
            className={`chip ${role === r ? "!bg-sea !text-white" : ""}`}
          >
            {r === "all" ? c.all : term(ROLES, locale, r)}
          </button>
        ))}
        <input
          className="input !py-1.5 !text-sm max-w-[220px]"
          placeholder={c.searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="text-xs text-faint">{c.userCount(fmtNum(locale, total))}</span>
      </div>

      {msg ? <p className="mb-3 text-sm font-bold text-sea">{msg}</p> : null}

      <div className="card overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-sand/60 text-muted">
            <tr>
              <th className="text-start p-2">{c.thUser}</th>
              <th className="text-start p-2">{c.thRole}</th>
              <th className="text-start p-2">{c.thBookings}</th>
              <th className="text-start p-2">{c.thSpend}</th>
              <th className="text-start p-2">{c.thSince}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((u) => (
              <tr key={u.id} className="border-t border-sand">
                <td className="p-2">
                  <div className="font-bold text-sea">{u.displayName ?? "—"}</div>
                  <div className="text-[11px] text-faint" dir="ltr">{u.phone}</div>
                </td>
                <td className="p-2">
                  {isAdmin ? (
                    <select
                      className="chip !text-[11px] !py-0.5"
                      value={u.role}
                      onChange={(e) => changeRole(u, e.target.value)}
                    >
                      {ROLE_KEYS.map((k) => (
                        <option key={k} value={k}>{term(ROLES, locale, k)}</option>
                      ))}
                    </select>
                  ) : (
                    <Pill tone={u.role === "admin" || u.role === "ops" ? "amber" : "sand"}>
                      {term(ROLES, locale, u.role)}
                    </Pill>
                  )}
                </td>
                <td className="p-2 tabular-nums">{u.bookings}</td>
                <td className="p-2">
                  <Money dirhams={u.gmv} />
                </td>
                <td className="p-2 text-faint" dir="ltr">
                  {fmtDate(locale, u.createdAt, {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  })}
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td className="p-4 text-faint" colSpan={5}>
                  {c.noResults}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-faint mt-3 leading-relaxed">{c.privacyNote}</p>
    </div>
  );
}
