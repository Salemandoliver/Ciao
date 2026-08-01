"use client";
/**
 * Audit trail — who changed what, and when.
 *
 * A console that can move money, publish listings and change commission rates
 * is only safe if every one of those actions leaves a name behind. This screen
 * is the answer to "who did this", and it is deliberately read-only: nothing
 * in the product can edit or delete an audit row.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Pill } from "./lib";

interface AuditRow {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: unknown;
  at: string;
  actor: string;
}

const ACTION_AR: Record<string, string> = {
  "settings.update": "تعديل إعداد",
  "settings.reset": "إعادة إعداد للافتراضي",
  "business.onboard": "إضافة نشاط",
  "listing.update": "تعديل إعلان",
  "listing.media": "تعديل صور",
  "user.role": "تغيير صلاحية",
  "dispute.resolve": "حل شكوى",
  "booking.transition": "تغيير حالة حجز",
  "booking.refund": "استرجاع",
  "venue.create": "إضافة مكان",
  "listing.create": "إنشاء إعلان",
  "verification.approve": "اعتماد معاينة",
};

const FILTERS: [string, string][] = [
  ["", "الكل"],
  ["settings", "الإعدادات"],
  ["listing", "الإعلانات"],
  ["business", "الأنشطة"],
  ["user", "الصلاحيات"],
  ["booking", "الحجوزات"],
  ["dispute", "الشكاوى"],
];

export function AuditTab() {
  const [items, setItems] = useState<AuditRow[]>([]);
  const [action, setAction] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const q = new URLSearchParams({ limit: "100" });
    if (action) q.set("action", action);
    try {
      setItems((await api<{ items: AuditRow[] }>(`/v1/biz/audit?${q}`)).items);
    } catch {
      setErr("تعذر تحميل السجل");
    }
  }, [action]);

  useEffect(() => {
    void load();
  }, [load]);

  if (err) return <p className="p-4 text-red-700 font-bold">{err}</p>;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {FILTERS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setAction(k)}
            className={`chip ${action === k ? "!bg-sea !text-white" : ""}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-sand/60 text-sea/70">
            <tr>
              <th className="text-start p-2">الإجراء</th>
              <th className="text-start p-2">المنفّذ</th>
              <th className="text-start p-2">الهدف</th>
              <th className="text-start p-2">التفاصيل</th>
              <th className="text-start p-2">الوقت</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-t border-sand align-top">
                <td className="p-2">
                  <Pill tone={r.action.startsWith("settings") ? "amber" : "sand"}>
                    {ACTION_AR[r.action] ?? r.action}
                  </Pill>
                </td>
                <td className="p-2 font-bold text-sea">{r.actor}</td>
                <td className="p-2 text-sea/60 font-mono text-[10px]">
                  {r.targetType ? `${r.targetType}:` : ""}
                  {r.targetId?.slice(0, 12) ?? "—"}
                </td>
                <td className="p-2 text-sea/70 max-w-[320px]">
                  <code className="text-[10px] break-all">
                    {r.detail ? JSON.stringify(r.detail).slice(0, 180) : "—"}
                  </code>
                </td>
                <td className="p-2 text-sea/55 whitespace-nowrap" dir="ltr">
                  {new Date(r.at).toLocaleString("ar-LY")}
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td className="p-4 text-sea/50" colSpan={5}>
                  لا سجلات
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-sea/45 mt-3">
        السجل للقراءة فقط — لا يوجد في المنظومة أي مسار يعدّل أو يحذف سطرًا منه.
      </p>
    </div>
  );
}
