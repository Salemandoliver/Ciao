import { Link } from "@/lib/locale";
import { Logo } from "@/components/logo";
import { asLocale, type Locale } from "@/lib/i18n";

const copy = {
  ar: {
    title: "لا يوجد اتصال حاليًا",
    body: "حجوزاتك وقسائمك المحفوظة ما زالت متاحة — وكل ما حفظته سيُرسل تلقائيًا عند عودة الشبكة.",
    cta: "حجوزاتي المحفوظة",
  },
  en: {
    title: "No connection right now",
    body: "Your saved bookings and vouchers are still here — and anything you saved will be sent automatically when the network comes back.",
    cta: "My saved bookings",
  },
} satisfies Record<Locale, unknown>;

/** Static offline fallback served by the service worker (§12.2). */
export default async function OfflinePage({ params }: { params: Promise<{ locale: string }> }) {
  const c = copy[asLocale((await params).locale)];
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center space-y-4">
      <Logo />
      <h1 className="font-bold text-xl text-sea">{c.title}</h1>
      <p className="text-muted">{c.body}</p>
      <Link href="/my" className="btn-primary inline-block">
        {c.cta}
      </Link>
    </main>
  );
}
