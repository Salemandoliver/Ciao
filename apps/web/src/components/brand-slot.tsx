"use client";
/**
 * The brand band, wired to the intelligence spine.
 *
 * `BrandBand` is presentation and is duplicated into Ciao Business so the
 * composer's preview cannot drift from the page. That copy must not carry
 * analytics — the console would then emit impressions for messages nobody
 * outside the building ever saw, and the one number this feature exists to
 * produce would be poisoned by the tool used to write it. So the tracking
 * lives out here, in the wrapper only the marketplace has.
 *
 * The two events bracket a decision rather than counting one. Impressions
 * alone cannot tell a message nobody read from a message everybody read and
 * ignored, and those two failures have opposite fixes: the first is placement,
 * the second is the words. The ratio can.
 */
import { useEffect, useRef } from "react";
import type { RenderedBrandMessage } from "@ciao/shared";
import { trackClient } from "@/lib/tracker";
import { BrandBand } from "./brand-band";

export function BrandSlot({
  message,
  messageId,
  standing,
  surface,
}: {
  message: RenderedBrandMessage;
  messageId: string;
  /** The shipped fallback, so the baseline separates from the campaigns. */
  standing: boolean;
  /** "home" | "search" — which placement earned it. */
  surface: string;
}) {
  const fired = useRef(false);
  useEffect(() => {
    /*
     * Once per mount, guarded.
     *
     * React runs effects twice in development's strict mode, and a band that
     * counted itself twice would make every campaign look half as effective as
     * the one measured before somebody turned strict mode on.
     */
    if (fired.current) return;
    fired.current = true;
    trackClient("brand.message_shown", { messageId, surface, standing });
  }, [messageId, surface, standing]);

  return (
    <BrandBand
      message={message}
      onCtaClick={() => trackClient("brand.message_clicked", { messageId, surface })}
    />
  );
}
