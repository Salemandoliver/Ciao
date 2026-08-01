"use client";
/** Shared primitives for the Ciao Business console. */
import type { ReactNode } from "react";
import { fmtLyd } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { UI, term } from "@/lib/vocab";

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
  const locale = useLocale();
  return <span className="tabular-nums">{fmtLyd(dirhams, locale)}</span>;
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
  const locale = useLocale();
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0)
    return <p className="text-sm text-faint">{term(UI, locale, "noData")}</p>;
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

/*
 * Listing status, verticals, roles and ledger accounts used to be duplicated
 * here as Arabic-only maps. They now live in `@/lib/vocab` alongside every
 * other shared term, in both languages: read them with
 * `term(LISTING_STATUS, locale, k)`, `term(VERTICALS, …)`, `term(ROLES, …)`
 * and `accountLabel(locale, account)`. A status that reads one way in the
 * console and another way in the guest app is how people stop trusting it.
 */
