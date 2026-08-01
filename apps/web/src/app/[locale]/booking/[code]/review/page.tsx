"use client";
import { use, useEffect, useState } from "react";
import { Link, useLocale, useRouter } from "@/lib/locale";
import { Logo } from "@/components/logo";
import { api, ensureSession, ApiError } from "@/lib/api";
import { REVIEW_DIMENSIONS, term } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";
import type { BookingDetail } from "@/lib/types";

/** Scored in this order every time, so the form is muscle memory (§8.8). */
const DIMENSIONS = ["cleanliness", "accuracy", "privacy", "communication", "value"];

const copy = {
  ar: {
    title: "قيّم إقامتك",
    blindNote: "تقييمك لا يظهر للمضيف حتى يقيّم هو أيضًا (أو بعد ٧ أيام) — قيّم بصراحة.",
    placeholder: "احكِ تجربتك (اختياري) — بدون ذكر عناوين خاصة",
    submit: "أرسل التقييم",
    failed: "تعذر إرسال التقييم",
    stars: (label: string, n: number) => `${label}: ${n}`,
  },
  en: {
    title: "Rate your stay",
    blindNote:
      "The host does not see your review until they have written theirs (or after 7 days) — so say what you actually think.",
    placeholder: "Tell us how it went (optional) — please leave out private addresses",
    submit: "Send review",
    failed: "Could not send your review",
    stars: (label: string, n: number) => `${label}: ${n} out of 5`,
  },
} satisfies Record<Locale, unknown>;

export default function ReviewPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const locale = useLocale();
  const c = copy[locale];
  const router = useRouter();
  const [bookingId, setBookingId] = useState("");
  const [scores, setScores] = useState<Record<string, number>>({});
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    ensureSession().then(async (ok) => {
      // Bare path: the router adds the language, and the login page adds it
      // again when it sends the reader back here.
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
      setError(e instanceof ApiError ? e.message : c.failed);
    } finally {
      setBusy(false);
    }
  }

  const complete = DIMENSIONS.every((k) => scores[k]);

  return (
    <main className="mx-auto max-w-xl px-4 pb-16">
      <header className="py-4">
        <Link href="/"><Logo /></Link>
      </header>
      <div className="card p-5 space-y-4">
        <h1 className="font-bold text-xl text-sea">{c.title}</h1>
        <p className="text-sm text-faint">{c.blindNote}</p>
        {DIMENSIONS.map((key) => {
          const label = term(REVIEW_DIMENSIONS, locale, key);
          return (
            <div key={key}>
              <p className="font-bold text-sm mb-1">{label}</p>
              <div className="flex gap-1" dir="ltr">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => setScores((s) => ({ ...s, [key]: n }))}
                    className={`text-2xl ${((scores[key] ?? 0) >= n) ? "" : "opacity-25"}`}
                    aria-label={c.stars(label, n)}
                  >
                    ⭐
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        <textarea
          className="input min-h-24"
          placeholder={c.placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {error ? <p className="text-danger text-sm font-bold">{error}</p> : null}
        <button className="btn-primary w-full" disabled={!complete || busy || !bookingId} onClick={submit}>
          {c.submit}
        </button>
      </div>
    </main>
  );
}
