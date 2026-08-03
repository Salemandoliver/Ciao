"use client";
/**
 * Messaging — the delivery journal and the channel controls.
 *
 * The screen answers the questions ops asks the day WhatsApp goes live: is
 * the channel healthy, what failed last night, did that partner get her
 * invite. Reads come from the journal the ladder already writes; the two
 * controls that belong to the control plane (channel kill switches, quiet
 * hours) write through the ordinary settings endpoint, so they are audited
 * like every other business decision.
 *
 * Credentials are shown as booleans only — whether a channel is wired, never
 * with what.
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { fmtDate, fmtNum } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";
import { Pill, Section, Stat } from "./lib";

interface MessagingData {
  windowDays: number;
  config: {
    provider: string;
    whatsappConfigured: boolean;
    smsConfigured: boolean;
    smsSenderId: string;
    templateSends: boolean;
  };
  switches: {
    whatsappEnabled: boolean;
    smsEnabled: boolean;
    quietFromHour: number;
    quietToHour: number;
  };
  stats: { channel: string | null; status: string; n: number }[];
  byTemplate: { templateKey: string | null; n: number; failed: number }[];
  journal: {
    id: string;
    templateKey: string | null;
    channel: string | null;
    toPhone: string | null;
    deliveryStatus: string;
    deliveryDetail: string | null;
    ladderStep: number;
    createdAt: string;
  }[];
}

const copy = {
  ar: {
    loadFailed: "تعذر تحميل بيانات الرسائل",
    channels: "القنوات",
    provider: "وضع الإرسال",
    providerConsole: "تجريبي — الرسائل تُسجَّل ولا تُرسَل فعليًا",
    providerLive: "فعلي",
    whatsapp: "واتساب",
    sms: "رسائل SMS",
    wired: "مربوطة",
    notWired: "غير مربوطة",
    on: "مفعّلة",
    off: "موقوفة",
    templateSends: "قوالب معتمدة من ميتا",
    freeText: "نص حر (داخل جلسة ٢٤ ساعة فقط)",
    sender: "المُرسِل",
    switchOn: "تشغيل",
    switchOff: "إيقاف",
    confirmOff: (ch: string) =>
      `إيقاف قناة ${ch}؟ الرسائل ستتحول للقناة التالية أو تُسجَّل كمتجاوزة.`,
    adminOnly: "التغيير للمدير فقط",
    saveFailed: "تعذر الحفظ",
    quiet: "ساعات الهدوء",
    quietBody: "لا رسائل غير عاجلة بين هاتين الساعتين (توقيت طرابلس). العاجلة تمر دائمًا.",
    from: "من الساعة",
    to: "إلى الساعة",
    save: "حفظ",
    saved: "حُفظ ✅",
    last7: (n: number) => `آخر ${n} أيام`,
    sent: "أُرسلت",
    failed: "فشلت",
    skipped: "تُجوّزت",
    journal: "سجل الرسائل",
    thWhen: "متى",
    thTemplate: "القالب",
    thChannel: "القناة",
    thTo: "إلى",
    thStatus: "الحالة",
    all: "الكل",
    empty: "لا رسائل في هذه الفترة",
    test: "رسالة تجريبية",
    testBody:
      "أرسل رسالة فعلية للتأكد من ربط القناة. تصل من هوية تشاو الرسمية — استعملها بحكمة.",
    testPhone: "رقم الاستلام",
    testSend: "أرسل الآن",
    testSending: "جارٍ الإرسال…",
    testResult: (code: string) => `أُرسلت — الرمز في الرسالة: ${code}`,
    testFailed: "فشل الإرسال",
  },
  en: {
    loadFailed: "Could not load messaging data",
    channels: "Channels",
    provider: "Sending mode",
    providerConsole: "Demo — messages are journaled, not actually sent",
    providerLive: "Live",
    whatsapp: "WhatsApp",
    sms: "SMS",
    wired: "Wired",
    notWired: "Not wired",
    on: "On",
    off: "Off",
    templateSends: "Meta-approved templates",
    freeText: "Free text (24h sessions only)",
    sender: "Sender",
    switchOn: "Turn on",
    switchOff: "Turn off",
    confirmOff: (ch: string) =>
      `Turn off ${ch}? Messages will fall through to the next channel, or journal as skipped.`,
    adminOnly: "Only an admin can change this",
    saveFailed: "Could not save",
    quiet: "Quiet hours",
    quietBody:
      "No non-urgent messages between these hours (Tripoli time). Critical ones always pass.",
    from: "From hour",
    to: "To hour",
    save: "Save",
    saved: "Saved ✅",
    last7: (n: number) => `Last ${n} days`,
    sent: "Sent",
    failed: "Failed",
    skipped: "Skipped",
    journal: "Delivery journal",
    thWhen: "When",
    thTemplate: "Template",
    thChannel: "Channel",
    thTo: "To",
    thStatus: "Status",
    all: "All",
    empty: "No messages in this window",
    test: "Test message",
    testBody:
      "Sends a real message to verify the channel wiring. It arrives from Ciao's official sender — use sparingly.",
    testPhone: "Receiving number",
    testSend: "Send now",
    testSending: "Sending…",
    testResult: (code: string) => `Sent — the reference in the message is ${code}`,
    testFailed: "The send failed",
  },
} satisfies Record<Locale, unknown>;

const STATUS_TONE: Record<string, string> = {
  sent: "green",
  delivered: "green",
  failed: "red",
  skipped: "amber",
  queued: "sand",
};

export function MessagingTab({ isAdmin }: { isAdmin: boolean }) {
  const locale = useLocale();
  const c = copy[locale];
  const [data, setData] = useState<MessagingData | null>(null);
  const [status, setStatus] = useState("all");
  const [msg, setMsg] = useState("");
  const [quietFrom, setQuietFrom] = useState("23");
  const [quietTo, setQuietTo] = useState("8");
  const [testPhone, setTestPhone] = useState("");
  const [testBusy, setTestBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const q = status === "all" ? "" : `&status=${status}`;
      const res = await api<MessagingData>(`/v1/biz/messaging?days=7${q}`);
      setData(res);
      setQuietFrom(String(res.switches.quietFromHour));
      setQuietTo(String(res.switches.quietToHour));
    } catch {
      setMsg(c.loadFailed);
    }
  }, [status, c]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patchSettings(patch: Record<string, unknown>) {
    try {
      await api("/v1/biz/settings", { method: "PUT", body: JSON.stringify({ patch }) });
      setMsg(c.saved);
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError && e.status === 403 ? c.adminOnly : c.saveFailed);
    }
  }

  async function toggleChannel(key: "messaging.whatsappEnabled" | "messaging.smsEnabled", next: boolean) {
    const label = key.includes("whatsapp") ? c.whatsapp : c.sms;
    if (!next && !window.confirm(c.confirmOff(label))) return;
    await patchSettings({ [key]: next });
  }

  async function sendTest() {
    if (!testPhone.trim()) return;
    setTestBusy(true);
    setMsg("");
    try {
      const res = await api<{ ok: boolean; code: string }>("/v1/biz/messaging/test", {
        method: "POST",
        body: JSON.stringify({ phone: testPhone, locale }),
      });
      setMsg(c.testResult(res.code));
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError && e.status === 403 ? c.adminOnly : c.testFailed);
    } finally {
      setTestBusy(false);
    }
  }

  if (!data) return <p className="p-4 text-faint">{msg || "…"}</p>;

  const count = (s: string) => data.stats.filter((r) => r.status === s).reduce((a, r) => a + r.n, 0);
  const live = data.config.provider !== "console";

  return (
    <div>
      {msg ? <p className="mb-3 text-sm font-bold text-sea">{msg}</p> : null}

      <Section title={c.channels}>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="card p-4">
            <p className="text-xs font-bold text-muted">{c.provider}</p>
            <p className={`mt-1 font-bold ${live ? "text-sea" : "text-[color:rgb(var(--danger))]"}`}>
              {live ? c.providerLive : c.providerConsole}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-xs font-bold text-muted">{c.whatsapp}</p>
            <div className="mt-1 flex items-center gap-2">
              <Pill tone={data.config.whatsappConfigured ? "green" : "sand"}>
                {data.config.whatsappConfigured ? c.wired : c.notWired}
              </Pill>
              <Pill tone={data.switches.whatsappEnabled ? "green" : "red"}>
                {data.switches.whatsappEnabled ? c.on : c.off}
              </Pill>
              {isAdmin ? (
                <button
                  className="chip !text-[11px]"
                  onClick={() => toggleChannel("messaging.whatsappEnabled", !data.switches.whatsappEnabled)}
                >
                  {data.switches.whatsappEnabled ? c.switchOff : c.switchOn}
                </button>
              ) : null}
            </div>
            <p className="text-[11px] text-faint mt-2">
              {data.config.templateSends ? c.templateSends : c.freeText}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-xs font-bold text-muted">{c.sms}</p>
            <div className="mt-1 flex items-center gap-2">
              <Pill tone={data.config.smsConfigured ? "green" : "sand"}>
                {data.config.smsConfigured ? c.wired : c.notWired}
              </Pill>
              <Pill tone={data.switches.smsEnabled ? "green" : "red"}>
                {data.switches.smsEnabled ? c.on : c.off}
              </Pill>
              {isAdmin ? (
                <button
                  className="chip !text-[11px]"
                  onClick={() => toggleChannel("messaging.smsEnabled", !data.switches.smsEnabled)}
                >
                  {data.switches.smsEnabled ? c.switchOff : c.switchOn}
                </button>
              ) : null}
            </div>
            <p className="text-[11px] text-faint mt-2" dir="ltr">
              {c.sender}: {data.config.smsSenderId}
            </p>
          </div>
        </div>
      </Section>

      <Section title={c.last7(data.windowDays)}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label={c.sent} value={fmtNum(locale, count("sent") + count("delivered"))} />
          <Stat label={c.failed} value={fmtNum(locale, count("failed"))} />
          <Stat label={c.skipped} value={fmtNum(locale, count("skipped"))} />
        </div>
      </Section>

      <Section title={c.quiet}>
        <div className="card p-4">
          <p className="text-xs text-faint mb-3">{c.quietBody}</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="text-xs font-bold text-muted block">{c.from}</span>
              <input
                className="input mt-1 w-20"
                dir="ltr"
                inputMode="numeric"
                value={quietFrom}
                onChange={(e) => setQuietFrom(e.target.value)}
                disabled={!isAdmin}
              />
            </label>
            <label className="text-sm">
              <span className="text-xs font-bold text-muted block">{c.to}</span>
              <input
                className="input mt-1 w-20"
                dir="ltr"
                inputMode="numeric"
                value={quietTo}
                onChange={(e) => setQuietTo(e.target.value)}
                disabled={!isAdmin}
              />
            </label>
            {isAdmin ? (
              <button
                className="btn-primary !py-2 !text-sm"
                onClick={() =>
                  patchSettings({
                    "messaging.quietFromHour": Number(quietFrom),
                    "messaging.quietToHour": Number(quietTo),
                  })
                }
              >
                {c.save}
              </button>
            ) : null}
          </div>
        </div>
      </Section>

      {isAdmin ? (
        <Section title={c.test}>
          <div className="card p-4">
            <p className="text-xs text-faint mb-3">{c.testBody}</p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm">
                <span className="text-xs font-bold text-muted block">{c.testPhone}</span>
                <input
                  className="input mt-1 w-44"
                  dir="ltr"
                  inputMode="tel"
                  placeholder="0912345678"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                />
              </label>
              <button className="btn-primary !py-2 !text-sm" disabled={testBusy} onClick={sendTest}>
                {testBusy ? c.testSending : c.testSend}
              </button>
            </div>
          </div>
        </Section>
      ) : null}

      <Section title={c.journal}>
        <div className="flex gap-1.5 mb-2">
          {["all", "sent", "failed", "skipped"].map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`chip ${status === s ? "!bg-sea !text-white" : ""}`}
            >
              {s === "all" ? c.all : s === "sent" ? c.sent : s === "failed" ? c.failed : c.skipped}
            </button>
          ))}
        </div>
        <div className="card overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-sand/60 text-muted">
              <tr>
                <th className="text-start p-2">{c.thWhen}</th>
                <th className="text-start p-2">{c.thTemplate}</th>
                <th className="text-start p-2">{c.thChannel}</th>
                <th className="text-start p-2">{c.thTo}</th>
                <th className="text-start p-2">{c.thStatus}</th>
              </tr>
            </thead>
            <tbody>
              {data.journal.map((m) => (
                <tr key={m.id} className="border-t border-sand align-top">
                  <td className="p-2 text-faint whitespace-nowrap" dir="ltr">
                    {fmtDate(locale, m.createdAt, {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="p-2 font-bold text-sea" dir="ltr">
                    {m.templateKey ?? "—"}
                  </td>
                  <td className="p-2" dir="ltr">
                    {m.channel ?? "—"}
                    {m.ladderStep > 0 ? ` (#${m.ladderStep + 1})` : ""}
                  </td>
                  <td className="p-2 text-faint" dir="ltr">
                    {m.toPhone ?? "—"}
                  </td>
                  <td className="p-2">
                    <Pill tone={STATUS_TONE[m.deliveryStatus] ?? "sand"}>{m.deliveryStatus}</Pill>
                    {m.deliveryDetail ? (
                      <div className="text-[11px] text-faint mt-1 max-w-[320px] break-all" dir="ltr">
                        {m.deliveryDetail.slice(0, 200)}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
              {data.journal.length === 0 ? (
                <tr>
                  <td className="p-4 text-faint" colSpan={5}>
                    {c.empty}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
