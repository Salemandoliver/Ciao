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
import { useLocale } from "@/lib/locale";
import { fmtDate } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";
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

/** Filter prefixes, in the order the chips appear. */
const FILTER_KEYS = ["", "settings", "listing", "business", "user", "booking", "dispute"];

const copy = {
  ar: {
    actions: {
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
    } as Record<string, string>,
    filters: {
      "": "الكل",
      settings: "الإعدادات",
      listing: "الإعلانات",
      business: "الأنشطة",
      user: "الصلاحيات",
      booking: "الحجوزات",
      dispute: "الشكاوى",
    } as Record<string, string>,
    loadFailed: "تعذر تحميل السجل",
    thAction: "الإجراء",
    thActor: "المنفّذ",
    thTarget: "الهدف",
    thDetail: "التفاصيل",
    thTime: "الوقت",
    noRows: "لا سجلات",
    readOnlyNote: "السجل للقراءة فقط — لا يوجد في المنظومة أي مسار يعدّل أو يحذف سطرًا منه.",
  },
  en: {
    actions: {
      "settings.update": "Setting changed",
      "settings.reset": "Setting reset to default",
      "business.onboard": "Business onboarded",
      "listing.update": "Listing edited",
      "listing.media": "Listing photos changed",
      "user.role": "Role changed",
      "dispute.resolve": "Dispute resolved",
      "booking.transition": "Booking state changed",
      "booking.refund": "Refund",
      "venue.create": "Venue added",
      "listing.create": "Listing created",
      "verification.approve": "Inspection approved",
    } as Record<string, string>,
    filters: {
      "": "All",
      settings: "Settings",
      listing: "Listings",
      business: "Businesses",
      user: "Roles",
      booking: "Bookings",
      dispute: "Disputes",
    } as Record<string, string>,
    loadFailed: "Could not load the audit trail",
    thAction: "Action",
    thActor: "Actor",
    thTarget: "Target",
    thDetail: "Detail",
    thTime: "Time",
    noRows: "No entries",
    readOnlyNote:
      "The trail is read-only — there is no path anywhere in the system that edits or deletes a row of it.",
  },
} satisfies Record<Locale, unknown>;

export function AuditTab() {
  const locale = useLocale();
  const c = copy[locale];
  const [items, setItems] = useState<AuditRow[]>([]);
  const [action, setAction] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const q = new URLSearchParams({ limit: "100" });
    if (action) q.set("action", action);
    try {
      setItems((await api<{ items: AuditRow[] }>(`/v1/biz/audit?${q}`)).items);
    } catch {
      setErr(c.loadFailed);
    }
  }, [action, c]);

  useEffect(() => {
    void load();
  }, [load]);

  if (err) return <p className="p-4 text-danger font-bold">{err}</p>;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {FILTER_KEYS.map((k) => (
          <button
            key={k}
            onClick={() => setAction(k)}
            className={`chip ${action === k ? "!bg-sea !text-white" : ""}`}
          >
            {c.filters[k] ?? k}
          </button>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-sand/60 text-muted">
            <tr>
              <th className="text-start p-2">{c.thAction}</th>
              <th className="text-start p-2">{c.thActor}</th>
              <th className="text-start p-2">{c.thTarget}</th>
              <th className="text-start p-2">{c.thDetail}</th>
              <th className="text-start p-2">{c.thTime}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-t border-sand align-top">
                <td className="p-2">
                  <Pill tone={r.action.startsWith("settings") ? "amber" : "sand"}>
                    {c.actions[r.action] ?? r.action}
                  </Pill>
                </td>
                <td className="p-2 font-bold text-sea">{r.actor}</td>
                <td className="p-2 text-faint font-mono text-[10px]">
                  {r.targetType ? `${r.targetType}:` : ""}
                  {r.targetId?.slice(0, 12) ?? "—"}
                </td>
                <td className="p-2 text-muted max-w-[320px]">
                  <code className="text-[10px] break-all">
                    {r.detail ? JSON.stringify(r.detail).slice(0, 180) : "—"}
                  </code>
                </td>
                <td className="p-2 text-faint whitespace-nowrap" dir="ltr">
                  {fmtDate(locale, r.at, {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td className="p-4 text-faint" colSpan={5}>
                  {c.noRows}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-faint mt-3">{c.readOnlyNote}</p>
    </div>
  );
}
