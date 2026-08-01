"use client";
import { useEffect, useState } from "react";
import { Link, useLocale, useRouter } from "@/lib/locale";
import { Logo } from "@/components/logo";
import { api, ensureSession, fmtLyd } from "@/lib/api";
import { BOOKING_STATUS, fmtDate, term } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";

interface MyBooking {
  code: string;
  state: string;
  checkIn?: string;
  checkOut?: string;
  depositAmount: number;
  balanceOnArrival: number;
}

const copy = {
  ar: {
    credit: (amount: string) => `🎁 رصيدك: ${amount}`,
    title: "حجوزاتي",
    loading: "جارٍ التحميل…",
    empty: "لا حجوزات بعد.",
    browse: "ابدأ التصفح",
    // The arrow follows the reading direction: in Arabic the later date sits
    // on the left, so the arrow that means "until" points left.
    rangeArrow: "←",
  },
  en: {
    credit: (amount: string) => `🎁 Your credit: ${amount}`,
    title: "My bookings",
    loading: "Loading…",
    empty: "No bookings yet.",
    browse: "Start browsing",
    rangeArrow: "→",
  },
} satisfies Record<Locale, unknown>;

export default function MyBookingsPage() {
  const locale = useLocale();
  const c = copy[locale];
  const router = useRouter();
  const [items, setItems] = useState<MyBooking[] | null>(null);
  const [credit, setCredit] = useState(0);

  useEffect(() => {
    ensureSession().then(async (ok) => {
      // Bare path: the router adds the language, and the login page adds it
      // again when it sends the reader back.
      if (!ok) return router.push("/login?next=/my");
      const [bookings, me] = await Promise.all([
        api<{ items: MyBooking[] }>("/v1/my/bookings"),
        api<{ creditBalance: number }>("/v1/me"),
      ]);
      setItems(bookings.items);
      setCredit(me.creditBalance);
    });
  }, [router]);

  return (
    <main className="mx-auto max-w-2xl px-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/"><Logo /></Link>
        {credit > 0 ? <span className="chip">{c.credit(fmtLyd(credit, locale))}</span> : null}
      </header>
      <h1 className="font-bold text-xl text-sea mb-4">{c.title}</h1>
      {items === null ? (
        <p className="text-faint">{c.loading}</p>
      ) : items.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="mb-4">{c.empty}</p>
          <Link href="/search" className="btn-primary inline-block">{c.browse}</Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((b) => (
            <li key={b.code}>
              <Link href={`/booking/${b.code}`} className="card p-4 flex justify-between items-center hover:shadow-md">
                <div>
                  <p className="font-inter font-bold" dir="ltr">{b.code}</p>
                  <p className="text-sm text-muted">
                    {b.checkIn
                      ? fmtDate(locale, b.checkIn, { day: "numeric", month: "short" })
                      : "—"}{" "}
                    {c.rangeArrow}{" "}
                    {b.checkOut
                      ? fmtDate(locale, b.checkOut, { day: "numeric", month: "short" })
                      : "—"}
                  </p>
                </div>
                {/* The same words as the booking page itself — a state that
                    changes name between two screens stops being believed. */}
                <span className="chip">{term(BOOKING_STATUS, locale, b.state)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
