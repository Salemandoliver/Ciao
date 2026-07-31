"use client";
/**
 * Booking tracker + voucher — §6.1 steps 4–7.
 * Offline-cached by the service worker (§12.2): the voucher (code, address,
 * host phone) must survive a blackout on arrival day.
 */
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { api, ensureSession, fmtLyd } from "@/lib/api";
import type { BookingDetail } from "@/lib/types";

const STATE_AR: Record<string, { label: string; tone: string; hint?: string }> = {
  payment_pending: {
    label: "بانتظار دفع العربون",
    tone: "bg-amber/20 text-amber-dark",
    hint: "حجزك محجوز مؤقتًا — أكمل الدفع لقفل التاريخ.",
  },
  payment_held: {
    label: "العربون مدفوع — بانتظار تأكيد المضيف",
    tone: "bg-sea/10 text-sea",
    hint: "أرسلنا للمضيف واتساب و SMS. لو ما ردّش في المهلة، عربونك يرجع كاملًا فورًا.",
  },
  confirmed: { label: "✅ الحجز مؤكد", tone: "bg-green-100 text-green-800" },
  pre_arrival_reconfirmed: { label: "✅ مؤكد — والمكان جاهز", tone: "bg-green-100 text-green-800" },
  checked_in: { label: "🏖 إقامة جارية", tone: "bg-sea/10 text-sea" },
  completed: { label: "اكتملت الإقامة — قيّم تجربتك", tone: "bg-sand text-sea" },
  reviewed: { label: "شكرًا على تقييمك!", tone: "bg-sand text-sea" },
  host_declined: {
    label: "اعتذر المضيف — العربون راجع كاملًا",
    tone: "bg-red-100 text-red-800",
  },
  host_timeout: {
    label: "انتهت مهلة المضيف — العربون راجع + هدية ٥٪",
    tone: "bg-red-100 text-red-800",
  },
  payment_failed: { label: "لم يكتمل الدفع", tone: "bg-red-100 text-red-800" },
  cancelled_by_guest: { label: "ألغيتَ الحجز", tone: "bg-sand text-sea/70" },
  cancelled_by_host: { label: "ألغى المضيف — تعويض كامل + رصيد", tone: "bg-red-100 text-red-800" },
  expired: { label: "انتهت صلاحية الطلب", tone: "bg-sand text-sea/70" },
};

export default function BookingPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [b, setB] = useState<BookingDetail | null>(null);
  const [err, setErr] = useState("");
  const [needLogin, setNeedLogin] = useState(false);

  const load = useCallback(async () => {
    if (!(await ensureSession())) {
      setNeedLogin(true);
      return;
    }
    try {
      setB(await api<BookingDetail>(`/v1/bookings/${code}`));
      setErr("");
    } catch {
      setErr("تعذر تحديث الحالة — تعرض آخر نسخة محفوظة");
    }
  }, [code]);

  useEffect(() => {
    load();
    const t = setInterval(load, 20_000); // countdown tracking (§6.1 step 4)
    return () => clearInterval(t);
  }, [load]);

  if (needLogin) {
    return (
      <Shell>
        <div className="card p-6 text-center space-y-3">
          <p>سجّل دخولك برقم هاتفك لعرض الحجز {code}</p>
          <Link href={`/login?next=/booking/${code}`} className="btn-primary inline-block">
            دخول
          </Link>
        </div>
      </Shell>
    );
  }

  if (!b) return <Shell><p className="text-center py-12 text-sea/60">جارٍ التحميل…</p></Shell>;

  const st = STATE_AR[b.state] ?? { label: b.state, tone: "bg-sand" };
  const showVoucher = ["confirmed", "pre_arrival_reconfirmed", "checked_in"].includes(b.state);

  return (
    <Shell>
      <div className="space-y-4">
        <div className={`card p-4 ${st.tone}`}>
          <p className="font-bold text-lg">{st.label}</p>
          {st.hint ? <p className="text-sm mt-1 opacity-80">{st.hint}</p> : null}
          {b.state === "payment_held" && b.confirmationDeadline ? (
            <Countdown deadline={b.confirmationDeadline} />
          ) : null}
        </div>

        {/* Voucher — cached offline, works at 2% battery on 3G (§12.1) */}
        <div className="card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="font-bold text-xl text-sea">{b.listing?.titleAr}</h1>
            <span className="font-inter font-bold text-lg tracking-wider bg-sea text-white rounded-lg px-3 py-1" dir="ltr">
              {b.code}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Info label="الوصول" value={b.checkIn ?? "-"} />
            <Info label="المغادرة" value={b.checkOut ?? "-"} />
            <Info label="العربون المدفوع" value={fmtLyd(b.depositAmount)} />
            <Info label="الباقي نقدًا عند الوصول" value={fmtLyd(b.balanceOnArrival)} />
          </div>

          {showVoucher && b.venue?.addressAr ? (
            <div className="rounded-xl bg-sand p-3 space-y-1">
              <p className="font-bold text-sea">📍 العنوان (ظهر بعد دفع العربون)</p>
              <p>{b.venue.addressAr}</p>
              {b.venue.hostPhone ? (
                <p dir="ltr" className="font-inter">
                  ☎ <a className="underline" href={`tel:${b.venue.hostPhone}`}>{b.venue.hostPhone}</a>
                  {" · "}
                  <a className="underline" href={`https://wa.me/${b.venue.hostPhone.replace("+", "")}`}>
                    WhatsApp
                  </a>
                </p>
              ) : null}
              {b.venue.exactLocation?.lat ? (
                <a
                  className="underline text-sea text-sm"
                  href={`https://maps.google.com/?q=${b.venue.exactLocation.lat},${b.venue.exactLocation.lng}`}
                >
                  افتح في الخرائط
                </a>
              ) : null}
            </div>
          ) : null}

          {b.state === "completed" ? (
            <Link href={`/booking/${b.code}/review`} className="btn-amber block text-center">
              ⭐ قيّم إقامتك (يفتح لك رصيد خصم)
            </Link>
          ) : null}
        </div>

        {/* Timeline */}
        <div className="card p-4">
          <h2 className="font-bold text-sea mb-2 text-sm">سجل الحجز</h2>
          <ol className="space-y-1 text-sm text-sea/70">
            {b.timeline.map((e) => (
              <li key={e.seq}>
                {new Date(e.at).toLocaleString("ar-LY", { timeZone: "Africa/Tripoli" })} —{" "}
                {STATE_AR[e.to]?.label ?? e.to}
              </li>
            ))}
          </ol>
        </div>

        {err ? <p className="text-amber-dark text-sm text-center">{err}</p> : null}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/"><Logo size={36} /></Link>
        <Link href="/my" className="text-sm font-bold text-sea">حجوزاتي</Link>
      </header>
      {children}
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sea/50 text-xs">{label}</p>
      <p className="font-bold">{value}</p>
    </div>
  );
}

function Countdown({ deadline }: { deadline: string }) {
  const [left, setLeft] = useState("");
  useEffect(() => {
    const update = () => {
      const ms = new Date(deadline).getTime() - Date.now();
      if (ms <= 0) {
        setLeft("انتهت المهلة — سيتم إرجاع عربونك تلقائيًا إن لم يؤكد المضيف");
        return;
      }
      const m = Math.floor(ms / 60000);
      setLeft(`متبقٍ للمضيف: ${Math.floor(m / 60)} س ${m % 60} د`);
    };
    update();
    const t = setInterval(update, 30_000);
    return () => clearInterval(t);
  }, [deadline]);
  return <p className="text-sm font-bold mt-1">{left}</p>;
}
