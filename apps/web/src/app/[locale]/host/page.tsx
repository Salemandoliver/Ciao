"use client";
/**
 * `/host` — kept alive as a doorway to the partner control panel.
 *
 * The old host screen has been replaced by `/partner`, which does everything
 * it did and holds the partner's whole diary rather than only Ciao's slice of
 * it. This path stays because it is in WhatsApp messages, in printed material
 * from field visits, and in the muscle memory of the hosts we onboarded first
 * — and a dead link is how one of them concludes the app broke.
 *
 * A client-side replace rather than a Next redirect so the locale prefix is
 * preserved: a host reading English who taps an old `/host` link should not be
 * dropped into the Arabic console.
 */
import { useEffect } from "react";
import { useLocale, useRouter } from "@/lib/locale";
import type { Locale } from "@/lib/i18n";

const copy = {
  ar: { moving: "لوحة الشركاء صارت هنا — جارٍ التحويل…" },
  en: { moving: "The partner panel has moved — taking you there…" },
} satisfies Record<Locale, unknown>;

export default function HostRedirect() {
  const locale = useLocale();
  const router = useRouter();

  useEffect(() => {
    router.replace("/partner");
  }, [router]);

  return <p className="p-6 text-faint">{copy[locale].moving}</p>;
}
