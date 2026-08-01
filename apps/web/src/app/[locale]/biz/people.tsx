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

const ROLE_KEYS = ["guest", "host", "agent", "ops", "admin"];

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
    privacyNote:
      "Full user names are never shown on a public screen — the public sees initials only (§11.5). This screen is internal and permission-gated, and every role change is recorded against the name of whoever made it.",
  },
} satisfies Record<Locale, unknown>;

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
