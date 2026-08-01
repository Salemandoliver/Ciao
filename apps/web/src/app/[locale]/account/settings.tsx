"use client";
/**
 * Preferences — everything the user tells us on purpose.
 *
 * This screen is the intelligence layer's first privacy guardrail made
 * visible: enrichment must be declared input, never inference. Anything Ciao
 * knows about you that isn't your behaviour inside the app was typed here by
 * you, and can be untyped here too.
 *
 * Consent is split honestly: booking confirmations are service messages and
 * always send; offers are marketing and are off until asked for (Law 6/2022).
 */
import { useEffect, useState } from "react";
import NextLink from "next/link";
import { ApiError, api } from "@/lib/api";
import { useBarePath, useLocale } from "@/lib/locale";
import { localePath, LOCALES, type Locale } from "@/lib/i18n";
import { AREAS, PAYMENT_RAILS, term } from "@/lib/vocab";
import type { AccountData } from "./page";

/** The rails a guest can be defaulted to; labels live in the shared vocab. */
const RAILS = ["sadad", "adfali", "local_card", "tlync", "cash"];

const AREA_KEYS = ["janzour", "tajoura", "ain_zara", "airport_road"];

const THEMES = ["system", "light", "dark"];

/** Each language names itself, so it is legible to the person who needs it. */
const LANGUAGE_NAMES: Record<Locale, string> = { ar: "العربية", en: "English" };

const copy = {
  ar: {
    saveFailed: "تعذر الحفظ — حاول مرة أخرى",
    emailInUse: "هذا البريد مستخدم في حساب آخر",
    emailFailed: "تعذر حفظ البريد",
    exportFailed: "تعذر التصدير",
    langAndLook: "اللغة والمظهر",
    language: "اللغة",
    languageHint: "تنطبق فورًا على هذا الجهاز، وتتبعك إلى أي جهاز تدخل منه.",
    appearance: "المظهر",
    themes: { system: "حسب الجهاز", light: "فاتح", dark: "داكن" } as Record<string, string>,
    payment: "الدفع",
    paymentIntro: "نختار لك هذه الوسيلة تلقائيًا عند الحجز — تقدر تغيّرها في كل مرة.",
    paymentNote: "لا نحفظ أرقام بطاقتك أبدًا — ذلك عند مزوّد الدفع وحده.",
    notifications: "التنبيهات",
    whatsapp: "واتساب",
    whatsappHint: "تأكيدات الحجز والتذكيرات — القناة الأهم",
    sms: "رسائل SMS",
    smsHint: "تصلك حين يتعذّر واتساب",
    inApp: "داخل التطبيق",
    inAppHint: "نسخة محفوظة من كل رسالة",
    marketing: "العروض والتخفيضات",
    marketingHint: "اختياري تمامًا — تأكيدات حجزك تصلك دائمًا بغض النظر",
    earlyAccess: "الإعلان المبكر عن الأماكن الجديدة",
    earlyAccessHint: "نخبرك قبل غيرك حين نعتمد مكانًا في مناطقك المفضّلة",
    areas: "مناطقك المفضّلة",
    areasIntro: "اخترها بنفسك — لا نستنتجها عنك. نستخدمها للترتيب وللإعلان المبكر فقط.",
    email: "البريد الإلكتروني",
    emailIntro: (tail: string) => `اختياري. فائدته أنه يبقى معك لو تغيّر رقمك — و${tail}.`,
    emailVerified: "بريدك موثّق ✅",
    emailEarns: "توثيقه يمنحك نقاطًا",
    verifiedBtn: "موثّق",
    sendVerification: "أرسل التوثيق",
    devLink: "رابط التوثيق (وضع تجريبي) ←",
    yourData: "بياناتك",
    yourDataBody:
      "نتعلّم من استخدامك داخل التطبيق فقط. لا نشتري بياناتك ولا نجمع حساباتك على مواقع التواصل، ولا نبيعها لأي جهة.",
    download: "⬇ نزّل نسخة من بياناتي",
  },
  en: {
    saveFailed: "Could not save — try again",
    emailInUse: "That email is already on another account",
    emailFailed: "Could not save your email",
    exportFailed: "Could not export your data",
    langAndLook: "Language & appearance",
    language: "Language",
    languageHint: "Applies straight away on this device, and follows you to any device you sign in on.",
    appearance: "Appearance",
    themes: { system: "Match device", light: "Light", dark: "Dark" } as Record<string, string>,
    payment: "Payment",
    paymentIntro: "We pick this method for you at checkout — you can change it every time.",
    paymentNote: "We never store your card numbers — those stay with the payment provider alone.",
    notifications: "Notifications",
    whatsapp: "WhatsApp",
    whatsappHint: "Booking confirmations and reminders — the channel that matters most",
    sms: "SMS",
    smsHint: "Reaches you when WhatsApp cannot",
    inApp: "In the app",
    inAppHint: "A saved copy of every message",
    marketing: "Offers and discounts",
    marketingHint: "Entirely optional — your booking confirmations reach you either way",
    earlyAccess: "Early word on new places",
    earlyAccessHint:
      "We tell you before anyone else when we approve a place in your favourite areas",
    areas: "Your favourite areas",
    areasIntro:
      "You pick these — we do not infer them. They are used for ordering results and for early word, nothing else.",
    email: "Email",
    emailIntro: (tail: string) =>
      `Optional. It stays with you if your number ever changes — and ${tail}.`,
    emailVerified: "your email is verified ✅",
    emailEarns: "verifying it earns you points",
    verifiedBtn: "Verified",
    sendVerification: "Send verification",
    devLink: "Verification link (demo mode) →",
    yourData: "Your data",
    yourDataBody:
      "We learn from how you use the app, and nothing else. We do not buy data about you, we do not gather your social accounts, and we do not sell anything to anyone.",
    download: "⬇ Download a copy of my data",
  },
} satisfies Record<Locale, unknown>;

export function SettingsTab({
  data,
  onChange,
}: {
  data: AccountData;
  onChange: () => void | Promise<void>;
}) {
  const locale = useLocale();
  const c = copy[locale];
  const bare = useBarePath();
  const [prefs, setPrefs] = useState(data.preferences);
  const [email, setEmail] = useState(data.email ?? "");
  const [msg, setMsg] = useState("");
  const [devLink, setDevLink] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => setPrefs(data.preferences), [data.preferences]);

  /**
   * Theme applies immediately, before the save round-trips. Waiting on the
   * network to see a colour change would feel broken on a slow connection.
   */
  useEffect(() => {
    const root = document.documentElement;
    const dark =
      prefs.theme === "dark" ||
      (prefs.theme === "system" &&
        window.matchMedia?.("(prefers-color-scheme: dark)").matches);
    root.classList.toggle("dark", Boolean(dark));
    try {
      localStorage.setItem("ciao_theme", prefs.theme);
    } catch {
      /* private mode — the server copy is the durable one anyway */
    }
  }, [prefs.theme]);

  async function save(patch: Partial<typeof prefs>) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    setMsg("");
    try {
      await api("/v1/me/preferences", { method: "PATCH", body: JSON.stringify(patch) });
      await onChange();
    } catch {
      setMsg(c.saveFailed);
    }
  }

  async function saveEmail() {
    setBusy(true);
    setMsg("");
    setDevLink("");
    try {
      const res = await api<{ message: string; devLink?: string }>("/v1/me/email", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setMsg(res.message);
      if (res.devLink) setDevLink(res.devLink);
      await onChange();
    } catch (e) {
      setMsg(
        e instanceof ApiError && e.message.includes("email_in_use") ? c.emailInUse : c.emailFailed,
      );
    } finally {
      setBusy(false);
    }
  }

  /** Export goes through the normal API helper — no second auth path. */
  async function exportData() {
    setMsg("");
    try {
      const payload = await api<unknown>("/v1/me/export");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "ciao-my-data.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setMsg(c.exportFailed);
    }
  }

  return (
    <div className="space-y-3">
      {msg ? <p className="text-sm font-bold text-sea">{msg}</p> : null}

      <Card title={c.langAndLook}>
        {/*
          Language is a link per language, not a <select>: choosing one has to
          both record the preference and move the reader to the same page in
          that language, and a control that saves without navigating leaves an
          English reader looking at an Arabic screen that claims to be English.
          Raw next/link on purpose — this is the one place that must *leave*
          the current locale.
        */}
        <Row label={c.language}>
          <div className="flex gap-1.5">
            {LOCALES.map((l) => (
              <NextLink
                key={l}
                // `?tab=settings` so the reader lands back on this screen in
                // the other language rather than on the account overview.
                href={localePath(`${bare}?tab=settings`, l)}
                hrefLang={l}
                lang={l}
                aria-current={l === locale ? "true" : undefined}
                className={`chip !py-1 ${l === locale ? "!bg-sea !text-white" : ""}`}
                onClick={() => {
                  try {
                    localStorage.setItem("ciao_locale", l);
                  } catch {
                    /* private mode — the URL still carries the language */
                  }
                  // Best effort, and deliberately not `save()`: this component
                  // is about to be replaced by the other language's render, so
                  // a failed write must not try to set state or block the
                  // navigation the user just asked for.
                  void api("/v1/me/preferences", {
                    method: "PATCH",
                    body: JSON.stringify({ locale: l }),
                  }).catch(() => {});
                }}
              >
                {LANGUAGE_NAMES[l]}
              </NextLink>
            ))}
          </div>
        </Row>
        <p className="text-[11px] text-faint -mt-1 mb-1">{c.languageHint}</p>
        <Row label={c.appearance}>
          <select
            className="chip !py-1"
            value={prefs.theme}
            onChange={(e) => save({ theme: e.target.value })}
          >
            {THEMES.map((v) => (
              <option key={v} value={v}>{c.themes[v]}</option>
            ))}
          </select>
        </Row>
      </Card>

      <Card title={c.payment}>
        <p className="text-xs text-faint mb-2">{c.paymentIntro}</p>
        <div className="flex flex-wrap gap-1.5">
          {RAILS.map((v) => (
            <button
              key={v}
              className={`chip ${prefs.preferredRail === v ? "!bg-sea !text-white" : ""}`}
              onClick={() => save({ preferredRail: prefs.preferredRail === v ? null : v })}
            >
              {term(PAYMENT_RAILS, locale, v)}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-faint mt-2">{c.paymentNote}</p>
      </Card>

      <Card title={c.notifications}>
        <Toggle
          label={c.whatsapp}
          hint={c.whatsappHint}
          on={prefs.notifyWhatsapp}
          onChange={(v) => save({ notifyWhatsapp: v })}
        />
        <Toggle
          label={c.sms}
          hint={c.smsHint}
          on={prefs.notifySms}
          onChange={(v) => save({ notifySms: v })}
        />
        <Toggle
          label={c.inApp}
          hint={c.inAppHint}
          on={prefs.notifyInApp}
          onChange={(v) => save({ notifyInApp: v })}
        />
        <div className="h-px bg-sand my-2" />
        <Toggle
          label={c.marketing}
          hint={c.marketingHint}
          on={prefs.marketingOptIn}
          onChange={(v) => save({ marketingOptIn: v })}
        />
        <Toggle
          label={c.earlyAccess}
          hint={c.earlyAccessHint}
          on={prefs.earlyAccessOptIn}
          onChange={(v) => save({ earlyAccessOptIn: v })}
        />
      </Card>

      <Card title={c.areas}>
        <p className="text-xs text-faint mb-2">{c.areasIntro}</p>
        <div className="flex flex-wrap gap-1.5">
          {AREA_KEYS.map((v) => {
            const on = prefs.favouriteAreas.includes(v);
            return (
              <button
                key={v}
                className={`chip ${on ? "!bg-sea !text-white" : ""}`}
                onClick={() =>
                  save({
                    favouriteAreas: on
                      ? prefs.favouriteAreas.filter((a) => a !== v)
                      : [...prefs.favouriteAreas, v],
                  })
                }
              >
                {term(AREAS, locale, v)}
              </button>
            );
          })}
        </div>
      </Card>

      <Card title={c.email}>
        <p className="text-xs text-faint mb-2">
          {c.emailIntro(data.emailVerified ? c.emailVerified : c.emailEarns)}
        </p>
        <div className="flex gap-2">
          <input
            className="input !py-2 !text-sm"
            dir="ltr"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button className="chip shrink-0" onClick={saveEmail} disabled={busy || !email}>
            {data.emailVerified && email === data.email ? c.verifiedBtn : c.sendVerification}
          </button>
        </div>
        {devLink ? (
          <a className="text-xs text-link font-bold mt-2 inline-block break-all" href={devLink}>
            {c.devLink}
          </a>
        ) : null}
      </Card>

      <Card title={c.yourData}>
        <p className="text-xs text-muted leading-relaxed">{c.yourDataBody}</p>
        <button className="chip mt-2" onClick={exportData}>
          {c.download}
        </button>
      </Card>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-4">
      <h3 className="font-bold text-sea text-sm mb-2">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-sea/80">{label}</span>
      {children}
    </div>
  );
}

function Toggle({
  label,
  hint,
  on,
  onChange,
}: {
  label: string;
  hint?: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-3 py-1.5 cursor-pointer">
      <span className="min-w-0">
        <span className="block text-sm text-sea/85">{label}</span>
        {hint ? <span className="block text-[11px] text-faint mt-0.5">{hint}</span> : null}
      </span>
      <input
        type="checkbox"
        className="mt-1 shrink-0 w-5 h-5 accent-[color:var(--sea)]"
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
