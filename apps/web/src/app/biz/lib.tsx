"use client";
/** Shared primitives for the Ciao Business console. */
import type { ReactNode } from "react";
import { fmtLyd } from "@/lib/api";

/** A headline number. Money is always shown in LYD, never raw dirhams. */
export function Stat({
  label,
  value,
  sub,
  tone = "normal",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "normal" | "warn" | "good";
}) {
  const ring =
    tone === "warn"
      ? "ring-1 ring-red-300 bg-red-50"
      : tone === "good"
        ? "ring-1 ring-emerald-300 bg-emerald-50"
        : "bg-white";
  return (
    <div className={`rounded-2xl p-3 shadow-sm ${ring}`}>
      <div className="text-[11px] font-bold text-sea/55">{label}</div>
      <div className="text-xl font-extrabold text-sea tabular-nums">{value}</div>
      {sub ? <div className="text-[11px] text-sea/60 mt-0.5">{sub}</div> : null}
    </div>
  );
}

export function Money({ dirhams }: { dirhams: number }) {
  return <span className="tabular-nums">{fmtLyd(dirhams)}</span>;
}

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card p-4 mt-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="font-bold text-sea">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * Single-measure horizontal bars. One measure per panel, magnitude in a single
 * hue, the value printed in ink rather than encoded in colour — and RTL-safe,
 * so the bars grow from the right like the text does.
 */
export function Bars({
  rows,
  format = (n: number) => String(n),
}: {
  rows: { label: string; value: number }[];
  format?: (n: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="text-sm text-sea/50">لا بيانات بعد</p>;
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-xs">
          <span className="w-32 shrink-0 truncate text-sea/70 font-bold">{r.label}</span>
          <span className="flex-1 h-3 rounded-full bg-sand overflow-hidden">
            <span
              className="block h-full bg-sea/70 rounded-full"
              style={{ width: `${(r.value / max) * 100}%` }}
            />
          </span>
          <span className="w-24 text-end tabular-nums text-sea font-bold shrink-0">
            {format(r.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Pill({ children, tone = "sand" }: { children: ReactNode; tone?: string }) {
  const tones: Record<string, string> = {
    sand: "bg-sand text-sea",
    green: "bg-emerald-100 text-emerald-800",
    red: "bg-red-100 text-red-800",
    amber: "bg-amber/25 text-sea-dark",
    slate: "bg-sea/10 text-sea/70",
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${tones[tone]}`}>
      {children}
    </span>
  );
}

export const STATUS_AR: Record<string, string> = {
  draft: "مسودة",
  live: "منشور",
  paused: "موقوف مؤقتًا",
  delisted: "مسحوب",
};

export const VERTICAL_AR: Record<string, string> = {
  coast: "شاليهات واستراحات",
  hall: "قاعات أفراح",
  service: "خدمات",
};

export const ROLE_AR: Record<string, string> = {
  guest: "ضيف",
  host: "مضيف",
  agent: "مندوب ميداني",
  ops: "عمليات",
  admin: "مدير",
};

export const ACCOUNT_AR: Record<string, string> = {
  platform_revenue: "إيرادات تشاو",
  guest_deposits_held: "عرابين محتجزة",
  host_payables: "مستحقات المضيفين",
  guest_credit: "رصيد الضيوف",
  refund_reserve: "احتياطي الاسترجاع",
};

export function accountLabel(account: string): string {
  if (ACCOUNT_AR[account]) return ACCOUNT_AR[account]!;
  if (account.startsWith("rail_settlement_pending:"))
    return `تحت التسوية · ${account.split(":")[1]}`;
  if (account.startsWith("guest_credit:")) return "رصيد ضيف";
  return account;
}
