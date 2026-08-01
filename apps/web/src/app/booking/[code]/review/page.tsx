"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/logo";
import { api, ensureSession, ApiError } from "@/lib/api";
import type { BookingDetail } from "@/lib/types";

const DIMENSIONS: [string, string][] = [
  ["cleanliness", "النظافة"],
  ["accuracy", "مطابقة الصور للواقع"],
  ["privacy", "الخصوصية والستر"],
  ["communication", "تواصل المضيف"],
  ["value", "القيمة مقابل السعر"],
];

export default function ReviewPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();
  const [bookingId, setBookingId] = useState("");
  const [scores, setScores] = useState<Record<string, number>>({});
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    ensureSession().then(async (ok) => {
      if (!ok) return router.push(`/login?next=/booking/${code}/review`);
      const b = await api<BookingDetail>(`/v1/bookings/${code}`);
      setBookingId(b.id);
    });
  }, [code, router]);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await api(`/v1/bookings/${bookingId}/reviews`, {
        method: "POST",
        body: JSON.stringify({ scores, text: text || undefined }),
      });
      router.push(`/booking/${code}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "تعذر إرسال التقييم");
    } finally {
      setBusy(false);
    }
  }

  const complete = DIMENSIONS.every(([k]) => scores[k]);

  return (
    <main className="mx-auto max-w-xl px-4 pb-16">
      <header className="py-4">
        <Link href="/"><Logo size={36} /></Link>
      </header>
      <div className="card p-5 space-y-4">
        <h1 className="font-bold text-xl text-sea">قيّم إقامتك</h1>
        <p className="text-sm text-faint">
          تقييمك لا يظهر للمضيف حتى يقيّم هو أيضًا (أو بعد ٧ أيام) — قيّم بصراحة.
        </p>
        {DIMENSIONS.map(([key, label]) => (
          <div key={key}>
            <p className="font-bold text-sm mb-1">{label}</p>
            <div className="flex gap-1" dir="ltr">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setScores((s) => ({ ...s, [key]: n }))}
                  className={`text-2xl ${((scores[key] ?? 0) >= n) ? "" : "opacity-25"}`}
                  aria-label={`${label}: ${n}`}
                >
                  ⭐
                </button>
              ))}
            </div>
          </div>
        ))}
        <textarea
          className="input min-h-24"
          placeholder="احكِ تجربتك (اختياري) — بدون ذكر عناوين خاصة"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {error ? <p className="text-danger text-sm font-bold">{error}</p> : null}
        <button className="btn-primary w-full" disabled={!complete || busy || !bookingId} onClick={submit}>
          أرسل التقييم
        </button>
      </div>
    </main>
  );
}
