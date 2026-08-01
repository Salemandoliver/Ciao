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
import { Money, Pill, ROLE_AR } from "./lib";

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

export function PeopleTab({ isAdmin }: { isAdmin: boolean }) {
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
      setMsg("تعذر تحميل المستخدمين");
    }
  }, [role, search]);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeRole(u: BizUser, next: string) {
    if (next === u.role) return;
    const label = `${u.displayName ?? u.phone}: ${ROLE_AR[u.role]} ← ${ROLE_AR[next]}`;
    if (!window.confirm(`تأكيد تغيير الصلاحية؟\n${label}\n\nسيُسجَّل هذا في سجل التدقيق باسمك.`))
      return;
    try {
      await api(`/v1/biz/users/${u.id}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role: next }),
      });
      setMsg(`✅ ${label}`);
      await load();
    } catch (e) {
      setMsg(
        e instanceof ApiError && e.status === 403
          ? "تغيير الصلاحيات للمدير فقط"
          : "تعذر تغيير الصلاحية",
      );
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {["all", "guest", "host", "agent", "ops", "admin"].map((r) => (
          <button
            key={r}
            onClick={() => setRole(r)}
            className={`chip ${role === r ? "!bg-sea !text-white" : ""}`}
          >
            {r === "all" ? "الكل" : ROLE_AR[r]}
          </button>
        ))}
        <input
          className="input !py-1.5 !text-sm max-w-[220px]"
          placeholder="بحث بالاسم أو الرقم"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="text-xs text-sea/55">{total} مستخدم</span>
      </div>

      {msg ? <p className="mb-3 text-sm font-bold text-sea">{msg}</p> : null}

      <div className="card overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-sand/60 text-sea/70">
            <tr>
              <th className="text-start p-2">المستخدم</th>
              <th className="text-start p-2">الصلاحية</th>
              <th className="text-start p-2">حجوزات</th>
              <th className="text-start p-2">إنفاق</th>
              <th className="text-start p-2">منذ</th>
            </tr>
          </thead>
          <tbody>
            {items.map((u) => (
              <tr key={u.id} className="border-t border-sand">
                <td className="p-2">
                  <div className="font-bold text-sea">{u.displayName ?? "—"}</div>
                  <div className="text-[11px] text-sea/55" dir="ltr">{u.phone}</div>
                </td>
                <td className="p-2">
                  {isAdmin ? (
                    <select
                      className="chip !text-[11px] !py-0.5"
                      value={u.role}
                      onChange={(e) => changeRole(u, e.target.value)}
                    >
                      {Object.entries(ROLE_AR).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  ) : (
                    <Pill tone={u.role === "admin" || u.role === "ops" ? "amber" : "sand"}>
                      {ROLE_AR[u.role] ?? u.role}
                    </Pill>
                  )}
                </td>
                <td className="p-2 tabular-nums">{u.bookings}</td>
                <td className="p-2">
                  <Money dirhams={u.gmv} />
                </td>
                <td className="p-2 text-sea/55" dir="ltr">
                  {new Date(u.createdAt).toLocaleDateString("ar-LY")}
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td className="p-4 text-sea/50" colSpan={5}>
                  لا نتائج
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-sea/45 mt-3 leading-relaxed">
        لا تُعرض أسماء المستخدمين كاملة في أي شاشة عامة — العلن يرى الأحرف الأولى فقط (§11.5).
        هذه الشاشة داخلية ومحمية بالصلاحيات، وكل تغيير صلاحية يُسجَّل باسم من نفّذه.
      </p>
    </div>
  );
}
