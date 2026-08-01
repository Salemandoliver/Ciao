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
  const ring = tone === "warn" ? "tone-warn" : tone === "good" ? "tone-good" : "bg-surface";
  /*
   * On a toned panel the coloured wash lifts the background, and `faint` —
   * which is calibrated against `surface` and `sand` — drops just under the
   * readable threshold. The secondary ink is the right weight there.
   */
  const caption = tone === "normal" ? "text-faint" : "text-muted";
  return (
    <div className={`rounded-2xl p-3 shadow-sm ${ring}`}>
      <div className={`text-[11px] font-bold ${caption}`}>{label}</div>
      <div className="text-xl font-extrabold text-sea tabular-nums">{value}</div>
      {sub ? <div className={`text-[11px] mt-0.5 ${caption}`}>{sub}</div> : null}
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
  if (rows.length === 0) return <p className="text-sm text-faint">لا بيانات بعد</p>;
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-xs">
          <span className="w-32 shrink-0 truncate text-muted font-bold">{r.label}</span>
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
    green: "badge-success",
    red: "badge-danger",
    amber: "bg-amber/25 text-sea-dark dark:text-amber",
    slate: "bg-sea/10 text-muted",
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
