"use client";
/**
 * The Plus teaser — an honest one.
 *
 * A locked panel is the most-hated pattern in software when it is done badly,
 * and the way it is done badly is always the same: hide something the user
 * already had, or blur a chart so they cannot tell whether it was worth
 * anything. Ciao's line is the opposite and it is a promise, not a paywall
 * placement — **your own numbers are always free; the market costs money.**
 *
 * So this component never covers up a partner's own data. It appears *beside*
 * it, says exactly what the paid thing would tell them, and gives a real
 * example sentence rather than a blurred rectangle. If the sentence is not
 * compelling, that is information: the honest response is to build something
 * better, not to blur harder.
 *
 * It renders nothing at all when Plus is already active, when the feature is
 * switched off in the control plane, or when the reader is not the person who
 * could buy it. A member of staff being advertised at about a subscription
 * they cannot purchase is noise in the middle of their working day.
 */
import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import type { PartnerMe } from "./types";

export function PlusTeaser({
  me,
  panel,
  titleAr,
  titleEn,
  bodyAr,
  bodyEn,
  onOpen,
}: {
  me: PartnerMe;
  /** Which placement this is — the console reports on them separately. */
  panel: string;
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
  /** Jump to the Plus tab. Omitted on the Plus tab itself. */
  onOpen?: () => void;
}) {
  const locale = useLocale();
  const scope = me.partnerId ? `?partnerId=${me.partnerId}` : "";
  const reported = useRef(false);

  const canBuy = me.capabilities.includes("admin");
  const show = me.plus.enabled && !me.plus.active && canBuy;

  useEffect(() => {
    if (!show || reported.current) return;
    reported.current = true;
    // Fire and forget. Whether a teaser was seen is worth knowing and is never
    // worth blocking a screen for, so a failure here is silently fine.
    void api(`/v1/partner/plus/teaser${scope}`, {
      method: "POST",
      body: JSON.stringify({ panel, action: "shown" }),
    }).catch(() => undefined);
  }, [show, scope, panel]);

  if (!show) return null;

  function open() {
    void api(`/v1/partner/plus/teaser${scope}`, {
      method: "POST",
      body: JSON.stringify({ panel, action: "clicked" }),
    }).catch(() => undefined);
    onOpen?.();
  }

  const title = locale === "en" ? titleEn : titleAr;
  const body = locale === "en" ? bodyEn : bodyAr;

  return (
    /*
     * A plain card with a gold rule, not the warn tone.
     *
     * `tone-warn` is the language of "something needs your attention" — an
     * overdue balance, a password somebody else knows. Borrowing it to sell a
     * subscription teaches a partner to distrust the colour, which is
     * expensive because the real warnings are about money. The gold rule says
     * "this is Plus" without shouting, and it also fixes a contrast failure:
     * `--link` is calibrated against `surface` and `sand`, and on the warm
     * wash it landed at 4.17:1.
     */
    <section className="card p-4 mt-4 border-s-4 border-[color:rgb(var(--amber))]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-extrabold text-link">
            {locale === "en" ? "Ciao Plus" : "تشاو بلس"}
          </p>
          <h3 className="font-bold text-sea mt-0.5">{title}</h3>
          <p className="text-sm text-muted mt-1 leading-relaxed">{body}</p>
        </div>
      </div>
      {onOpen ? (
        <button className="btn-primary !py-2 !px-5 !text-sm mt-3" onClick={open}>
          {locale === "en" ? "See what it costs" : "شوف كم يكلّف"}
        </button>
      ) : null}
    </section>
  );
}
