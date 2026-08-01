"use client";
/**
 * Email verification landing.
 *
 * Deliberately does its own work rather than asking the user to press
 * something: they already pressed the link in their mail. The only decision
 * left is where to go next.
 */
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Link, useLocale } from "@/lib/locale";
import { Logo } from "@/components/logo";
import { api, ensureSession } from "@/lib/api";
import { fmtNum } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";

const copy = {
  ar: {
    working: "جارٍ توثيق بريدك…",
    done: "تم توثيق بريدك ✅",
    earned: (pts: string) => `كسبت ${pts} نقطة.`,
    openAccount: "افتح حسابك",
    failedTitle: "الرابط منتهي أو مستخدم من قبل",
    failedBody: "افتح إعدادات حسابك واطلب رابط توثيق جديدًا.",
    settings: "إعدادات الحساب",
  },
  en: {
    working: "Verifying your email…",
    done: "Your email is verified ✅",
    earned: (pts: string) => `You earned ${pts} points.`,
    openAccount: "Open your account",
    failedTitle: "That link has expired or has already been used",
    failedBody: "Open your account preferences and ask for a fresh verification link.",
    settings: "Account preferences",
  },
} satisfies Record<Locale, unknown>;

function Verify() {
  const locale = useLocale();
  const c = copy[locale];
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
        <Logo />
      </Link>
      <div className="card p-6">
        {state === "working" ? (
          <p className="text-muted">{c.working}</p>
        ) : state === "done" ? (
          <>
            <p className="font-bold text-sea text-lg">{c.done}</p>
            {points > 0 ? (
              <p className="text-sm text-muted mt-2">{c.earned(fmtNum(locale, points))}</p>
            ) : null}
            <Link href="/account" className="btn-primary !py-2 !text-sm inline-block mt-4">
              {c.openAccount}
            </Link>
          </>
        ) : (
          <>
            <p className="font-bold text-sea">{c.failedTitle}</p>
            <p className="text-sm text-muted mt-2">{c.failedBody}</p>
            <Link
              href="/account?tab=settings"
              className="btn-primary !py-2 !text-sm inline-block mt-4"
            >
              {c.settings}
            </Link>
          </>
        )}
      </div>
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<p className="p-6 text-faint">…</p>}>
      <Verify />
    </Suspense>
  );
}
