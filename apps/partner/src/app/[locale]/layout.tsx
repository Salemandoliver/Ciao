import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { Almarai, Baloo_Bhaijaan_2, Inter } from "next/font/google";
import "../globals.css";
import { ThemeBoot, ThemeSync } from "@/components/theme-boot";
import { LocaleProvider } from "@/lib/locale";
import { LOCALES, bcp47, dirOf, isLocale } from "@/lib/i18n";

/**
 * Ciao Partners — a separate product on its own domain.
 *
 * The typography, tokens and locale routing are the marketplace's, because a
 * partner who signs in should recognise the same company. Everything else is
 * its own: its own manifest, so it installs to a home screen as a distinct app
 * with its own icon; its own origin, so its session cannot reach ciao.ly and a
 * guest's session cannot reach here; and `noindex`, because a business's diary
 * has no business in a search result.
 */
const almarai = Almarai({
  weight: ["400", "700", "800"],
  subsets: ["arabic"],
  variable: "--font-almarai",
  display: "swap",
});
const baloo = Baloo_Bhaijaan_2({
  weight: ["700", "800"],
  subsets: ["arabic"],
  variable: "--font-baloo",
  display: "swap",
});
const inter = Inter({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

const META = {
  ar: {
    title: "تشاو للشركاء",
    description: "كل حجوزاتك ومواعيدك وفلوسك في مكان واحد.",
  },
  en: {
    title: "Ciao Partners",
    description: "Your bookings, your diary and your money in one place.",
  },
} as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const l = isLocale(locale) ? locale : "ar";
  return {
    ...META[l],
    manifest: "/manifest.json",
    applicationName: META[l].title,
    // A business tool is not content. Keeping it out of search engines also
    // keeps a set-password link out of anyone's crawl log.
    robots: { index: false, follow: false, nocache: true },
    icons: { icon: "/icon-192.svg", apple: "/icon-192.svg" },
    appleWebApp: { capable: true, title: META[l].title, statusBarStyle: "default" },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1B4F72" },
    { media: "(prefers-color-scheme: dark)", color: "#0C1A24" },
  ],
  width: "device-width",
  initialScale: 1,
  // Not locked: a partner reading a quote's line items on a small screen has
  // every right to zoom in, and disabling that is an accessibility failure
  // dressed up as polish.
  maximumScale: 5,
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return (
    <html lang={bcp47(locale)} dir={dirOf(locale)} suppressHydrationWarning>
      <head>
        <ThemeBoot />
      </head>
      {/*
        The font variables live on <body>, not <html>. React owns every prop it
        renders, and putting a className on <html> silently wiped the `dark`
        class the boot script had set the moment a language switch re-rendered
        the root layout. Same trap, same fix as the marketplace.
      */}
      <body className={`${almarai.variable} ${baloo.variable} ${inter.variable} font-almarai`}>
        <LocaleProvider locale={locale}>
          <ThemeSync />
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
