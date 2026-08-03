"use client";
/**
 * The supply base, as ops sees it.
 *
 * The headline number here is the source mix, and it is worth being clear about
 * why it earns a place on the founder's morning screen. Every other supply
 * metric in this console measures what Ciao did — bookings we took, deposits we
 * held, venues we verified. This one measures what we did *not* do: across
 * every partner's own diary, how much of their work came from somewhere else.
 *
 * It is the only honest read on our market position that exists anywhere in
 * Libya, it comes from the partners' own hand rather than our inference, and it
 * is allowed to be a small number. A founder who can watch it move from 8% to
 * 20% over a season knows something no competitor knows about themselves.
 *
 * Deliberately counts and states only. Ops does not browse anyone's customer
 * book from here — a screen that made that easy is a screen that would get used.
 */
import { useEffect, useState } from "react";
import { api, fmtLyd } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { JOB_SOURCES, term } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";
import { Bars, Section, Stat } from "@/components/panel";

interface PartnerPanel {
  profiles: number;
  onboarded: number;
  agendaOn: number;
  jobs: { total: number; direct: number; directValue: number };
  subscriptions: { trialing: number; active: number; pastDue: number; cancelled: number };
  sourceMix: { source: string; jobs: number }[];
  pendingPayoutChanges: number;
}

const copy = {
  ar: {
    title: "لوحة الشركاء",
    hint: "الأنشطة اللي تستعمل لوحة التحكم — وكم من شغلهم يجي عن طريق تشاو.",
    profiles: "أنشطة على اللوحة",
    onboarded: "أكملوا الإعداد",
    agendaOn: "يستلمون برنامج اليوم",
    directJobs: "شغل من خارج تشاو",
    directValue: "قيمته",
    ciaoShare: (pct: number) => `${pct}% من شغل الشركاء جا عن طريق تشاو`,
    sourceTitle: "من وين يجي شغل الشركاء",
    plusTitle: "اشتراكات تشاو بلس",
    trialing: "تجربة",
    active: "فعّال",
    pastDue: "بانتظار التحصيل",
    cancelled: "ملغى",
    payoutAlert: "طلبات تغيير حساب معلّقة",
    payoutAlertHint: "كل طلب يمر بمهلة أمان — راقبها إن زادت فجأة.",
  },
  en: {
    title: "Partner panel",
    hint: "Businesses using the control panel — and how much of their work comes through Ciao.",
    profiles: "Businesses on the panel",
    onboarded: "Finished setup",
    agendaOn: "Get the daily agenda",
    directJobs: "Work from outside Ciao",
    directValue: "Worth",
    ciaoShare: (pct: number) => `${pct}% of partner work came through Ciao`,
    sourceTitle: "Where partner work comes from",
    plusTitle: "Ciao Plus subscriptions",
    trialing: "Free season",
    active: "Active",
    pastDue: "Awaiting collection",
    cancelled: "Cancelled",
    payoutAlert: "Pending payout-account changes",
    payoutAlertHint: "Each sits out a security hold — watch this if it jumps.",
  },
} satisfies Record<Locale, unknown>;

export function PartnerPanel() {
  const locale = useLocale();
  const c = copy[locale];
  const [data, setData] = useState<PartnerPanel | null>(null);

  useEffect(() => {
    api<PartnerPanel>("/v1/biz/partner-panel")
      .then(setData)
      .catch(() => setData(null));
  }, []);

  if (!data) return null;

  const ciaoJobs = data.jobs.total - data.jobs.direct;
  const ciaoShare = data.jobs.total > 0 ? Math.round((ciaoJobs / data.jobs.total) * 100) : 0;

  return (
    <Section title={c.title} hint={c.hint}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <Stat label={c.profiles} value={data.profiles} sub={`${data.onboarded} · ${c.onboarded}`} />
        <Stat label={c.agendaOn} value={data.agendaOn} />
        <Stat
          label={c.directJobs}
          value={data.jobs.direct}
          sub={`${c.directValue} ${fmtLyd(data.jobs.directValue, locale)}`}
        />
        <Stat
          label={c.payoutAlert}
          value={data.pendingPayoutChanges}
          tone={data.pendingPayoutChanges > 0 ? "warn" : "normal"}
          sub={c.payoutAlertHint}
        />
      </div>

      <p className="text-xs font-bold text-muted mb-2">{c.sourceTitle}</p>
      <Bars
        rows={data.sourceMix.map((s) => ({
          label: term(JOB_SOURCES, locale, s.source),
          value: s.jobs,
        }))}
      />
      <p className="text-[11px] text-faint mt-2">{c.ciaoShare(ciaoShare)}</p>

      <p className="text-xs font-bold text-muted mt-4 mb-2">{c.plusTitle}</p>
      <Bars
        rows={[
          { label: c.trialing, value: data.subscriptions.trialing },
          { label: c.active, value: data.subscriptions.active },
          { label: c.pastDue, value: data.subscriptions.pastDue },
          { label: c.cancelled, value: data.subscriptions.cancelled },
        ]}
      />
    </Section>
  );
}
