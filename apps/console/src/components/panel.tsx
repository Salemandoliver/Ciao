"use client";
/**
 * Panel primitives — the shared vocabulary of every dashboard surface in Ciao.
 *
 * These began life inside the business console. They live here now because the
 * partner control panel needs exactly the same shapes, and two copies of "how a
 * stat tile looks" is how a product ends up looking like two products. A
 * partner and an operator should recognise the same page furniture: the
 * headline number, the panel, the single-hue bar, the status pill.
 *
 * The chart conventions come from the dataviz method and are load-bearing, not
 * taste: one measure per panel, magnitude in a single hue, the value printed in
 * ink rather than encoded in colour, and RTL-safe so bars grow from the right
 * alongside the text.
 */
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
  hint,
  children,
}: {
  title: string;
  action?: ReactNode;
  /** One line explaining what the panel is for, where that isn't obvious. */
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card p-4 mt-4">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h2 className="font-bold text-sea">{title}</h2>
        {action}
      </div>
      {hint ? <p className="text-[11px] text-faint mb-3">{hint}</p> : <div className="mb-2" />}
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
  /**
   * `value` is the magnitude the bar draws. `display` overrides the printed
   * figure when the two genuinely differ — a monthly profit of −1,020 has no
   * magnitude to draw, so the bar sits empty while the number beside it still
   * reads −1,020. Without the split, clamping the bar to zero also printed
   * "0", which turns a loss-making month into a break-even one on the one
   * screen a partner would use to notice.
   */
  rows: { label: string; value: number; display?: string }[];
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
            {r.display ?? format(r.value)}
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
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${
        tones[tone] ?? tone
      }`}
    >
      {children}
    </span>
  );
}

/**
 * A value against a reference range — where a partner's price sits among their
 * peers, say.
 *
 * The quartile band is drawn as a track with a marker rather than as a bar,
 * because the question is not "how big" but "where in the pack", and a bar
 * chart answers the wrong one. The numbers are printed either side so the
 * picture is never the only carrier of the information.
 */
export function RangeMarker({
  p25,
  p50,
  p75,
  value,
  format,
}: {
  p25: number;
  p50: number;
  p75: number;
  value: number;
  format: (n: number) => string;
}) {
  const lo = Math.min(p25, value) * 0.9;
  const hi = Math.max(p75, value) * 1.1;
  const span = Math.max(1, hi - lo);
  const at = (n: number) => `${Math.min(100, Math.max(0, ((n - lo) / span) * 100))}%`;
  return (
    <div className="mt-1">
      <div className="relative h-6">
        <span className="absolute inset-x-0 top-2.5 h-1 rounded-full bg-sand" />
        <span
          className="absolute top-2.5 h-1 rounded-full bg-sea/40"
          style={{ insetInlineStart: at(p25), width: `calc(${at(p75)} - ${at(p25)})` }}
        />
        <span
          className="absolute top-1 h-4 w-0.5 bg-sea/70"
          style={{ insetInlineStart: at(p50) }}
          aria-hidden
        />
        {value > 0 ? (
          <span
            className="absolute top-0 h-6 w-1.5 rounded-full bg-amber ring-2 ring-[color:rgb(var(--surface))]"
            style={{ insetInlineStart: at(value) }}
            aria-hidden
          />
        ) : null}
      </div>
      <div className="flex justify-between text-[11px] text-faint tabular-nums">
        <span>{format(p25)}</span>
        <span className="font-bold text-muted">{format(p50)}</span>
        <span>{format(p75)}</span>
      </div>
    </div>
  );
}
