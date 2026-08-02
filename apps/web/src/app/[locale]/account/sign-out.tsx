"use client";
/**
 * Signing out.
 *
 * Two options, because there are genuinely two situations. Clearing this
 * browser is the everyday one. "Sign out everywhere" is for the day someone
 * realises another person has been on their account — and here that is not an
 * edge case: a phone gets handed round a family, and one that is still signed
 * in is holding a wallet balance, an inbox and a host's address.
 *
 * The refresh token is revoked server-side, so a token copied off the device
 * dies with the session rather than living out its thirty days. But the local
 * clear happens whatever the network does: an API that is down must never be
 * able to trap someone in a session. When that happens we say so plainly
 * rather than showing a success tick we cannot honestly claim.
 */
import { useState } from "react";
import { useLocale, useRouter } from "@/lib/locale";
import { api, clearTokens } from "@/lib/api";
import { trackClient } from "@/lib/tracker";
import type { Locale } from "@/lib/i18n";

const copy = {
  ar: {
    title: "الخروج من الحساب",
    body: "تقدر ترجع تدخل في أي وقت برقمك أو ببصمتك — ما يضيع شيء من محفظتك ولا نقاطك.",
    signOut: "خروج من هذا الجهاز",
    everywhere: "خروج من كل الأجهزة",
    everywhereHint:
      "يقفل حسابك على كل جهاز دخلت منه — الهاتف القديم، جهاز أحد أفراد العائلة، أي متصفح. استعمله إذا شككت أن أحدًا غيرك يدخل حسابك.",
    offlineTitle: "خرجت من هذا الجهاز",
    offlineBody:
      "ما قدرنا نوصل الخادم، فما زال ممكنًا أن يكون حسابك مفتوحًا على أجهزة أخرى. حين ترجع الشبكة، ادخل واختر «خروج من كل الأجهزة».",
    goHome: "الرئيسية",
  },
  en: {
    title: "Sign out",
    body: "You can sign back in any time with your number or your fingerprint — nothing in your wallet or your points is lost.",
    signOut: "Sign out on this device",
    everywhere: "Sign out on all devices",
    everywhereHint:
      "Closes your account on every device you have signed in on — an old phone, a family member's, any browser. Use it if you think someone else has been on your account.",
    offlineTitle: "Signed out on this device",
    offlineBody:
      "We could not reach the server, so your account may still be open on other devices. When you are back online, sign in and choose “sign out on all devices”.",
    goHome: "Home",
  },
} satisfies Record<Locale, unknown>;

export function SignOutCard() {
  const locale = useLocale();
  const c = copy[locale];
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [stranded, setStranded] = useState(false);

  async function signOut(everywhere: boolean) {
    setBusy(true);
    let revoked = true;
    try {
      const refreshToken =
        typeof window !== "undefined" ? localStorage.getItem("ciao_refresh") : null;
      await api("/v1/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refreshToken: refreshToken ?? undefined, everywhere }),
      });
    } catch {
      // The server did not hear us. Local state is cleared anyway.
      revoked = false;
    } finally {
      // Order matters: clear before anything can re-read the token.
      clearTokens();
      setBusy(false);
    }

    if (revoked) {
      // The server emits `auth.signed_out` itself and is canonical for it, so
      // the client only reports the sign-outs the server never saw.
      router.push("/");
      return;
    }
    trackClient("auth.signed_out", { everywhere });
    setStranded(true);
  }

  if (stranded)
    return (
      <section className="card p-4">
        <h3 className="font-bold text-sea text-sm">{c.offlineTitle}</h3>
        <p className="text-xs text-muted mt-1 leading-relaxed">{c.offlineBody}</p>
        <button className="chip mt-3" onClick={() => router.push("/")}>
          {c.goHome}
        </button>
      </section>
    );

  return (
    <section className="card p-4">
      <h3 className="font-bold text-sea text-sm">{c.title}</h3>
      <p className="text-xs text-muted mt-1 leading-relaxed">{c.body}</p>
      <div className="flex flex-wrap gap-2 mt-3">
        <button className="chip" disabled={busy} onClick={() => void signOut(false)}>
          {c.signOut}
        </button>
        <button
          className="chip badge-danger"
          disabled={busy}
          onClick={() => void signOut(true)}
        >
          {c.everywhere}
        </button>
      </div>
      <p className="text-[11px] text-faint mt-2 leading-relaxed">{c.everywhereHint}</p>
    </section>
  );
}
