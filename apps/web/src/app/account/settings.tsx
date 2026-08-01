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
import { ApiError, api } from "@/lib/api";
import type { AccountData } from "./page";

const RAILS: [string, string][] = [
  ["sadad", "سداد"],
  ["adfali", "أضفلي"],
  ["local_card", "بطاقة محلية"],
  ["tlync", "T-Lync"],
  ["cash", "نقدًا عند الوصول"],
];

const AREAS: [string, string][] = [
  ["janzour", "جنزور"],
  ["tajoura", "تاجوراء"],
  ["ain_zara", "عين زارة"],
  ["airport_road", "طريق المطار"],
];

const THEMES: [string, string][] = [
  ["system", "حسب الجهاز"],
  ["light", "فاتح"],
  ["dark", "داكن"],
];

export function SettingsTab({
  data,
  onChange,
}: {
  data: AccountData;
  onChange: () => void | Promise<void>;
}) {
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
      setMsg("تعذر الحفظ — حاول مرة أخرى");
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
        e instanceof ApiError && e.message.includes("email_in_use")
          ? "هذا البريد مستخدم في حساب آخر"
          : "تعذر حفظ البريد",
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
      setMsg("تعذر التصدير");
    }
  }

  return (
    <div className="space-y-3">
      {msg ? <p className="text-sm font-bold text-sea">{msg}</p> : null}

      <Card title="اللغة والمظهر">
        <Row label="اللغة">
          <select
            className="chip !py-1"
            value={prefs.locale}
            onChange={(e) => save({ locale: e.target.value })}
          >
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </select>
        </Row>
        <Row label="المظهر">
          <select
            className="chip !py-1"
            value={prefs.theme}
            onChange={(e) => save({ theme: e.target.value })}
          >
            {THEMES.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </Row>
      </Card>

      <Card title="الدفع">
        <p className="text-xs text-faint mb-2">
          نختار لك هذه الوسيلة تلقائيًا عند الحجز — تقدر تغيّرها في كل مرة.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {RAILS.map(([v, l]) => (
            <button
              key={v}
              className={`chip ${prefs.preferredRail === v ? "!bg-sea !text-white" : ""}`}
              onClick={() => save({ preferredRail: prefs.preferredRail === v ? null : v })}
            >
              {l}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-faint mt-2">
          لا نحفظ أرقام بطاقتك أبدًا — ذلك عند مزوّد الدفع وحده.
        </p>
      </Card>

      <Card title="التنبيهات">
        <Toggle
          label="واتساب"
          hint="تأكيدات الحجز والتذكيرات — القناة الأهم"
          on={prefs.notifyWhatsapp}
          onChange={(v) => save({ notifyWhatsapp: v })}
        />
        <Toggle
          label="رسائل SMS"
          hint="تصلك حين يتعذّر واتساب"
          on={prefs.notifySms}
          onChange={(v) => save({ notifySms: v })}
        />
        <Toggle
          label="داخل التطبيق"
          hint="نسخة محفوظة من كل رسالة"
          on={prefs.notifyInApp}
          onChange={(v) => save({ notifyInApp: v })}
        />
        <div className="h-px bg-sand my-2" />
        <Toggle
          label="العروض والتخفيضات"
          hint="اختياري تمامًا — تأكيدات حجزك تصلك دائمًا بغض النظر"
          on={prefs.marketingOptIn}
          onChange={(v) => save({ marketingOptIn: v })}
        />
        <Toggle
          label="الإعلان المبكر عن الأماكن الجديدة"
          hint="نخبرك قبل غيرك حين نعتمد مكانًا في مناطقك المفضّلة"
          on={prefs.earlyAccessOptIn}
          onChange={(v) => save({ earlyAccessOptIn: v })}
        />
      </Card>

      <Card title="مناطقك المفضّلة">
        <p className="text-xs text-faint mb-2">
          اخترها بنفسك — لا نستنتجها عنك. نستخدمها للترتيب وللإعلان المبكر فقط.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {AREAS.map(([v, l]) => {
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
                {l}
              </button>
            );
          })}
        </div>
      </Card>

      <Card title="البريد الإلكتروني">
        <p className="text-xs text-faint mb-2">
          اختياري. فائدته أنه يبقى معك لو تغيّر رقمك — و
          {data.emailVerified ? "بريدك موثّق ✅" : "توثيقه يمنحك نقاطًا"}.
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
            {data.emailVerified && email === data.email ? "موثّق" : "أرسل التوثيق"}
          </button>
        </div>
        {devLink ? (
          <a className="text-xs text-link font-bold mt-2 inline-block break-all" href={devLink}>
            رابط التوثيق (وضع تجريبي) ←
          </a>
        ) : null}
      </Card>

      <Card title="بياناتك">
        <p className="text-xs text-muted leading-relaxed">
          نتعلّم من استخدامك داخل التطبيق فقط. لا نشتري بياناتك ولا نجمع حساباتك على مواقع
          التواصل، ولا نبيعها لأي جهة.
        </p>
        <button className="chip mt-2" onClick={exportData}>
          ⬇ نزّل نسخة من بياناتي
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
