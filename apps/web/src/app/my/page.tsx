"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/logo";
import { api, ensureSession, fmtLyd } from "@/lib/api";

interface MyBooking {
  code: string;
  state: string;
  checkIn?: string;
  checkOut?: string;
  depositAmount: number;
  balanceOnArrival: number;
}

export default function MyBookingsPage() {
  const router = useRouter();
  const [items, setItems] = useState<MyBooking[] | null>(null);
  const [credit, setCredit] = useState(0);

  useEffect(() => {
    ensureSession().then(async (ok) => {
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
        <Link href="/"><Logo size={36} /></Link>
        {credit > 0 ? <span className="chip">🎁 رصيدك: {fmtLyd(credit)}</span> : null}
      </header>
      <h1 className="font-bold text-xl text-sea mb-4">حجوزاتي</h1>
      {items === null ? (
        <p className="text-faint">جارٍ التحميل…</p>
      ) : items.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="mb-4">لا حجوزات بعد.</p>
          <Link href="/search" className="btn-primary inline-block">ابدأ التصفح</Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((b) => (
            <li key={b.code}>
              <Link href={`/booking/${b.code}`} className="card p-4 flex justify-between items-center hover:shadow-md">
                <div>
                  <p className="font-inter font-bold" dir="ltr">{b.code}</p>
                  <p className="text-sm text-muted">
                    {b.checkIn} → {b.checkOut}
                  </p>
                </div>
                <span className="chip">{b.state}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
