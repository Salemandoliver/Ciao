import Link from "next/link";
import { Logo } from "@/components/logo";

/** Static offline fallback served by the service worker (§12.2). */
export default function OfflinePage() {
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center space-y-4">
      <Logo size={48} />
      <h1 className="font-bold text-xl text-sea">لا يوجد اتصال حاليًا</h1>
      <p className="text-sea/70">
        حجوزاتك وقسائمك المحفوظة ما زالت متاحة — وكل ما حفظته سيُرسل تلقائيًا عند
        عودة الشبكة.
      </p>
      <Link href="/my" className="btn-primary inline-block">
        حجوزاتي المحفوظة
      </Link>
    </main>
  );
}
