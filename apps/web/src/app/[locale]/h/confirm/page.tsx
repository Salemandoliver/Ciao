"use client";
/**
 * Host one-tap confirmation — §9.4, §12.4.
 * Opens from a WhatsApp/SMS link with a signed single-use token.
 * No login required; must work on one bar of signal on a cheap phone.
 */
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Logo } from "@/components/logo";
import { useLocale } from "@/lib/locale";
import { API_URL, apiAcceptLanguage } from "@/lib/api";
import type { Locale } from "@/lib/i18n";

const copy = {
  ar: {
    badLink: "الرابط غير صالح أو انتهت مهلته",
    offline: "تعذر الاتصال — أعد المحاولة عند عودة الشبكة، حجزك محفوظ",
    confirmedTitle: (code: string) => `تم تأكيد الحجز ${code}`,
    confirmedBody: "وصلت الضيف قسيمته وعنوانك. حصتك من العربون تُحوَّل بعد يوم من وصول الضيف.",
    declinedTitle: "تم الرفض",
    declinedBody: "أبلغنا الضيف وأرجعنا عربونه. الرفض المتكرر يؤثر على ترتيبك في البحث.",
    requestTitle: "طلب حجز جديد",
    requestBody: "العربون محجوز بالفعل من الضيف. أكّد لقفل التاريخ، أو ارفض ليرجع له عربونه.",
    confirm: "✅ أكّد الحجز",
    decline: "رفض",
  },
  en: {
    badLink: "This link is not valid, or its time has run out",
    offline: "Could not connect — try again when the signal is back; the booking is safe",
    confirmedTitle: (code: string) => `Booking ${code} is confirmed`,
    confirmedBody:
      "The guest now has their voucher and your address. Your share of the deposit is transferred a day after they arrive.",
    declinedTitle: "Declined",
    declinedBody:
      "We have told the guest and returned their deposit. Declining often affects where you appear in search.",
    requestTitle: "New booking request",
    requestBody:
      "The guest has already paid the deposit. Confirm to lock the date, or decline and it goes back to them.",
    confirm: "✅ Confirm the booking",
    decline: "Decline",
  },
} satisfies Record<Locale, unknown>;

function ConfirmForm() {
  const c = copy[useLocale()];
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [result, setResult] = useState<"" | "confirmed" | "declined" | "error">("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function respond(decision: "confirm" | "decline") {
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/v1/actions/host-response`, {
        method: "POST",
        // Hand-rolled fetch (no session, no auth header), so the language the
        // server answers errors in has to be asked for explicitly — otherwise
        // an English page reports its one failure case in Arabic.
        headers: { "Content-Type": "application/json", "Accept-Language": apiAcceptLanguage() },
        body: JSON.stringify({ token, decision }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        code?: string;
        error?: { message: string };
      };
      if (res.ok) {
        setResult(decision === "confirm" ? "confirmed" : "declined");
        setMessage(body.code ?? "");
      } else {
        setResult("error");
        setMessage(body.error?.message ?? c.badLink);
      }
    } catch {
      setResult("error");
      setMessage(c.offline);
    } finally {
      setBusy(false);
    }
  }

  if (result === "confirmed")
    return (
      <div className="card p-8 text-center space-y-2">
        <p className="text-4xl">🎉</p>
        <h1 className="font-bold text-xl text-sea">{c.confirmedTitle(message)}</h1>
        <p className="text-muted text-sm">{c.confirmedBody}</p>
      </div>
    );
  if (result === "declined")
    return (
      <div className="card p-8 text-center space-y-2">
        <h1 className="font-bold text-xl text-sea">{c.declinedTitle}</h1>
        <p className="text-muted text-sm">{c.declinedBody}</p>
      </div>
    );
  if (result === "error")
    return (
      <div className="card p-8 text-center">
        <p className="font-bold text-danger">{message}</p>
      </div>
    );

  return (
    <div className="card p-8 text-center space-y-4">
      <h1 className="font-bold text-xl text-sea">{c.requestTitle}</h1>
      <p className="text-muted text-sm">{c.requestBody}</p>
      <div className="flex gap-3 justify-center">
        <button className="btn-primary" disabled={busy || !token} onClick={() => respond("confirm")}>
          {c.confirm}
        </button>
        <button
          className="rounded-bubble border-2 border-sea/30 px-6 py-3 font-bold text-sea"
          disabled={busy || !token}
          onClick={() => respond("decline")}
        >
          {c.decline}
        </button>
      </div>
    </div>
  );
}

export default function HostConfirmPage() {
  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <div className="text-center mb-6"><Logo size={44} /></div>
      <Suspense>
        <ConfirmForm />
      </Suspense>
    </main>
  );
}
