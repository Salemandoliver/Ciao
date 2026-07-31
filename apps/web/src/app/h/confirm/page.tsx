"use client";
/**
 * Host one-tap confirmation — §9.4, §12.4.
 * Opens from a WhatsApp/SMS link with a signed single-use token.
 * No login required; must work on one bar of signal on a cheap phone.
 */
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Logo } from "@/components/logo";
import { API_URL } from "@/lib/api";

function ConfirmForm() {
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
        headers: { "Content-Type": "application/json" },
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
        setMessage(body.error?.message ?? "الرابط غير صالح أو انتهت مهلته");
      }
    } catch {
      setResult("error");
      setMessage("تعذر الاتصال — أعد المحاولة عند عودة الشبكة، حجزك محفوظ");
    } finally {
      setBusy(false);
    }
  }

  if (result === "confirmed")
    return (
      <div className="card p-8 text-center space-y-2">
        <p className="text-4xl">🎉</p>
        <h1 className="font-bold text-xl text-sea">تم تأكيد الحجز {message}</h1>
        <p className="text-sea/70 text-sm">
          وصلت الضيف قسيمته وعنوانك. حصتك من العربون تُحوَّل بعد يوم من وصول الضيف.
        </p>
      </div>
    );
  if (result === "declined")
    return (
      <div className="card p-8 text-center space-y-2">
        <h1 className="font-bold text-xl text-sea">تم الرفض</h1>
        <p className="text-sea/70 text-sm">
          أبلغنا الضيف وأرجعنا عربونه. الرفض المتكرر يؤثر على ترتيبك في البحث.
        </p>
      </div>
    );
  if (result === "error")
    return (
      <div className="card p-8 text-center">
        <p className="font-bold text-red-700">{message}</p>
      </div>
    );

  return (
    <div className="card p-8 text-center space-y-4">
      <h1 className="font-bold text-xl text-sea">طلب حجز جديد</h1>
      <p className="text-sea/70 text-sm">
        العربون محجوز بالفعل من الضيف. أكّد لقفل التاريخ، أو ارفض ليرجع له عربونه.
      </p>
      <div className="flex gap-3 justify-center">
        <button className="btn-primary" disabled={busy || !token} onClick={() => respond("confirm")}>
          ✅ أكّد الحجز
        </button>
        <button
          className="rounded-bubble border-2 border-sea/30 px-6 py-3 font-bold text-sea"
          disabled={busy || !token}
          onClick={() => respond("decline")}
        >
          رفض
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
