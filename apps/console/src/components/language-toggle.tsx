"use client";
/**
 * The language toggle.
 *
 * Deliberately a plain link, not a menu behind an icon: on a first visit the
 * whole point is that someone who cannot read the current language can find it
 * without reading anything. Each label is written in its own script — العربية
 * and English — so it is legible to the person who needs it, and it navigates
 * to the same page in the other language rather than to the home page, because
 * being thrown back to the start is how people learn not to press it.
 *
 * The choice is remembered locally straight away and pushed to the account
 * when there is one, so it survives to the next device.
 */
import { useEffect } from "react";
import NextLink from "next/link";
import { useLocale, useBarePath } from "@/lib/locale";
import { localePath, type Locale } from "@/lib/i18n";

const LOCALE_KEY = "ciao_locale";

/** Remember the active locale so the next bare visit can honour it. */
export function useRememberLocale() {
  const locale = useLocale();
  useEffect(() => {
    try {
      localStorage.setItem(LOCALE_KEY, locale);
    } catch {
      /* private mode — the URL still carries the language */
    }
  }, [locale]);
}

export function LanguageToggle({ className = "" }: { className?: string }) {
  const locale = useLocale();
  const bare = useBarePath();
  const other: Locale = locale === "ar" ? "en" : "ar";
  const label = other === "ar" ? "العربية" : "English";

  return (
    <NextLink
      href={localePath(bare, other)}
      hrefLang={other}
      lang={other}
      aria-label={other === "ar" ? "التبديل إلى العربية" : "Switch to English"}
      className={`text-sm font-bold text-sea ${className}`}
      onClick={() => {
        try {
          localStorage.setItem(LOCALE_KEY, other);
        } catch {
          /* ignore */
        }
        /*
         * No server write here, unlike the marketplace's toggle. Language on
         * this app is a device preference: a partner reading English and a
         * member of staff reading Arabic share one business, and syncing one
         * person's choice onto the business would flip the other's console.
         */
      }}
    >
      {label}
    </NextLink>
  );
}
