"use client";
/**
 * Locale plumbing for the client tree.
 *
 * One provider sits in the root layout, so every client component below it —
 * including ones rendered inside server components — can read the current
 * locale without it being threaded through props. Server components take
 * `locale` from their route params instead; both end up reading the same
 * per-file `copy` objects.
 *
 * `Link` and `useRouter` are re-exported as locale-aware drop-ins rather than
 * new names on purpose: `<Link href="/search">` written anywhere in the app
 * keeps the reader in the language they are already reading, and nobody has to
 * remember a helper. Getting this wrong is the classic bilingual-site bug —
 * one stray link and an English visitor is silently dumped back into Arabic
 * mid-booking.
 */
import { createContext, useCallback, useContext, useMemo } from "react";
import NextLink from "next/link";
import { usePathname, useRouter as useNextRouter } from "next/navigation";
import { DEFAULT_LOCALE, localePath, stripLocale, type Locale } from "./i18n";
import { setApiLocale } from "./api";

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  /*
   * Set before first paint rather than in an effect: a fetch fired from a
   * component that mounts in the same commit would otherwise go out asking for
   * Arabic, and the user would see one stray Arabic error on an English page.
   */
  setApiLocale(locale);
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/** Pick this file's copy for the active locale. */
export function useCopy<T>(copy: Record<Locale, T>): T {
  return copy[useLocale()];
}

/** Prefix a path for the active locale. */
export function useHref(): (path: string) => string {
  const locale = useLocale();
  return useCallback((path: string) => localePath(path, locale), [locale]);
}

type LinkProps = Omit<React.ComponentProps<typeof NextLink>, "href"> & { href: string };

/** `next/link` that stays in the current language. */
export function Link({ href, ...rest }: LinkProps) {
  const locale = useLocale();
  return <NextLink href={localePath(href, locale)} {...rest} />;
}

/** `useRouter` whose `push`/`replace` stay in the current language. */
export function useRouter() {
  const router = useNextRouter();
  const locale = useLocale();
  return useMemo(
    () => ({
      ...router,
      push: (path: string, opts?: Parameters<typeof router.push>[1]) =>
        router.push(localePath(path, locale), opts),
      replace: (path: string, opts?: Parameters<typeof router.replace>[1]) =>
        router.replace(localePath(path, locale), opts),
    }),
    [router, locale],
  );
}

/**
 * The path the user is on, without its locale prefix — what the language
 * toggle needs so that switching language keeps you on the same page instead
 * of dropping you at the home page, which is the fastest way to make someone
 * stop using the toggle.
 */
export function useBarePath(): string {
  const pathname = usePathname() ?? "/";
  return stripLocale(pathname).path;
}
