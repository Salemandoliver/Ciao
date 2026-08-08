"use client";
/**
 * عروضي — the partner's own promotions.
 *
 * Distinct from Ciao's promo codes, and the distinction is the whole point:
 * ours are marketing spend capped at our commission so a platform campaign can
 * never reach into a host's pocket. These are the partner's own money, their
 * own decision, and their own cap. Eid offers, a first-booking discount, a
 * quiet-Tuesday rate — the things they already post on Instagram and then
 * honour by hand while trying to remember who was promised what.
 *
 * Three choices on this screen are worth defending:
 *
 *  - **No code means automatic.** "10% off all September" is not a code, it is
 *    a price. Requiring a code for it would mean the discount only ever
 *    reaches customers who already knew about it, which is the opposite of
 *    what the partner intended when they made the offer.
 *  - **Two date windows, not one.** When an offer may be *booked* and when the
 *    work must *happen* are different questions, and "book in June for
 *    September" is a real sentence in this market. One window cannot say it.
 *  - **A ceiling on percentages.** The server refuses anything over half off,
 *    because "9000" typed by somebody who meant "they pay 90%" is the version
 *    that gives a chalet away, and it arrives looking like a valid number.
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError, api, fmtLyd } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import type { Locale } from "@/lib/i18n";
import { Section, Pill } from "@/components/panel";
import { PlusTeaser } from "./plus-teaser";
import type { PartnerMe } from "./types";
import type { Service } from "./catalogue";

interface Promotion {
  id: string;
  code: string | null;
  labelAr: string;
  kind: string;
  valueBps: number;
  valueFlat: number;
  maxDiscount: number | null;
  minSpend: number;
  serviceIds: string[];
  fromDay: string | null;
  toDay: string | null;
  travelFromDay: string | null;
  travelToDay: string | null;
  maxRedemptions: number;
  maxPerClient: number;
  redemptions: number;
  firstTimeOnly: boolean;
  publicOnListing: boolean;
  active: boolean;
}

const KINDS = ["percent", "fixed"] as const;

const copy = {
  ar: {
    title: "عروضي",
    hint: "العروض اللي تسويها أنت — من فلوسك، بشروطك. تشتغل في تشاو وفي حجوزاتك المباشرة.",
    empty: "ما عندك عروض.",
    emptyBody: "أول عرض ياخذ دقيقة: «خصم ١٠٪ في سبتمبر» أو «٥٠ دينار خصم لأول حجز».",
    add: "أضف عرض",
    cancel: "إلغاء",
    label: "اسم العرض",
    labelHint: "الاسم اللي يشوفه الزبون — «عرض سبتمبر»، «خصم أول مرة».",
    kind: "نوع الخصم",
    kinds: { percent: "نسبة ٪", fixed: "مبلغ ثابت" },
    percent: "النسبة (٪)",
    percentHint: "بحد أقصى ٥٠٪. أكثر من كذا كلّمنا.",
    flat: "المبلغ (د.ل)",
    maxDiscount: "أقصى خصم (د.ل)",
    maxDiscountHint: "سقف يحميك لو جاك حجز كبير.",
    minSpend: "أقل مبلغ للحجز (د.ل)",
    code: "الكود (اختياري)",
    codeHint: "اتركه فاضي والعرض يشتغل تلقائيًا لكل زبون يستاهله.",
    windowBook: "متى يُستعمل العرض",
    windowTravel: "متى تكون الشغلة نفسها",
    windowTravelHint: "«احجز في يونيو لسبتمبر» — ودّي التواريخ هنا.",
    from: "من",
    to: "إلى",
    services: "الخدمات",
    allServices: "كل الخدمات",
    limits: "الحدود",
    maxRedemptions: "أقصى عدد استعمال",
    maxPerClient: "لكل زبون",
    unlimited: "بدون حد",
    firstTimeOnly: "لأول حجز فقط",
    publicOnListing: "يظهر في صفحتك بتشاو",
    publicHint: "اقفله لو تبي تعطي الكود بنفسك للي تختاره.",
    save: "احفظ",
    saving: "جارٍ الحفظ…",
    stop: "أوقف",
    resume: "شغّل",
    stopped: "موقوف",
    automatic: "تلقائي",
    used: (n: number) => `استُعمل ${n} مرة`,
    failed: "تعذر الحفظ.",
    duplicate: "الكود مستعمل عندك من قبل.",
    onlyOwner: "العروض لصاحب النشاط أو المدير.",
    loading: "لحظة…",
  },
  en: {
    title: "My offers",
    hint: "Offers you make — your money, your terms. They work on Ciao and on your own direct bookings.",
    empty: "No offers yet.",
    emptyBody: "The first one takes a minute: \"10% off in September\" or \"50 LYD off a first booking\".",
    add: "Add an offer",
    cancel: "Cancel",
    label: "Offer name",
    labelHint: "What the customer sees — \"September offer\", \"First-time discount\".",
    kind: "Discount type",
    kinds: { percent: "Percentage", fixed: "Fixed amount" },
    percent: "Percentage (%)",
    percentHint: "Up to 50%. More than that, talk to us.",
    flat: "Amount (LYD)",
    maxDiscount: "Maximum discount (LYD)",
    maxDiscountHint: "A ceiling that protects you on a large booking.",
    minSpend: "Minimum booking value (LYD)",
    code: "Code (optional)",
    codeHint: "Leave empty and the offer applies automatically to anyone who qualifies.",
    windowBook: "When the offer can be used",
    windowTravel: "When the work itself happens",
    windowTravelHint: "\"Book in June for September\" — put those dates here.",
    from: "From",
    to: "To",
    services: "Services",
    allServices: "All services",
    limits: "Limits",
    maxRedemptions: "Maximum uses",
    maxPerClient: "Per customer",
    unlimited: "No limit",
    firstTimeOnly: "First booking only",
    publicOnListing: "Show on your Ciao page",
    publicHint: "Turn off if you want to hand the code out yourself.",
    save: "Save",
    saving: "Saving…",
    stop: "Stop",
    resume: "Start",
    stopped: "Stopped",
    automatic: "Automatic",
    used: (n: number) => `used ${n} times`,
    failed: "Could not save.",
    duplicate: "You already have an offer with that code.",
    onlyOwner: "Offers are for the owner or a manager.",
    loading: "One moment…",
  },
} satisfies Record<Locale, unknown>;

const toDirhams = (v: string) => Math.max(0, Math.round(Number(v || 0) * 1000));

export function OffersTab({ me, onGoPlus }: { me: PartnerMe; onGoPlus?: () => void }) {
  const locale = useLocale();
  const c = copy[locale];
  const scope = me.partnerId ? `?partnerId=${me.partnerId}` : "";

  const [items, setItems] = useState<Promotion[] | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const empty = {
    labelAr: "",
    kind: "percent",
    percent: "10",
    flat: "",
    maxDiscount: "",
    minSpend: "",
    code: "",
    fromDay: "",
    toDay: "",
    travelFromDay: "",
    travelToDay: "",
    serviceIds: [] as string[],
    maxRedemptions: "",
    maxPerClient: "",
    firstTimeOnly: false,
    publicOnListing: true,
  };
  const [f, setF] = useState(empty);

  const load = useCallback(async () => {
    try {
      const [promos, cat] = await Promise.all([
        api<{ items: Promotion[] }>(`/v1/partner/promotions${scope}`),
        api<{ services: Service[] }>(`/v1/partner/catalogue${scope}`),
      ]);
      setItems(promos.items);
      setServices(cat.services.filter((s) => s.active));
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? c.onlyOwner : c.failed);
      setItems([]);
    }
  }, [scope, c.onlyOwner, c.failed]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    setError("");
    try {
      await api(`/v1/partner/promotions${scope}`, {
        method: "POST",
        body: JSON.stringify({
          labelAr: f.labelAr.trim(),
          kind: f.kind,
          // The partner types a percentage; the engine wants basis points.
          valueBps: f.kind === "percent" ? Math.round(Number(f.percent || 0) * 100) : 0,
          valueFlat: f.kind === "fixed" ? toDirhams(f.flat) : 0,
          maxDiscount: f.maxDiscount ? toDirhams(f.maxDiscount) : null,
          minSpend: toDirhams(f.minSpend),
          code: f.code.trim() || null,
          fromDay: f.fromDay || null,
          toDay: f.toDay || null,
          travelFromDay: f.travelFromDay || null,
          travelToDay: f.travelToDay || null,
          serviceIds: f.serviceIds,
          maxRedemptions: Number(f.maxRedemptions) || 0,
          maxPerClient: Number(f.maxPerClient) || 0,
          firstTimeOnly: f.firstTimeOnly,
          publicOnListing: f.publicOnListing,
        }),
      });
      setF(empty);
      setOpen(false);
      await load();
    } catch (e) {
      const field = e instanceof ApiError ? (e.detail as { field?: string; reason?: string }) : null;
      setError(field?.reason === "duplicate" ? c.duplicate : c.failed);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(p: Promotion) {
    await api(`/v1/partner/promotions/${p.id}${scope}`, {
      method: "PATCH",
      body: JSON.stringify({ active: !p.active }),
    }).catch(() => undefined);
    await load();
  }

  if (!items) return <p className="p-4 text-faint">{error || c.loading}</p>;

  return (
    <>
      <Section
        title={c.title}
        hint={c.hint}
        action={
          <button className="text-xs font-bold text-link underline" onClick={() => setOpen((v) => !v)}>
            {open ? c.cancel : c.add}
          </button>
        }
      >
        {items.length === 0 && !open ? (
          <div className="text-center py-6">
            <p className="font-bold text-sea">{c.empty}</p>
            <p className="text-sm text-faint mt-1 max-w-sm mx-auto">{c.emptyBody}</p>
            <button className="btn-primary !py-2 !text-sm mt-4" onClick={() => setOpen(true)}>
              {c.add}
            </button>
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((p) => (
              <li key={p.id} className="rounded-2xl bg-sand p-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-sea text-sm truncate">
                    {p.labelAr}{" "}
                    {!p.active ? <Pill tone="slate">{c.stopped}</Pill> : null}
                    {p.active && !p.code ? <Pill tone="green">{c.automatic}</Pill> : null}
                  </p>
                  <p className="text-[11px] text-muted tabular-nums" dir="ltr">
                    {p.kind === "percent"
                      ? `${(p.valueBps / 100).toFixed(0)}%`
                      : fmtLyd(p.valueFlat, locale)}
                    {p.code ? ` · ${p.code}` : ""}
                    {p.travelFromDay ? ` · ${p.travelFromDay} → ${p.travelToDay ?? ""}` : ""}
                  </p>
                  <p className="text-[11px] text-faint">{c.used(p.redemptions)}</p>
                </div>
                <button className="text-xs underline text-faint shrink-0" onClick={() => void toggle(p)}>
                  {p.active ? c.stop : c.resume}
                </button>
              </li>
            ))}
          </ul>
        )}

        {open ? (
          <div className="grid gap-3 sm:grid-cols-2 mt-4">
            <Field label={c.label} hint={c.labelHint} className="sm:col-span-2">
              <input className="input !py-2 !text-sm" value={f.labelAr} onChange={(e) => setF({ ...f, labelAr: e.target.value })} />
            </Field>
            <Field label={c.kind}>
              <select className="input !py-2 !text-sm" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {c.kinds[k]}
                  </option>
                ))}
              </select>
            </Field>
            {f.kind === "percent" ? (
              <Field label={c.percent} hint={c.percentHint}>
                <input className="input !py-2 !text-sm" inputMode="numeric" dir="ltr" value={f.percent} onChange={(e) => setF({ ...f, percent: e.target.value })} />
              </Field>
            ) : (
              <Field label={c.flat}>
                <input className="input !py-2 !text-sm" inputMode="numeric" dir="ltr" value={f.flat} onChange={(e) => setF({ ...f, flat: e.target.value })} />
              </Field>
            )}
            {f.kind === "percent" ? (
              <Field label={c.maxDiscount} hint={c.maxDiscountHint}>
                <input className="input !py-2 !text-sm" inputMode="numeric" dir="ltr" value={f.maxDiscount} onChange={(e) => setF({ ...f, maxDiscount: e.target.value })} />
              </Field>
            ) : null}
            <Field label={c.minSpend}>
              <input className="input !py-2 !text-sm" inputMode="numeric" dir="ltr" value={f.minSpend} onChange={(e) => setF({ ...f, minSpend: e.target.value })} />
            </Field>
            <Field label={c.code} hint={c.codeHint} className="sm:col-span-2">
              <input className="input !py-2 !text-sm" dir="ltr" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
            </Field>

            <fieldset className="sm:col-span-2 grid grid-cols-2 gap-3">
              <legend className="text-xs font-bold text-muted mb-1">{c.windowBook}</legend>
              <Field label={c.from}>
                <input className="input !py-2 !text-sm" type="date" dir="ltr" value={f.fromDay} onChange={(e) => setF({ ...f, fromDay: e.target.value })} />
              </Field>
              <Field label={c.to}>
                <input className="input !py-2 !text-sm" type="date" dir="ltr" value={f.toDay} onChange={(e) => setF({ ...f, toDay: e.target.value })} />
              </Field>
            </fieldset>

            <fieldset className="sm:col-span-2 grid grid-cols-2 gap-3">
              <legend className="text-xs font-bold text-muted mb-1">{c.windowTravel}</legend>
              <Field label={c.from}>
                <input className="input !py-2 !text-sm" type="date" dir="ltr" value={f.travelFromDay} onChange={(e) => setF({ ...f, travelFromDay: e.target.value })} />
              </Field>
              <Field label={c.to} hint={c.windowTravelHint}>
                <input className="input !py-2 !text-sm" type="date" dir="ltr" value={f.travelToDay} onChange={(e) => setF({ ...f, travelToDay: e.target.value })} />
              </Field>
            </fieldset>

            {services.length > 0 ? (
              <div className="sm:col-span-2">
                <span className="text-xs font-bold text-muted">{c.services}</span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  <button
                    type="button"
                    onClick={() => setF({ ...f, serviceIds: [] })}
                    className={`chip !text-xs ${f.serviceIds.length === 0 ? "!bg-sea !text-white" : ""}`}
                  >
                    {c.allServices}
                  </button>
                  {services.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() =>
                        setF({
                          ...f,
                          serviceIds: f.serviceIds.includes(s.id)
                            ? f.serviceIds.filter((x) => x !== s.id)
                            : [...f.serviceIds, s.id],
                        })
                      }
                      className={`chip !text-xs ${f.serviceIds.includes(s.id) ? "!bg-sea !text-white" : ""}`}
                    >
                      {s.nameAr}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <Field label={c.maxRedemptions} hint={c.unlimited}>
              <input className="input !py-2 !text-sm" inputMode="numeric" dir="ltr" value={f.maxRedemptions} onChange={(e) => setF({ ...f, maxRedemptions: e.target.value })} />
            </Field>
            <Field label={c.maxPerClient} hint={c.unlimited}>
              <input className="input !py-2 !text-sm" inputMode="numeric" dir="ltr" value={f.maxPerClient} onChange={(e) => setF({ ...f, maxPerClient: e.target.value })} />
            </Field>

            <label className="flex items-start gap-3 sm:col-span-2 cursor-pointer">
              <input type="checkbox" className="mt-0.5 h-5 w-5 rounded accent-[color:rgb(var(--sea))]" checked={f.firstTimeOnly} onChange={(e) => setF({ ...f, firstTimeOnly: e.target.checked })} />
              <span className="text-sm font-bold text-sea">{c.firstTimeOnly}</span>
            </label>
            <label className="flex items-start gap-3 sm:col-span-2 cursor-pointer">
              <input type="checkbox" className="mt-0.5 h-5 w-5 rounded accent-[color:rgb(var(--sea))]" checked={f.publicOnListing} onChange={(e) => setF({ ...f, publicOnListing: e.target.checked })} />
              <span className="min-w-0">
                <span className="block text-sm font-bold text-sea">{c.publicOnListing}</span>
                <span className="block text-[11px] text-faint mt-0.5">{c.publicHint}</span>
              </span>
            </label>

            <div className="sm:col-span-2">
              <button className="btn-primary !py-2 !px-5 !text-sm" disabled={busy || !f.labelAr.trim()} onClick={() => void save()}>
                {busy ? c.saving : c.save}
              </button>
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="text-sm font-bold text-[color:rgb(var(--danger))] mt-3">{error}</p>
        ) : null}
      </Section>

      <PlusTeaser
        me={me}
        panel="offers_timing"
        onOpen={onGoPlus}
        titleAr="متى تسوّي العرض؟"
        titleEn="When should the offer run?"
        bodyAr="بلس يوريك متى ينزل الطلب في منطقتك بالضبط — عشان تحط الخصم في الأسبوع اللي يحتاجه، مش في أسبوع كنت بتمتلي فيه على أي حال."
        bodyEn="Plus shows exactly when demand dips in your area — so the discount lands in the week that needs it, not the week you'd have filled anyway."
      />
    </>
  );
}

function Field({
  label,
  hint,
  className = "",
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="text-xs font-bold text-muted">{label}</span>
      <span className="block mt-1">{children}</span>
      {hint ? <span className="block text-[11px] text-faint mt-1">{hint}</span> : null}
    </label>
  );
}
