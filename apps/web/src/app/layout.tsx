import type { Metadata, Viewport } from "next";
import { Almarai, Baloo_Bhaijaan_2, Inter } from "next/font/google";
import "./globals.css";
import { SwRegister } from "@/components/sw-register";
import { OfflineBanner } from "@/components/offline-banner";
import { PageViews } from "@/components/track";

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

export const metadata: Metadata = {
  title: "تشاو — احجز الساحل والمناسبات في ليبيا",
  description:
    "قول تشاو للحجز بالمكالمات: شاليهات وقاعات أفراح موثّقة ميدانيًا، احجز بعربون بسيط والباقي عند الوصول.",
  manifest: "/manifest.json",
  openGraph: {
    siteName: "Ciao — تشاو",
    type: "website",
    locale: "ar_LY",
  },
};

export const viewport: Viewport = {
  themeColor: "#1B4F72",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${almarai.variable} ${baloo.variable} ${inter.variable}`}
    >
      <body className="font-almarai min-h-dvh">
        <OfflineBanner />
        <PageViews />
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
