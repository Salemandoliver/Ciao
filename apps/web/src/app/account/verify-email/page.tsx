"use client";
/**
 * Email verification landing.
 *
 * Deliberately does its own work rather than asking the user to press
 * something: they already pressed the link in their mail. The only decision
 * left is where to go next.
 */
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Logo } from "@/components/logo";
import { api, ensureSession } from "@/lib/api";

function Verify() {
  const params = useSearchParams();
  const [state, setState] = useState<"working" | "done" | "failed">("working");
  const [points, setPoints] = useState(0);

  useEffect(() => {
    const token = params.get("token");
    if (!token) return setState("failed");
    ensureSession()
      .then(() =>
        api<{ pointsEarned: number }>("/v1/me/email/verify", {
          method: "POST",
          body: JSON.stringify({ token }),
        }),
      )
      .then((r) => {
        setPoints(r.pointsEarned);
        setState("done");
      })
      .catch(() => setState("failed"));
  }, [params]);

  return (
    <main className="mx-auto max-w-md px-4 py-10 text-center">
      <Link href="/" className="inline-block mb-6">
        <Logo size={44} />
      </Link>
      <div className="card p-6">
        {state === "working" ? (
          <p className="text-sea/70">جارٍ توثيق بريدك…</p>
        ) : state === "done" ? (
          <>
            <p className="font-bold text-sea text-lg">تم توثيق بريدك ✅</p>
            {points > 0 ? (
              <p className="text-sm text-sea/70 mt-2">كسبت {points} نقطة.</p>
            ) : null}
            <Link href="/account" className="btn-primary !py-2 !text-sm inline-block mt-4">
              افتح حسابك
            </Link>
          </>
        ) : (
          <>
            <p className="font-bold text-sea">الرابط منتهي أو مستخدم من قبل</p>
            <p className="text-sm text-sea/70 mt-2">
              افتح إعدادات حسابك واطلب رابط توثيق جديدًا.
            </p>
            <Link href="/account?tab=settings" className="btn-primary !py-2 !text-sm inline-block mt-4">
              إعدادات الحساب
            </Link>
          </>
        )}
      </div>
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sea/60">…</p>}>
      <Verify />
    </Suspense>
  );
}
