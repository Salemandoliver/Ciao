"use client";
/**
 * The supply-side call to action, wired to the intelligence spine.
 *
 * A band nobody taps costs nothing, shows no error, and quietly explains why
 * the coast has forty chalets instead of four hundred — so it reports both
 * halves: that it was seen, and that it was used. `surface` distinguishes the
 * placements, because "the home band converts and the About one doesn't" is a
 * decision, and "hosts don't sign up" is a shrug.
 *
 * Impressions fire once per mount rather than on scroll-into-view. An
 * IntersectionObserver would be more precise and would also mean shipping an
 * observer to every guest on a 3G connection to measure a marketing block;
 * mounted-and-below-the-fold is close enough to answer the only question being
 * asked, which is comparative.
 */
import { useEffect, useRef } from "react";
import { PartnerBand } from "./brand";
import { useHref } from "@/lib/locale";
import { trackClient } from "@/lib/tracker";

export function SupplyBand({
  surface,
  eyebrow,
  headline,
  cta,
  href,
  external,
}: {
  surface: string;
  eyebrow: string;
  headline: string;
  cta: string;
  href: string;
  external?: boolean;
}) {
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    trackClient("supply.cta_shown", { surface });
  }, [surface]);

  /* An internal path has to keep the reader's language — a host reading the
     English site who lands on the Arabic supply page has been told, wordlessly,
     that this part of the product was not built for them. External links (the
     WhatsApp handoff) are passed through untouched. */
  const localise = useHref();

  return (
    <PartnerBand
      eyebrow={eyebrow}
      headline={headline}
      cta={cta}
      href={external ? href : localise(href)}
      external={external}
      onClick={() => trackClient("supply.cta_clicked", { surface })}
    />
  );
}
