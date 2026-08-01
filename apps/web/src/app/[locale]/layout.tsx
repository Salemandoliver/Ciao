import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { Almarai, Baloo_Bhaijaan_2, Inter } from "next/font/google";
import "../globals.css";
import { SwRegister } from "@/components/sw-register";
import { OfflineBanner } from "@/components/offline-banner";
import { PageViews } from "@/components/track";
import { AnnouncementBar } from "@/components/announcement";
import { ThemeBoot } from "@/components/theme-boot";
import { LocaleProvider } from "@/lib/locale";
import { LOCALES, bcp47, dirOf, isLocale } from "@/lib/i18n";

/**
 * Brand typography — §3.3: Almarai 400/700 on the critical path,
 * Baloo Bhaijaan 2 for celebratory headlines, Inter as Latin companion.
 * next/font self-hosts WOFF2 with font-display: swap.
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

/** Both locales are prerendered; neither is a second-class render path. */
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

const META = {
  ar: {
    title: "تشاو — احجز الساحل والمناسبات في ليبيا",
    description:
      "قول تشاو للحجز بالمكالمات: شاليهات وقاعات أفراح موثّقة ميدانيًا، احجز بعربون بسيط والباقي عند الوصول.",
  },
  en: {
    title: "Ciao — book Libya's coast and celebrations",
    description:
      "Beach chalets, estirahas and wedding halls we visit and verify ourselves. Book with a small deposit and pay the rest on arrival.",
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
    /*
     * Tell search engines the two versions are one page in two languages
     * rather than duplicate content, and which to serve to everyone else.
     * `x-default` points at Arabic: someone arriving at a Libyan marketplace
     * with no language signal should land in Arabic.
     */
    alternates: {
      languages: { "ar-LY": "/", "en-GB": "/en", "x-default": "/" },
    },
    openGraph: {
      ...META[l],
      siteName: "Ciao — تشاو",
      type: "website",
      locale: l === "ar" ? "ar_LY" : "en_GB",
      alternateLocale: l === "ar" ? "en_GB" : "ar_LY",
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#1B4F72",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // An unknown prefix is a 404, not a quiet fall back to Arabic — otherwise
  // /fr/anything renders the whole site and search engines index it twice more.
  if (!isLocale(locale)) notFound();

  return (
    <html
      lang={bcp47(locale)}
      dir={dirOf(locale)}
      className={`${almarai.variable} ${baloo.variable} ${inter.variable}`}
    >
      <head>
        <ThemeBoot />
      </head>
      {/*
        Arabic leads with Almarai; English leads with Inter but keeps Almarai in
        the stack, so a listing that has no English title yet still renders its
        Arabic in a face designed for Arabic rather than in a Latin font's
        fallback.
      */}
      <body className={`${locale === "ar" ? "font-almarai" : "font-inter"} min-h-dvh`}>
        <LocaleProvider locale={locale}>
          <OfflineBanner />
          <AnnouncementBar locale={locale} />
          <PageViews />
          {children}
          <SwRegister />
        </LocaleProvider>
      </body>
    </html>
  );
}
