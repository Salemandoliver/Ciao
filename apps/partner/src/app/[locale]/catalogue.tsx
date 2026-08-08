"use client";
/**
 * ما أقدّمه — the catalogue.
 *
 * The screen that turns a diary into a business system. Until now a partner
 * could record work that had already been agreed; here they describe the offer
 * itself, and everything downstream — a quote, a job, a listing, a promotion —
 * starts from what is on this page.
 *
 * The organising idea is that one screen has to work for a resort with forty
 * chalets and for a make-up artist with a bag. So nothing here is called a
 * "room" or a "session": a service is a priced thing with a *unit*, the
 * partner picks the unit, and every label on the screen follows from it. Pick
 * "per person" and the form asks about head count; pick "per night" and it
 * asks about a minimum stay. Same form, different business.
 *
 * Four things live here, in the order a partner builds them:
 *
 *  1. **Services** — what you sell.
 *  2. **Extras** — what you sell alongside it. This is where the margin is,
 *     and today it is negotiated over WhatsApp and forgotten by invoice time.
 *  3. **Pricing rules** — August is more, Friday is more. Every partner in
 *     this market already does this in their head; writing it down is what
 *     stops the marketplace price and the phone price being different numbers.
 *  4. **Questions** — what you need to know before you can do the job. The
 *     single most requested thing by anyone who actually runs a service
 *     business, and the one most likely to make them say the app saves time.
 *
 * The live price preview at the top of the service editor is deliberate and is
 * the whole reason the pricing rules are trustworthy: a rule you cannot see
 * the effect of is a rule you do not dare turn on.
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError, api, fmtLyd } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import type { Locale } from "@/lib/i18n";
import { Section, Pill } from "@/components/panel";
/*
 * Partner-written text is Arabic-only by design and must say so.
 *
 * A service called «مكياج عروس» rendered inside an otherwise English page has
 * to declare itself as Arabic or a screen reader spells it letter by letter in
 * an English accent and the browser orders it wrongly. Same rule the listing
 * titles follow on the marketplace — `tools/locale-audit.mjs` fails the build
 * on any Arabic string that is not declared.
 */
import { hostText, textProps } from "@/lib/content";
import { PlusTeaser } from "./plus-teaser";
import type { PartnerMe } from "./types";

// ────────────────────────────────── shapes ──────────────────────────────────
export interface Service {
  id: string;
  nameAr: string;
  nameEn: string | null;
  descriptionAr: string | null;
  unit: string;
  basePrice: number;
  minUnits: number;
  maxUnits: number | null;
  durationMinutes: number | null;
  minGuests: number | null;
  maxGuests: number | null;
  noticeHours: number | null;
  depositBps: number | null;
  dailyCapacity: number | null;
  includesAr: string[];
  instantBook: boolean;
  published: boolean;
  active: boolean;
  listingId: string | null;
  sortOrder: number;
}

export interface Addon {
  id: string;
  serviceId: string | null;
  nameAr: string;
  price: number;
  priceModel: string;
  maxQty: number;
  required: boolean;
  active: boolean;
}

export interface Rule {
  id: string;
  serviceId: string | null;
  labelAr: string;
  kind: string;
  fromDay: string | null;
  toDay: string | null;
  weekdays: number[];
  minLeadDays: number | null;
  maxLeadDays: number | null;
  minUnits: number | null;
  adjustBps: number;
  adjustFlat: number;
  priority: number;
  active: boolean;
}

export interface Question {
  id: string;
  serviceId: string | null;
  promptAr: string;
  fieldType: string;
  options: { valueAr: string }[];
  required: boolean;
}

interface Catalogue {
  services: Service[];
  addons: Addon[];
  rules: Rule[];
  intake: Question[];
}

const UNITS = ["night", "day", "session", "hour", "person", "item"] as const;
const ADDON_MODELS = ["flat", "per_unit", "per_person", "per_km"] as const;
const RULE_KINDS = ["season", "weekday", "lead_time", "duration"] as const;
const FIELD_TYPES = ["text", "number", "choice", "boolean", "date", "phone"] as const;
const WEEKDAYS = [6, 7, 1, 2, 3, 4, 5]; // Saturday-first, the Libyan week

const copy = {
  ar: {
    title: "ما أقدّمه",
    hint: "اكتب هنا خدماتك وأسعارك مرة وحدة — وبعدها كل عرض وكل حجز يطلع منها.",
    empty: "ما عندك خدمات مسجّلة بعد.",
    emptyBody:
      "ابدأ بخدمة وحدة — «ليلة في الشاليه»، «جلسة تصوير»، «باقة قاعة». تقدر تزيد عليها بعدين.",
    // services
    services: "خدماتي",
    addService: "أضف خدمة",
    name: "اسم الخدمة",
    nameEn: "الاسم بالإنجليزي (اختياري)",
    description: "وصف قصير",
    unit: "الوحدة",
    units: {
      night: "بالليلة",
      day: "باليوم",
      session: "بالجلسة",
      hour: "بالساعة",
      person: "بالشخص",
      item: "سعر ثابت",
    },
    unitHint: "كيف تحسب سعرك؟ الشاليه بالليلة، المصوّر بالجلسة، البوفيه بالشخص.",
    price: "السعر (د.ل)",
    minUnits: "أقل عدد",
    maxUnits: "أكثر عدد",
    duration: "المدة (دقيقة)",
    guests: "عدد الأشخاص",
    minGuests: "من",
    maxGuests: "إلى",
    notice: "أقل مهلة (ساعة)",
    noticeHint: "اتركها فاضية لتستعمل مهلة نشاطك العامة.",
    deposit: "العربون (%)",
    capacity: "كم مرة في اليوم",
    includes: "شامل",
    includesHint: "سطر لكل نقطة — «٣ ساعات تصوير»، «الإضاءة»، «ألبوم ٢٠ صفحة».",
    instant: "يحجز مباشرة بدون موافقتك",
    instantHint: "خلّها مقفولة لين تطمّن — الحجز يوصلك للموافقة قبل ما يتأكد.",
    published: "معروضة في تشاو",
    publishedHint: "مقفولة يعني الخدمة عندك في الدفتر بس ما تظهر للزبائن.",
    // preview
    preview: "المحصلة",
    previewHint: "شوف السعر النهائي قبل الزبون.",
    previewUnits: "العدد",
    previewDay: "التاريخ",
    previewGuests: "الأشخاص",
    total: "الإجمالي",
    depositLabel: "العربون",
    // addons
    addons: "الإضافات",
    addonsHint: "الأشياء اللي تنباع مع الخدمة — الشوّاية، الألبوم الزيادة، أجرة الطريق.",
    addAddon: "أضف إضافة",
    addonModels: {
      flat: "مرة وحدة",
      per_unit: "لكل وحدة",
      per_person: "لكل شخص",
      per_km: "لكل كيلومتر",
    },
    required: "إجبارية",
    requiredHint: "الإجبارية تدخل في السعر المعروض — ما تظهر فجأة في آخر خطوة.",
    maxQty: "أكثر كمية",
    forService: "لخدمة معيّنة",
    allServices: "كل الخدمات",
    // rules
    rules: "قواعد السعر",
    rulesHint: "أغسطس أغلى؟ الخميس أغلى؟ اكتبها هنا مرة وتشتغل لحالها.",
    addRule: "أضف قاعدة",
    ruleKinds: {
      season: "موسم",
      weekday: "أيام الأسبوع",
      lead_time: "قرب الموعد",
      duration: "طول المدة",
    },
    label: "الاسم",
    from: "من",
    to: "إلى",
    days: "الأيام",
    dayNames: ["", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"],
    adjust: "التعديل",
    adjustHint: "١٢٠٪ يعني زيادة ٢٠٪. ٩٠٪ يعني خصم ١٠٪.",
    plusFlat: "زيادة ثابتة (د.ل)",
    leadMin: "قبل الموعد بـ (يوم) على الأقل",
    leadMax: "على الأكثر",
    minUnitsRule: "من عدد",
    // intake
    intake: "أسئلة قبل الشغل",
    intakeHint:
      "الأسئلة اللي تسألها في الواتساب كل مرة. اسألها هنا مرة وتوصلك مع الحجز جاهزة.",
    addQuestion: "أضف سؤال",
    prompt: "السؤال",
    fieldType: "نوع الجواب",
    fieldTypes: {
      text: "نص",
      number: "رقم",
      choice: "اختيار",
      boolean: "نعم/لا",
      date: "تاريخ",
      phone: "رقم تلفون",
    },
    options: "الخيارات (سطر لكل خيار)",
    requiredQ: "إجباري",
    // shared
    save: "احفظ",
    saving: "جارٍ الحفظ…",
    cancel: "إلغاء",
    edit: "تعديل",
    remove: "أزل",
    removed: "تمت الإزالة",
    confirmRemove: "تأكيد الإزالة؟ الحجوزات القديمة تبقى كما هي.",
    failed: "تعذر التنفيذ.",
    loading: "لحظة…",
    inactive: "موقوفة",
    draft: "غير معروضة",
    live: "معروضة",
    onlyOwner: "هذي الصفحة لصاحب النشاط أو المدير.",
  },
  en: {
    title: "What I offer",
    hint: "Write your services and prices once — every quote and every booking comes from here.",
    empty: "No services yet.",
    emptyBody:
      "Start with one — \"A night at the chalet\", \"A photo session\", \"Hall package\". You can add more later.",
    services: "My services",
    addService: "Add a service",
    name: "Service name",
    nameEn: "Name in English (optional)",
    description: "Short description",
    unit: "Priced by",
    units: {
      night: "Per night",
      day: "Per day",
      session: "Per session",
      hour: "Per hour",
      person: "Per person",
      item: "Fixed price",
    },
    unitHint: "How do you count? A chalet by the night, a photographer by the session, a buffet by the head.",
    price: "Price (LYD)",
    minUnits: "Minimum",
    maxUnits: "Maximum",
    duration: "Duration (minutes)",
    guests: "People",
    minGuests: "From",
    maxGuests: "To",
    notice: "Notice needed (hours)",
    noticeHint: "Leave empty to use your business-wide notice.",
    deposit: "Deposit (%)",
    capacity: "Times per day",
    includes: "Includes",
    includesHint: "One line each — \"3 hours of shooting\", \"Lighting\", \"20-page album\".",
    instant: "Books instantly without your approval",
    instantHint: "Leave off until you trust it — requests come to you first.",
    published: "Listed on Ciao",
    publishedHint: "Off means it's in your own book but customers can't see it.",
    preview: "The result",
    previewHint: "See the final price before your customer does.",
    previewUnits: "Quantity",
    previewDay: "Date",
    previewGuests: "People",
    total: "Total",
    depositLabel: "Deposit",
    addons: "Extras",
    addonsHint: "The things that sell alongside — the barbecue, the extra album, the travel fee.",
    addAddon: "Add an extra",
    addonModels: {
      flat: "Once",
      per_unit: "Per unit",
      per_person: "Per person",
      per_km: "Per kilometre",
    },
    required: "Required",
    requiredHint: "Required extras are in the headline price — they never appear at the last step.",
    maxQty: "Max quantity",
    forService: "For one service",
    allServices: "All services",
    rules: "Pricing rules",
    rulesHint: "August dearer? Thursdays dearer? Write it once and it applies itself.",
    addRule: "Add a rule",
    ruleKinds: {
      season: "Season",
      weekday: "Days of the week",
      lead_time: "How far ahead",
      duration: "Length of stay",
    },
    label: "Name",
    from: "From",
    to: "To",
    days: "Days",
    dayNames: ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    adjust: "Adjustment",
    adjustHint: "120% means 20% more. 90% means 10% off.",
    plusFlat: "Flat addition (LYD)",
    leadMin: "At least this many days ahead",
    leadMax: "At most",
    minUnitsRule: "From this many",
    intake: "Questions before the job",
    intakeHint:
      "The things you ask on WhatsApp every time. Ask them here once and the answers arrive with the booking.",
    addQuestion: "Add a question",
    prompt: "Question",
    fieldType: "Answer type",
    fieldTypes: {
      text: "Text",
      number: "Number",
      choice: "Choice",
      boolean: "Yes/No",
      date: "Date",
      phone: "Phone number",
    },
    options: "Options (one per line)",
    requiredQ: "Required",
    save: "Save",
    saving: "Saving…",
    cancel: "Cancel",
    edit: "Edit",
    remove: "Remove",
    removed: "Removed",
    confirmRemove: "Remove this? Past bookings stay exactly as they were.",
    failed: "Could not do that.",
    loading: "One moment…",
    inactive: "Stopped",
    draft: "Not listed",
    live: "Listed",
    onlyOwner: "This page is for the owner or a manager.",
  },
} satisfies Record<Locale, unknown>;

const money = (dirhams: number, locale: Locale) => fmtLyd(dirhams, locale);
/** Dirhams ↔ dinars at the form boundary. Partners type dinars, we store minor units. */
const toDirhams = (dinars: string) => Math.max(0, Math.round(Number(dinars || 0) * 1000));
const toDinars = (dirhams: number) => String(Math.round(dirhams / 1000));

export function CatalogueTab({ me }: { me: PartnerMe }) {
  const locale = useLocale();
  const c = copy[locale];
  const scope = me.partnerId ? `?partnerId=${me.partnerId}` : "";

  const [data, setData] = useState<Catalogue | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Service | "new" | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<Catalogue>(`/v1/partner/catalogue${scope}`);
      setData(res);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? c.onlyOwner : c.failed);
    }
  }, [scope, c.onlyOwner, c.failed]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="card p-4 text-sm text-muted">{error}</p>;
  if (!data) return <p className="p-4 text-faint">{c.loading}</p>;

  const live = data.services.filter((s) => s.active);

  return (
    <>
      <Section title={c.title} hint={c.hint}>
        {live.length === 0 ? (
          <div className="text-center py-6">
            <p className="font-bold text-sea">{c.empty}</p>
            <p className="text-sm text-faint mt-1 max-w-sm mx-auto">{c.emptyBody}</p>
            <button className="btn-primary !py-2 !text-sm mt-4" onClick={() => setEditing("new")}>
              {c.addService}
            </button>
          </div>
        ) : (
          <>
            <ul className="space-y-2">
              {live.map((s) => (
                <li key={s.id} className="rounded-2xl bg-sand p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-sea truncate">
                        <Authored locale={locale} ar={s.nameAr} en={s.nameEn} />{" "}
                        {s.published ? (
                          <Pill tone="green">{c.live}</Pill>
                        ) : (
                          <Pill tone="slate">{c.draft}</Pill>
                        )}
                      </p>
                      <p className="text-[11px] text-muted mt-0.5">
                        {money(s.basePrice, locale)} · {c.units[s.unit as keyof typeof c.units]}
                        {s.minUnits > 1 ? ` · ${c.minUnits} ${s.minUnits}` : ""}
                      </p>
                    </div>
                    <button
                      className="text-xs font-bold text-link underline shrink-0"
                      onClick={() => setEditing(s)}
                    >
                      {c.edit}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <button className="btn-primary !py-2 !text-sm mt-3" onClick={() => setEditing("new")}>
              {c.addService}
            </button>
          </>
        )}
      </Section>

      {editing ? (
        <ServiceEditor
          me={me}
          service={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      ) : null}

      <AddonsPanel me={me} data={data} onChanged={load} />
      <RulesPanel me={me} data={data} onChanged={load} />
      <IntakePanel me={me} data={data} onChanged={load} />

      {/*
        The teaser sits at the bottom of the catalogue rather than the top,
        because a partner who has just written down their prices is exactly the
        person who wants to know whether they are the right prices — and that
        question is the product Plus sells. Placing it before they have built
        anything would be selling analytics to somebody with nothing to
        analyse.
      */}
      <PlusTeaser
        me={me}
        panel="catalogue_benchmark"
        titleAr="أسعارك مقارنة بالسوق"
        titleEn="Your prices against the market"
        bodyAr="تشاو بلس يوريك متوسط أسعار منطقتك لنفس نوع الخدمة، ومتى يرتفع الطلب — عشان تسعّر بمعلومة مش بتخمين."
        bodyEn="Ciao Plus shows the average price in your area for the same kind of service, and when demand actually peaks — so you price on information rather than a guess."
      />
    </>
  );
}

// ═══════════════════════════════ service editor ═════════════════════════════
/**
 * One form for six kinds of business.
 *
 * The unit picker is the first field for a reason: everything below it changes
 * meaning once it is chosen, and a form that asks for "minimum nights" of a
 * make-up artist has already told her this product was not built for her.
 */
function ServiceEditor({
  me,
  service,
  onClose,
  onSaved,
}: {
  me: PartnerMe;
  service: Service | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const locale = useLocale();
  const c = copy[locale];
  const scope = me.partnerId ? `?partnerId=${me.partnerId}` : "";

  const [f, setF] = useState({
    nameAr: service?.nameAr ?? "",
    nameEn: service?.nameEn ?? "",
    descriptionAr: service?.descriptionAr ?? "",
    unit: service?.unit ?? (me.profile.kind === "venue" ? "night" : "session"),
    basePrice: service ? toDinars(service.basePrice) : "",
    minUnits: String(service?.minUnits ?? 1),
    maxUnits: service?.maxUnits ? String(service.maxUnits) : "",
    durationMinutes: service?.durationMinutes ? String(service.durationMinutes) : "",
    minGuests: service?.minGuests ? String(service.minGuests) : "",
    maxGuests: service?.maxGuests ? String(service.maxGuests) : "",
    noticeHours: service?.noticeHours != null ? String(service.noticeHours) : "",
    depositBps: service?.depositBps != null ? String(service.depositBps / 100) : "",
    dailyCapacity: service?.dailyCapacity ? String(service.dailyCapacity) : "",
    includesAr: (service?.includesAr ?? []).join("\n"),
    instantBook: service?.instantBook ?? false,
    published: service?.published ?? false,
    listingId: service?.listingId ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const counted = f.unit !== "night" && f.unit !== "day";

  async function save() {
    setBusy(true);
    setError("");
    const payload = {
      nameAr: f.nameAr.trim(),
      nameEn: f.nameEn.trim() || null,
      descriptionAr: f.descriptionAr.trim() || null,
      unit: f.unit,
      basePrice: toDirhams(f.basePrice),
      minUnits: Math.max(1, Number(f.minUnits) || 1),
      maxUnits: f.maxUnits ? Number(f.maxUnits) : null,
      durationMinutes: f.durationMinutes ? Number(f.durationMinutes) : null,
      minGuests: f.minGuests ? Number(f.minGuests) : null,
      maxGuests: f.maxGuests ? Number(f.maxGuests) : null,
      noticeHours: f.noticeHours === "" ? null : Number(f.noticeHours),
      // The partner types a percentage; the wire wants basis points.
      depositBps: f.depositBps === "" ? null : Math.round(Number(f.depositBps) * 100),
      dailyCapacity: f.dailyCapacity ? Number(f.dailyCapacity) : null,
      includesAr: f.includesAr.split("\n").map((l) => l.trim()).filter(Boolean),
      instantBook: f.instantBook,
      published: f.published,
      listingId: f.listingId || null,
    };
    try {
      await api(
        service ? `/v1/partner/services/${service.id}${scope}` : `/v1/partner/services${scope}`,
        { method: service ? "PATCH" : "POST", body: JSON.stringify(payload) },
      );
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? c.failed : c.failed);
      setBusy(false);
    }
  }

  async function remove() {
    if (!service || !window.confirm(c.confirmRemove)) return;
    setBusy(true);
    try {
      await api(`/v1/partner/services/${service.id}${scope}`, { method: "DELETE" });
      onSaved();
    } catch {
      setError(c.failed);
      setBusy(false);
    }
  }

  return (
    <Section
      title={service ? service.nameAr : c.addService}
      titleLang={service ? "ar" : undefined}
      action={
        <button className="text-xs font-bold text-faint underline" onClick={onClose}>
          {c.cancel}
        </button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={c.name} className="sm:col-span-2">
          <input className="input !py-2 !text-sm" value={f.nameAr} onChange={(e) => set("nameAr", e.target.value)} />
        </Field>
        <Field label={c.nameEn}>
          <input className="input !py-2 !text-sm" dir="ltr" value={f.nameEn} onChange={(e) => set("nameEn", e.target.value)} />
        </Field>
        <Field label={c.unit} hint={c.unitHint}>
          <select className="input !py-2 !text-sm" value={f.unit} onChange={(e) => set("unit", e.target.value)}>
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {c.units[u]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={c.price}>
          <input
            className="input !py-2 !text-sm"
            inputMode="numeric"
            dir="ltr"
            value={f.basePrice}
            onChange={(e) => set("basePrice", e.target.value)}
          />
        </Field>
        <Field label={c.minUnits}>
          <input className="input !py-2 !text-sm" inputMode="numeric" dir="ltr" value={f.minUnits} onChange={(e) => set("minUnits", e.target.value)} />
        </Field>
        <Field label={c.maxUnits}>
          <input className="input !py-2 !text-sm" inputMode="numeric" dir="ltr" value={f.maxUnits} onChange={(e) => set("maxUnits", e.target.value)} />
        </Field>
        {counted ? (
          <Field label={c.duration}>
            <input className="input !py-2 !text-sm" inputMode="numeric" dir="ltr" value={f.durationMinutes} onChange={(e) => set("durationMinutes", e.target.value)} />
          </Field>
        ) : null}
        <Field label={`${c.guests} — ${c.minGuests}`}>
          <input className="input !py-2 !text-sm" inputMode="numeric" dir="ltr" value={f.minGuests} onChange={(e) => set("minGuests", e.target.value)} />
        </Field>
        <Field label={`${c.guests} — ${c.maxGuests}`}>
          <input className="input !py-2 !text-sm" inputMode="numeric" dir="ltr" value={f.maxGuests} onChange={(e) => set("maxGuests", e.target.value)} />
        </Field>
        <Field label={c.notice} hint={c.noticeHint}>
          <input className="input !py-2 !text-sm" inputMode="numeric" dir="ltr" value={f.noticeHours} onChange={(e) => set("noticeHours", e.target.value)} />
        </Field>
        <Field label={c.deposit}>
          <input className="input !py-2 !text-sm" inputMode="numeric" dir="ltr" value={f.depositBps} onChange={(e) => set("depositBps", e.target.value)} />
        </Field>
        <Field label={c.capacity}>
          <input className="input !py-2 !text-sm" inputMode="numeric" dir="ltr" value={f.dailyCapacity} onChange={(e) => set("dailyCapacity", e.target.value)} />
        </Field>
        <Field label={c.description} className="sm:col-span-2">
          <textarea className="input !py-2 !text-sm" rows={2} value={f.descriptionAr} onChange={(e) => set("descriptionAr", e.target.value)} />
        </Field>
        <Field label={c.includes} hint={c.includesHint} className="sm:col-span-2">
          <textarea className="input !py-2 !text-sm" rows={3} value={f.includesAr} onChange={(e) => set("includesAr", e.target.value)} />
        </Field>

        {me.listings.length > 0 ? (
          <Field label={c.published} hint={c.publishedHint} className="sm:col-span-2">
            <select
              className="input !py-2 !text-sm"
              value={f.listingId}
              onChange={(e) => set("listingId", e.target.value)}
            >
              <option value="">—</option>
              {me.listings.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.titleAr}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        <Toggle
          className="sm:col-span-2"
          checked={f.published}
          onChange={(v) => set("published", v)}
          label={c.published}
          hint={c.publishedHint}
        />
        <Toggle
          className="sm:col-span-2"
          checked={f.instantBook}
          onChange={(v) => set("instantBook", v)}
          label={c.instant}
          hint={c.instantHint}
        />
      </div>

      {service ? <PricePreview me={me} service={service} /> : null}

      {error ? <p className="text-sm font-bold text-[color:rgb(var(--danger))] mt-3">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-2 mt-4">
        <button className="btn-primary !py-2 !px-5 !text-sm" disabled={busy || !f.nameAr.trim()} onClick={() => void save()}>
          {busy ? c.saving : c.save}
        </button>
        {service ? (
          <button className="text-xs font-bold text-[color:rgb(var(--danger))] underline" disabled={busy} onClick={() => void remove()}>
            {c.remove}
          </button>
        ) : null}
      </div>
    </Section>
  );
}

/**
 * The live price, computed by the server.
 *
 * Not a client-side multiplication, on purpose. This is the same endpoint the
 * consumer checkout calls, so what a partner sees here is what a customer will
 * be charged — including every pricing rule that happens to land on the date
 * they typed. A preview that agreed with the partner's arithmetic but not with
 * the server's would be worse than no preview.
 */
function PricePreview({ me, service }: { me: PartnerMe; service: Service }) {
  const locale = useLocale();
  const c = copy[locale];
  const scope = me.partnerId ? `?partnerId=${me.partnerId}` : "";
  const [units, setUnits] = useState(String(service.minUnits));
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [guests, setGuests] = useState(String(service.minGuests ?? 2));
  const [priced, setPriced] = useState<{
    lines: { labelAr: string; kind: string; amount: number }[];
    total: number;
    deposit: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await api<typeof priced>(`/v1/partner/price${scope}`, {
          method: "POST",
          body: JSON.stringify({
            serviceId: service.id,
            units: Number(units) || service.minUnits,
            guests: Number(guests) || 1,
            day,
          }),
        });
        if (!cancelled) setPriced(res);
      } catch {
        if (!cancelled) setPriced(null);
      }
    }, 350); // debounce: this fires on every keystroke of a date field
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [scope, service.id, service.minUnits, units, day, guests]);

  return (
    <div className="rounded-2xl bg-sand p-3 mt-4">
      <p className="text-xs font-extrabold text-sea">{c.preview}</p>
      <p className="text-[11px] text-faint mb-2">{c.previewHint}</p>
      <div className="grid grid-cols-3 gap-2">
        <Field label={c.previewUnits}>
          <input className="input !py-1.5 !text-sm" inputMode="numeric" dir="ltr" value={units} onChange={(e) => setUnits(e.target.value)} />
        </Field>
        <Field label={c.previewDay}>
          <input className="input !py-1.5 !text-sm" type="date" dir="ltr" value={day} onChange={(e) => setDay(e.target.value)} />
        </Field>
        <Field label={c.previewGuests}>
          <input className="input !py-1.5 !text-sm" inputMode="numeric" dir="ltr" value={guests} onChange={(e) => setGuests(e.target.value)} />
        </Field>
      </div>
      {priced ? (
        <div className="mt-3 space-y-1">
          {priced.lines.map((l, i) => (
            <div key={`${l.labelAr}-${i}`} className="flex justify-between text-xs">
              <span className="text-muted" lang="ar" dir="rtl">
                {l.labelAr}
              </span>
              <span className="tabular-nums text-sea">{money(l.amount, locale)}</span>
            </div>
          ))}
          <div className="flex justify-between text-sm font-extrabold pt-1 border-t border-sea/10">
            <span className="text-sea">{c.total}</span>
            <span className="tabular-nums text-sea">{money(priced.total, locale)}</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-faint">{c.depositLabel}</span>
            <span className="tabular-nums text-muted">{money(priced.deposit, locale)}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ══════════════════════════════════ add-ons ═════════════════════════════════
function AddonsPanel({ me, data, onChanged }: { me: PartnerMe; data: Catalogue; onChanged: () => void }) {
  const locale = useLocale();
  const c = copy[locale];
  const scope = me.partnerId ? `?partnerId=${me.partnerId}` : "";
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ nameAr: "", price: "", priceModel: "flat", maxQty: "1", required: false, serviceId: "" });
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    try {
      await api(`/v1/partner/addons${scope}`, {
        method: "POST",
        body: JSON.stringify({
          nameAr: f.nameAr.trim(),
          price: toDirhams(f.price),
          priceModel: f.priceModel,
          maxQty: Number(f.maxQty) || 1,
          required: f.required,
          serviceId: f.serviceId || null,
        }),
      });
      setF({ nameAr: "", price: "", priceModel: "flat", maxQty: "1", required: false, serviceId: "" });
      setOpen(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(c.confirmRemove)) return;
    await api(`/v1/partner/addons/${id}${scope}`, { method: "DELETE" }).catch(() => undefined);
    onChanged();
  }

  const live = data.addons.filter((a) => a.active);

  return (
    <Section
      title={c.addons}
      hint={c.addonsHint}
      action={
        <button className="text-xs font-bold text-link underline" onClick={() => setOpen((v) => !v)}>
          {open ? c.cancel : c.addAddon}
        </button>
      }
    >
      {live.length > 0 ? (
        <ul className="space-y-2">
          {live.map((a) => (
            <li key={a.id} className="rounded-2xl bg-sand p-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-bold text-sea text-sm truncate">
                  <Authored locale={locale} ar={a.nameAr} />{" "}
                  {a.required ? <Pill tone="amber">{c.required}</Pill> : null}
                </p>
                <p className="text-[11px] text-muted">
                  {money(a.price, locale)} · {c.addonModels[a.priceModel as keyof typeof c.addonModels]}
                </p>
              </div>
              <button className="text-xs underline text-faint shrink-0" onClick={() => void remove(a.id)}>
                {c.remove}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {open ? (
        <div className="grid gap-3 sm:grid-cols-2 mt-3">
          <Field label={c.name} className="sm:col-span-2">
            <input className="input !py-2 !text-sm" value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} />
          </Field>
          <Field label={c.price}>
            <input className="input !py-2 !text-sm" inputMode="numeric" dir="ltr" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
          </Field>
          <Field label={c.adjust}>
            <select className="input !py-2 !text-sm" value={f.priceModel} onChange={(e) => setF({ ...f, priceModel: e.target.value })}>
              {ADDON_MODELS.map((m) => (
                <option key={m} value={m}>
                  {c.addonModels[m]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={c.maxQty}>
            <input className="input !py-2 !text-sm" inputMode="numeric" dir="ltr" value={f.maxQty} onChange={(e) => setF({ ...f, maxQty: e.target.value })} />
          </Field>
          <Field label={c.forService}>
            <select className="input !py-2 !text-sm" value={f.serviceId} onChange={(e) => setF({ ...f, serviceId: e.target.value })}>
              <option value="">{c.allServices}</option>
              {data.services.filter((s) => s.active).map((s) => (
                <option key={s.id} value={s.id} lang="ar" dir="rtl">
                  {s.nameAr}
                </option>
              ))}
            </select>
          </Field>
          <Toggle className="sm:col-span-2" checked={f.required} onChange={(v) => setF({ ...f, required: v })} label={c.required} hint={c.requiredHint} />
          <div className="sm:col-span-2">
            <button className="btn-primary !py-2 !px-5 !text-sm" disabled={busy || !f.nameAr.trim()} onClick={() => void add()}>
              {busy ? c.saving : c.save}
            </button>
          </div>
        </div>
      ) : null}
    </Section>
  );
}

// ════════════════════════════════ price rules ═══════════════════════════════
function RulesPanel({ me, data, onChanged }: { me: PartnerMe; data: Catalogue; onChanged: () => void }) {
  const locale = useLocale();
  const c = copy[locale];
  const scope = me.partnerId ? `?partnerId=${me.partnerId}` : "";
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    labelAr: "",
    kind: "season",
    fromDay: "",
    toDay: "",
    weekdays: [] as number[],
    minLeadDays: "",
    maxLeadDays: "",
    minUnits: "",
    adjustPct: "120",
    adjustFlat: "",
    serviceId: "",
  });

  async function add() {
    setBusy(true);
    try {
      await api(`/v1/partner/price-rules${scope}`, {
        method: "POST",
        body: JSON.stringify({
          labelAr: f.labelAr.trim(),
          kind: f.kind,
          serviceId: f.serviceId || null,
          fromDay: f.fromDay || null,
          toDay: f.toDay || null,
          weekdays: f.weekdays,
          minLeadDays: f.minLeadDays === "" ? null : Number(f.minLeadDays),
          maxLeadDays: f.maxLeadDays === "" ? null : Number(f.maxLeadDays),
          minUnits: f.minUnits === "" ? null : Number(f.minUnits),
          // The partner thinks in percent of the price; the engine multiplies
          // in basis points.
          adjustBps: Math.round(Number(f.adjustPct || 100) * 100),
          adjustFlat: toDirhams(f.adjustFlat),
        }),
      });
      setOpen(false);
      setF({ ...f, labelAr: "", fromDay: "", toDay: "", weekdays: [], adjustFlat: "" });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await api(`/v1/partner/price-rules/${id}${scope}`, { method: "DELETE" }).catch(() => undefined);
    onChanged();
  }

  return (
    <Section
      title={c.rules}
      hint={c.rulesHint}
      action={
        <button className="text-xs font-bold text-link underline" onClick={() => setOpen((v) => !v)}>
          {open ? c.cancel : c.addRule}
        </button>
      }
    >
      {data.rules.length > 0 ? (
        <ul className="space-y-2">
          {data.rules.map((r) => (
            <li key={r.id} className="rounded-2xl bg-sand p-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-bold text-sea text-sm truncate">
                  <Authored locale={locale} ar={r.labelAr} />{" "}
                  <Pill tone="slate">{c.ruleKinds[r.kind as keyof typeof c.ruleKinds]}</Pill>
                </p>
                <p className="text-[11px] text-muted tabular-nums" dir="ltr">
                  {(r.adjustBps / 100).toFixed(0)}%
                  {r.adjustFlat ? ` + ${money(r.adjustFlat, locale)}` : ""}
                  {r.fromDay ? ` · ${r.fromDay} → ${r.toDay ?? ""}` : ""}
                </p>
              </div>
              <button className="text-xs underline text-faint shrink-0" onClick={() => void remove(r.id)}>
                {c.remove}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {open ? (
        <div className="grid gap-3 sm:grid-cols-2 mt-3">
          <Field label={c.label} className="sm:col-span-2">
            <input className="input !py-2 !text-sm" value={f.labelAr} onChange={(e) => setF({ ...f, labelAr: e.target.value })} />
          </Field>
          <Field label={c.ruleKinds.season}>
            <select className="input !py-2 !text-sm" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              {RULE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {c.ruleKinds[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={c.adjust} hint={c.adjustHint}>
            <input className="input !py-2 !text-sm" inputMode="numeric" dir="ltr" value={f.adjustPct} onChange={(e) => setF({ ...f, adjustPct: e.target.value })} />
          </Field>

          {f.kind === "season" ? (
            <>
              <Field label={c.from}>
                <input className="input !py-2 !text-sm" type="date" dir="ltr" value={f.fromDay} onChange={(e) => setF({ ...f, fromDay: e.target.value })} />
              </Field>
              <Field label={c.to}>
                <input className="input !py-2 !text-sm" type="date" dir="ltr" value={f.toDay} onChange={(e) => setF({ ...f, toDay: e.target.value })} />
              </Field>
            </>
          ) : null}

          {f.kind === "weekday" ? (
            <div className="sm:col-span-2">
              <span className="text-xs font-bold text-muted">{c.days}</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {WEEKDAYS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() =>
                      setF({
                        ...f,
                        weekdays: f.weekdays.includes(d)
                          ? f.weekdays.filter((x) => x !== d)
                          : [...f.weekdays, d],
                      })
                    }
                    className={`chip !text-xs ${f.weekdays.includes(d) ? "!bg-sea !text-white" : ""}`}
                  >
                    {c.dayNames[d]}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {f.kind === "lead_time" ? (
            <>
              <Field label={c.leadMin}>
                <input className="input !py-2 !text-sm" inputMode="numeric" dir="ltr" value={f.minLeadDays} onChange={(e) => setF({ ...f, minLeadDays: e.target.value })} />
              </Field>
              <Field label={c.leadMax}>
                <input className="input !py-2 !text-sm" inputMode="numeric" dir="ltr" value={f.maxLeadDays} onChange={(e) => setF({ ...f, maxLeadDays: e.target.value })} />
              </Field>
            </>
          ) : null}

          {f.kind === "duration" ? (
            <Field label={c.minUnitsRule}>
              <input className="input !py-2 !text-sm" inputMode="numeric" dir="ltr" value={f.minUnits} onChange={(e) => setF({ ...f, minUnits: e.target.value })} />
            </Field>
          ) : null}

          <Field label={c.plusFlat}>
            <input className="input !py-2 !text-sm" inputMode="numeric" dir="ltr" value={f.adjustFlat} onChange={(e) => setF({ ...f, adjustFlat: e.target.value })} />
          </Field>
          <Field label={c.forService}>
            <select className="input !py-2 !text-sm" value={f.serviceId} onChange={(e) => setF({ ...f, serviceId: e.target.value })}>
              <option value="">{c.allServices}</option>
              {data.services.filter((s) => s.active).map((s) => (
                <option key={s.id} value={s.id} lang="ar" dir="rtl">
                  {s.nameAr}
                </option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <button className="btn-primary !py-2 !px-5 !text-sm" disabled={busy || !f.labelAr.trim()} onClick={() => void add()}>
              {busy ? c.saving : c.save}
            </button>
          </div>
        </div>
      ) : null}
    </Section>
  );
}

// ═════════════════════════════ intake questions ═════════════════════════════
function IntakePanel({ me, data, onChanged }: { me: PartnerMe; data: Catalogue; onChanged: () => void }) {
  const locale = useLocale();
  const c = copy[locale];
  const scope = me.partnerId ? `?partnerId=${me.partnerId}` : "";
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ promptAr: "", fieldType: "text", options: "", required: false, serviceId: "" });

  async function add() {
    setBusy(true);
    try {
      await api(`/v1/partner/intake${scope}`, {
        method: "POST",
        body: JSON.stringify({
          promptAr: f.promptAr.trim(),
          fieldType: f.fieldType,
          options: f.options.split("\n").map((v) => v.trim()).filter(Boolean).map((valueAr) => ({ valueAr })),
          required: f.required,
          serviceId: f.serviceId || null,
        }),
      });
      setF({ promptAr: "", fieldType: "text", options: "", required: false, serviceId: "" });
      setOpen(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await api(`/v1/partner/intake/${id}${scope}`, { method: "DELETE" }).catch(() => undefined);
    onChanged();
  }

  return (
    <Section
      title={c.intake}
      hint={c.intakeHint}
      action={
        <button className="text-xs font-bold text-link underline" onClick={() => setOpen((v) => !v)}>
          {open ? c.cancel : c.addQuestion}
        </button>
      }
    >
      {data.intake.length > 0 ? (
        <ul className="space-y-2">
          {data.intake.map((q) => (
            <li key={q.id} className="rounded-2xl bg-sand p-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-bold text-sea text-sm truncate">
                  <Authored locale={locale} ar={q.promptAr} />{" "}
                  {q.required ? <Pill tone="amber">{c.requiredQ}</Pill> : null}
                </p>
                <p className="text-[11px] text-muted">
                  {c.fieldTypes[q.fieldType as keyof typeof c.fieldTypes]}
                </p>
              </div>
              <button className="text-xs underline text-faint shrink-0" onClick={() => void remove(q.id)}>
                {c.remove}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {open ? (
        <div className="grid gap-3 sm:grid-cols-2 mt-3">
          <Field label={c.prompt} className="sm:col-span-2">
            <input className="input !py-2 !text-sm" value={f.promptAr} onChange={(e) => setF({ ...f, promptAr: e.target.value })} />
          </Field>
          <Field label={c.fieldType}>
            <select className="input !py-2 !text-sm" value={f.fieldType} onChange={(e) => setF({ ...f, fieldType: e.target.value })}>
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {c.fieldTypes[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={c.forService}>
            <select className="input !py-2 !text-sm" value={f.serviceId} onChange={(e) => setF({ ...f, serviceId: e.target.value })}>
              <option value="">{c.allServices}</option>
              {data.services.filter((s) => s.active).map((s) => (
                <option key={s.id} value={s.id} lang="ar" dir="rtl">
                  {s.nameAr}
                </option>
              ))}
            </select>
          </Field>
          {f.fieldType === "choice" ? (
            <Field label={c.options} className="sm:col-span-2">
              <textarea className="input !py-2 !text-sm" rows={3} value={f.options} onChange={(e) => setF({ ...f, options: e.target.value })} />
            </Field>
          ) : null}
          <Toggle className="sm:col-span-2" checked={f.required} onChange={(v) => setF({ ...f, required: v })} label={c.requiredQ} />
          <div className="sm:col-span-2">
            <button className="btn-primary !py-2 !px-5 !text-sm" disabled={busy || !f.promptAr.trim()} onClick={() => void add()}>
              {busy ? c.saving : c.save}
            </button>
          </div>
        </div>
      ) : null}
    </Section>
  );
}

// ─────────────────────────────── small pieces ───────────────────────────────
/**
 * Partner-authored text, declared as whatever language it actually is.
 *
 * Most of what a partner types has no English twin and never will — they wrote
 * it once, in Arabic, about their own business. Rendering it undeclared inside
 * an English page is the defect `locale-audit` exists to catch.
 */
function Authored({
  locale,
  ar,
  en,
}: {
  locale: Locale;
  ar: string | null | undefined;
  en?: string | null;
}) {
  const t = hostText(locale, ar, en);
  if (!t) return null;
  return <span {...textProps(t)}>{t.text}</span>;
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

/**
 * A switch with its consequence written underneath.
 *
 * Every toggle on this screen changes what a customer can do — book without
 * asking, see a price, be charged a fee. A label alone ("Instant booking")
 * tells a partner what the control is called; the hint tells them what happens
 * to their Thursday, which is the thing they are actually deciding.
 */
function Toggle({
  checked,
  onChange,
  label,
  hint,
  className = "",
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  className?: string;
}) {
  return (
    <label className={`flex items-start gap-3 cursor-pointer ${className}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0 rounded accent-[color:rgb(var(--sea))]"
      />
      <span className="min-w-0">
        <span className="block text-sm font-bold text-sea">{label}</span>
        {hint ? <span className="block text-[11px] text-faint mt-0.5">{hint}</span> : null}
      </span>
    </label>
  );
}
