"use client";
/**
 * Catalogue — every business on the platform, and how a new one gets added.
 *
 * Onboarding is one form, not three: host account, place, and listing are
 * created together, because a venue with no host or a host who can't log in
 * is the kind of orphan record that costs a supply team a whole afternoon.
 * The listing lands as a draft — publishing is deliberate and requires a
 * field visit plus photos (§11.2, §8.3).
 *
 * The intake form stays Arabic-only on purpose. Everything typed into it is
 * content for Libyan guests, written by the person who visited the place; a
 * bilingual intake form would invite an operator to write the listing itself
 * in English, which is not what the public site needs. English copy is added
 * afterwards, per listing, in the editor below.
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import type { Locale } from "@/lib/i18n";
import {
  AREAS,
  CITIES,
  LISTING_STATUS,
  SERVICE_CATEGORY_LABELS,
  VERTICALS,
  term,
} from "@/lib/vocab";
import { Money, Pill, Section } from "./lib";
import { MediaManager } from "./media";

export interface BizListing {
  listingId: string;
  slug: string;
  titleAr: string;
  titleEn: string | null;
  status: string;
  vertical: string;
  serviceCategory: string | null;
  venueNameAr: string;
  city: string;
  area: string | null;
  verified: boolean;
  host: { id: string; phone: string; name: string | null } | null;
  reliability: number | null;
  baseNightly: number;
  mediaCount: number;
  bookings: number;
  gmv: number;
  reviewCount: number;
  disputeCount: number;
}

const CITY_KEYS = ["tripoli", "misrata", "benghazi", "zawiya", "khoms"] as const;
const SERVICE_KEYS = ["catering", "photography", "makeup", "hair", "cakes", "gym"] as const;
const STATUS_KEYS = ["draft", "live", "paused", "delisted"] as const;

const EMPTY_FORM = {
  vertical: "coast" as "coast" | "hall" | "service",
  serviceCategory: "catering",
  hostPhone: "",
  hostName: "",
  venueNameAr: "",
  city: "tripoli",
  area: "",
  addressAr: "",
  slug: "",
  titleAr: "",
  descriptionAr: "",
  baseNightly: "",
  maxGuests: "",
  bedrooms: "",
  capacityWomens: "",
  familyOnly: false,
  cancellationTier: "moderate" as "flexible" | "moderate" | "strict",
};

const copy = {
  ar: {
    all: "الكل",
    allStatuses: "كل الحالات",
    searchPlaceholder: "بحث بالاسم أو الرمز",
    cancel: "إلغاء",
    addBusiness: "+ إضافة نشاط",
    loadFailed: "تعذر تحميل القائمة",
    added: (slug: string, next: string) => `✅ أُضيف «${slug}» كمسودة — ${next}`,
    addFailed: (why: string) => `تعذر الإضافة: ${why}`,
    addFailedPlain: "تعذر الإضافة",
    unverified: "لا يمكن النشر قبل المعاينة الميدانية واعتماد المكان (§11.2)",
    needsMedia: "لا يمكن النشر بدون صور — أضف الصور أولًا",
    statusFailed: "تعذر تغيير الحالة",
    addTitle: "إضافة نشاط جديد",
    addIntro:
      "يُنشأ حساب المضيف والمكان والإعلان معًا. يبدأ الإعلان كمسودة — لا يُنشر إلا بعد المعاينة الميدانية وإضافة الصور.",
    fType: "نوع النشاط",
    tCoast: "شاليه / استراحة",
    tHall: "قاعة أفراح",
    tService: "خدمة",
    fServiceCategory: "فئة الخدمة",
    fCancellation: "سياسة الإلغاء",
    flexible: "مرنة",
    moderate: "متوسطة",
    strict: "صارمة",
    fHostPhone: "هاتف المضيف",
    fHostName: "اسم المضيف",
    fVenueName: "اسم المكان",
    fCity: "المدينة",
    fArea: "المنطقة",
    fTitleAr: "عنوان الإعلان (عربي)",
    fSlug: "الرمز في الرابط",
    suggest: "اقترح",
    fBasePrice: "السعر الأساسي (د.ل)",
    fWomensCapacity: "سعة القسم النسائي",
    fMaxGuests: "أقصى عدد ضيوف",
    fBedrooms: "عدد الغرف",
    fDescription: "الوصف",
    familyOnly: "عائلات فقط",
    saving: "جارٍ الحفظ…",
    saveDraft: "أضف كمسودة",
    colBusiness: "النشاط",
    colType: "النوع",
    colStatus: "الحالة",
    colPhotos: "الصور",
    colBookings: "حجوزات",
    colValue: "القيمة",
    colReviews: "التقييمات",
    noHost: " · بلا مضيف",
    notVerified: "غير موثّق",
    disputes: (n: number) => ` · ${n} شكوى`,
    noResults: "لا نتائج",
    englishSet: "EN ✓",
    englishMissing: "EN —",
    englishTitleFor: (name: string) => `النص الإنجليزي: ${name}`,
    editorIntro:
      "اختياري. يظهر هذا النص لزوار النسخة الإنجليزية فقط. إن تركته فارغًا شافوا العربي كما هو، مكتوبًا بلغته — وهذا مقبول تمامًا، أفضل من ترجمة آلية غير مراجعة.",
    arabicNow: "العربي المنشور حاليًا",
    fTitleEn: "العنوان بالإنجليزية (اختياري)",
    fDescriptionEn: "الوصف بالإنجليزية (اختياري)",
    locButton: "📍 الموقع",
    locTitleFor: (name: string) => `الموقع: ${name}`,
    locLead:
      "هذا قرار المزوّدة، مش قرارك. اسألها، سجّل اللي تقوله، وخلاص. أغلب من يعرضن خدماتهن على تشاو نساء يشتغلن من بيوتهن — نشر موقع بيت مش شي بسيط، ومش من حقنا ننشره نيابة عنها.",
    locWarn:
      "لو مش متأكد، خلّيها كما هي. «المنطقة فقط» هو الخيار الآمن — ما حدش اشتكى يومًا إنه صعب يتلقّى، والعكس ما ينفعش يترجع.",
    locArea: "المنطقة فقط — بلا موقع على الخريطة، أبدًا",
    locAreaBody:
      "الزبون يشوف الحي وبس، ولا شي أدق من هذا. هي ترسل موقعها بنفسها بعد ما تتفق على الشغل. المكان يبقى يظهر في البحث وفي البحث بالرسم على الخريطة — تتلقّى ولا تتحدد.",
    locStaged: "مرحلي — موقع تقريبي الآن، والدقيق بعد العربون",
    locStagedBody:
      "دائرة تقريبية على الخريطة العامة. الموقع الدقيق والعنوان المكتوب يظهران لحظة دفع العربون.",
    locPublic: "عام — موقع يشوفه أي حد",
    locPublicBody:
      "للمكان اللي عنده واجهة على الشارع: صالون، استوديو، قاعة على طريق رئيسي. ولا تختارها إلا إذا طلبها صاحب المكان بنفسه.",
    locDefaultFor: "الوضع الافتراضي لهذا النوع",
    locCurrent: "المسجّل حاليًا",
    locSaved: "✅ حُفظ",
    locNotAccepted:
      "لم يُحفظ — الواجهة البرمجية ما زالت لا تقبل هذا الحقل. لا تخبر صاحب المكان أنه تغيّر.",
    locSaveFailed: "تعذر الحفظ",
    editorLoadFailed: "تعذر تحميل الإعلان",
    editorSaved: "✅ حُفظ النص الإنجليزي",
    editorCleared: "✅ حُذف النص الإنجليزي — الزوار الإنجليز يشوفون العربي",
    editorSaveFailed: "تعذر الحفظ",
    save: "حفظ",
    close: "إغلاق",
    loading: "جارٍ التحميل…",
  },
  en: {
    all: "All",
    allStatuses: "All statuses",
    searchPlaceholder: "Search by name or slug",
    cancel: "Cancel",
    addBusiness: "+ Add business",
    loadFailed: "Could not load the list",
    added: (slug: string, next: string) => `✅ Added "${slug}" as a draft — ${next}`,
    addFailed: (why: string) => `Could not add: ${why}`,
    addFailedPlain: "Could not add",
    unverified: "Cannot publish before the field visit and venue sign-off (§11.2)",
    needsMedia: "Cannot publish without photos — add photos first",
    statusFailed: "Could not change the status",
    addTitle: "Add a business",
    addIntro:
      "The host account, the venue and the listing are created together. The listing starts as a draft — it only goes live after the field visit and photos.",
    fType: "Type",
    tCoast: "Chalet / estiraha",
    tHall: "Wedding hall",
    tService: "Service",
    fServiceCategory: "Service category",
    fCancellation: "Cancellation policy",
    flexible: "Flexible",
    moderate: "Moderate",
    strict: "Strict",
    fHostPhone: "Host phone",
    fHostName: "Host name",
    fVenueName: "Venue name",
    fCity: "City",
    fArea: "Area",
    fTitleAr: "Listing title (Arabic)",
    fSlug: "URL slug",
    suggest: "Suggest",
    fBasePrice: "Base price (LYD)",
    fWomensCapacity: "Women's section capacity",
    fMaxGuests: "Maximum guests",
    fBedrooms: "Bedrooms",
    fDescription: "Description",
    familyOnly: "Families only",
    saving: "Saving…",
    saveDraft: "Add as draft",
    colBusiness: "Business",
    colType: "Type",
    colStatus: "Status",
    colPhotos: "Photos",
    colBookings: "Bookings",
    colValue: "Value",
    colReviews: "Reviews",
    noHost: " · no host",
    notVerified: "Not verified",
    disputes: (n: number) => ` · ${n} disputes`,
    noResults: "No results",
    englishSet: "EN ✓",
    englishMissing: "EN —",
    englishTitleFor: (name: string) => `English copy: ${name}`,
    editorIntro:
      "Optional. This text is shown to visitors reading the English site only. Leave it empty and they see the Arabic as written, marked as Arabic — which is fine, and better than an unreviewed machine translation.",
    arabicNow: "Arabic currently published",
    fTitleEn: "English title (optional)",
    fDescriptionEn: "English description (optional)",
    locButton: "📍 Location",
    locTitleFor: (name: string) => `Location: ${name}`,
    locLead:
      "This is the provider's decision, not yours. Ask her, set what she tells you, and leave it there. Most of the people selling services on Ciao are women working out of their own homes — putting a pin on someone's home is not a small thing, and it is not ours to do on her behalf.",
    locWarn:
      "If you are not sure, leave it as it is. Area only is the safe answer — nobody has ever complained about being hard to find, and a published address cannot be taken back.",
    locArea: "Area only — never a pin",
    locAreaBody:
      "The customer sees the neighbourhood and nothing finer. She sends her exact location herself, once she has agreed the job. The place still turns up in search and inside a hand-drawn area — findable without being locatable.",
    locStaged: "Staged — an approximate pin now, the exact one after the deposit",
    locStagedBody:
      "A rough circle on the public map. The exact pin and the written address appear the moment the guest pays the deposit.",
    locPublic: "Public — a pin anyone can see",
    locPublicBody:
      "For a place with a shopfront: a salon, a studio, a hall on a main road. Only pick this if the provider has asked for it.",
    locDefaultFor: "The default for this type of venue",
    locCurrent: "Currently set to",
    locSaved: "✅ Saved",
    locNotAccepted:
      "Not saved — the API does not accept this field yet. Do not tell the provider it has changed.",
    locSaveFailed: "Could not save",
    editorLoadFailed: "Could not load the listing",
    editorSaved: "✅ English copy saved",
    editorCleared: "✅ English copy cleared — English visitors will see the Arabic",
    editorSaveFailed: "Could not save",
    save: "Save",
    close: "Close",
    loading: "Loading…",
  },
} satisfies Record<Locale, unknown>;

export function CatalogueTab() {
  const locale = useLocale();
  const c = copy[locale];
  const [items, setItems] = useState<BizListing[]>([]);
  const [type, setType] = useState<"all" | "coast" | "hall" | "service">("all");
  const [status, setStatus] = useState<"all" | "draft" | "live" | "paused" | "delisted">("all");
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [mediaFor, setMediaFor] = useState<BizListing | null>(null);
  const [englishFor, setEnglishFor] = useState<BizListing | null>(null);
  const [locationFor, setLocationFor] = useState<BizListing | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const q = new URLSearchParams({ type, status });
    if (search) q.set("search", search);
    try {
      setItems((await api<{ items: BizListing[] }>(`/v1/biz/businesses?${q}`)).items);
    } catch {
      setMsg(copy[locale].loadFailed);
    }
  }, [type, status, search, locale]);

  useEffect(() => {
    void load();
  }, [load]);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  /** Arabic titles don't make ASCII slugs — offer one, let the operator edit. */
  function suggestSlug() {
    const base = `${form.city}-${form.vertical}-${Date.now().toString(36).slice(-4)}`;
    set("slug", base);
  }

  async function submit() {
    setBusy(true);
    setMsg("");
    try {
      const payload: Record<string, unknown> = {
        vertical: form.vertical,
        hostPhone: form.hostPhone,
        hostName: form.hostName,
        venueNameAr: form.venueNameAr,
        city: form.city,
        slug: form.slug,
        titleAr: form.titleAr,
        familyOnly: form.familyOnly,
        cancellationTier: form.cancellationTier,
        baseNightly: form.baseNightly ? Number(form.baseNightly) * 1000 : 0,
      };
      if (form.vertical === "service") payload.serviceCategory = form.serviceCategory;
      if (form.area) payload.area = form.area;
      if (form.addressAr) payload.addressAr = form.addressAr;
      if (form.descriptionAr) payload.descriptionAr = form.descriptionAr;
      if (form.maxGuests) payload.maxGuests = Number(form.maxGuests);
      if (form.bedrooms) payload.bedrooms = Number(form.bedrooms);
      if (form.capacityWomens) payload.capacityWomens = Number(form.capacityWomens);

      const res = await api<{ slug: string; next: string }>("/v1/biz/businesses", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setMsg(c.added(res.slug, res.next));
      setForm(EMPTY_FORM);
      setAdding(false);
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError ? c.addFailed(e.message) : c.addFailedPlain);
    } finally {
      setBusy(false);
    }
  }

  async function setStatusOf(l: BizListing, next: string) {
    setMsg("");
    try {
      await api(`/v1/biz/listings/${l.listingId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      await load();
    } catch (e) {
      const code = e instanceof ApiError ? e.message : "";
      setMsg(
        code.includes("unverified")
          ? c.unverified
          : code.includes("media")
            ? c.needsMedia
            : c.statusFailed,
      );
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {(["all", "coast", "hall", "service"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`chip ${type === t ? "!bg-sea !text-white" : ""}`}
          >
            {t === "all" ? c.all : term(VERTICALS, locale, t)}
          </button>
        ))}
        <select
          className="chip !py-1"
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
        >
          <option value="all">{c.allStatuses}</option>
          {STATUS_KEYS.map((k) => (
            <option key={k} value={k}>
              {term(LISTING_STATUS, locale, k)}
            </option>
          ))}
        </select>
        <input
          className="input !py-1.5 !text-sm max-w-[200px]"
          placeholder={c.searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="btn-amber !py-1.5 !px-4 !text-sm" onClick={() => setAdding((a) => !a)}>
          {adding ? c.cancel : c.addBusiness}
        </button>
      </div>

      {msg ? <p className="mb-3 text-sm font-bold text-sea">{msg}</p> : null}

      {adding ? (
        <Section title={c.addTitle}>
          <p className="text-xs text-faint mb-3">{c.addIntro}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            <label className="block text-xs font-bold text-muted">
              {c.fType}
              <select
                className="input !py-2 !text-sm mt-1"
                value={form.vertical}
                onChange={(e) => set("vertical", e.target.value as typeof form.vertical)}
              >
                <option value="coast">{c.tCoast}</option>
                <option value="hall">{c.tHall}</option>
                <option value="service">{c.tService}</option>
              </select>
            </label>
            {form.vertical === "service" ? (
              <label className="block text-xs font-bold text-muted">
                {c.fServiceCategory}
                <select
                  className="input !py-2 !text-sm mt-1"
                  value={form.serviceCategory}
                  onChange={(e) => set("serviceCategory", e.target.value)}
                >
                  {SERVICE_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {term(SERVICE_CATEGORY_LABELS, locale, k)}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="block text-xs font-bold text-muted">
                {c.fCancellation}
                <select
                  className="input !py-2 !text-sm mt-1"
                  value={form.cancellationTier}
                  onChange={(e) =>
                    set("cancellationTier", e.target.value as typeof form.cancellationTier)
                  }
                >
                  <option value="flexible">{c.flexible}</option>
                  <option value="moderate">{c.moderate}</option>
                  <option value="strict">{c.strict}</option>
                </select>
              </label>
            )}
            <label className="block text-xs font-bold text-muted">
              {c.fHostPhone}
              <input
                className="input !py-2 !text-sm mt-1"
                dir="ltr"
                placeholder="09XXXXXXXX"
                value={form.hostPhone}
                onChange={(e) => set("hostPhone", e.target.value)}
              />
            </label>
            <label className="block text-xs font-bold text-muted">
              {c.fHostName}
              <input
                className="input !py-2 !text-sm mt-1"
                value={form.hostName}
                onChange={(e) => set("hostName", e.target.value)}
              />
            </label>
            <label className="block text-xs font-bold text-muted">
              {c.fVenueName}
              <input
                className="input !py-2 !text-sm mt-1"
                dir="rtl"
                lang="ar"
                value={form.venueNameAr}
                onChange={(e) => set("venueNameAr", e.target.value)}
              />
            </label>
            <label className="block text-xs font-bold text-muted">
              {c.fCity}
              <select
                className="input !py-2 !text-sm mt-1"
                value={form.city}
                onChange={(e) => set("city", e.target.value)}
              >
                {CITY_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {term(CITIES, locale, k)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-bold text-muted">
              {c.fArea}
              <input
                className="input !py-2 !text-sm mt-1"
                placeholder="janzour"
                dir="ltr"
                value={form.area}
                onChange={(e) => set("area", e.target.value)}
              />
            </label>
            <label className="block text-xs font-bold text-muted">
              {c.fTitleAr}
              <input
                className="input !py-2 !text-sm mt-1"
                dir="rtl"
                lang="ar"
                value={form.titleAr}
                onChange={(e) => set("titleAr", e.target.value)}
              />
            </label>
            <label className="block text-xs font-bold text-muted">
              {c.fSlug}
              <div className="flex gap-1 mt-1">
                <input
                  className="input !py-2 !text-sm"
                  dir="ltr"
                  placeholder="janzour-villa"
                  value={form.slug}
                  onChange={(e) => set("slug", e.target.value)}
                />
                <button className="chip shrink-0" onClick={suggestSlug} type="button">
                  {c.suggest}
                </button>
              </div>
            </label>
            <label className="block text-xs font-bold text-muted">
              {c.fBasePrice}
              <input
                className="input !py-2 !text-sm mt-1"
                inputMode="numeric"
                value={form.baseNightly}
                onChange={(e) => set("baseNightly", e.target.value)}
              />
            </label>
            {form.vertical === "hall" ? (
              <label className="block text-xs font-bold text-muted">
                {c.fWomensCapacity}
                <input
                  className="input !py-2 !text-sm mt-1"
                  inputMode="numeric"
                  value={form.capacityWomens}
                  onChange={(e) => set("capacityWomens", e.target.value)}
                />
              </label>
            ) : form.vertical === "coast" ? (
              <>
                <label className="block text-xs font-bold text-muted">
                  {c.fMaxGuests}
                  <input
                    className="input !py-2 !text-sm mt-1"
                    inputMode="numeric"
                    value={form.maxGuests}
                    onChange={(e) => set("maxGuests", e.target.value)}
                  />
                </label>
                <label className="block text-xs font-bold text-muted">
                  {c.fBedrooms}
                  <input
                    className="input !py-2 !text-sm mt-1"
                    inputMode="numeric"
                    value={form.bedrooms}
                    onChange={(e) => set("bedrooms", e.target.value)}
                  />
                </label>
              </>
            ) : null}
            <label className="block text-xs font-bold text-muted sm:col-span-2">
              {c.fDescription}
              <textarea
                className="input !py-2 !text-sm mt-1 h-20"
                dir="rtl"
                lang="ar"
                value={form.descriptionAr}
                onChange={(e) => set("descriptionAr", e.target.value)}
              />
            </label>
            {form.vertical === "coast" ? (
              <label className="flex items-center gap-2 text-xs font-bold text-muted">
                <input
                  type="checkbox"
                  checked={form.familyOnly}
                  onChange={(e) => set("familyOnly", e.target.checked)}
                />
                {c.familyOnly}
              </label>
            ) : null}
          </div>
          <button
            className="btn-primary !py-2 !text-sm mt-3"
            disabled={busy || !form.hostPhone || !form.slug || !form.titleAr || !form.venueNameAr}
            onClick={submit}
          >
            {busy ? c.saving : c.saveDraft}
          </button>
        </Section>
      ) : null}

      <div className="card mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-sand/60 text-muted">
            <tr>
              <th className="text-start p-2">{c.colBusiness}</th>
              <th className="text-start p-2">{c.colType}</th>
              <th className="text-start p-2">{c.colStatus}</th>
              <th className="text-start p-2">{c.colPhotos}</th>
              <th className="text-start p-2">{c.colBookings}</th>
              <th className="text-start p-2">{c.colValue}</th>
              <th className="text-start p-2">{c.colReviews}</th>
              <th className="text-start p-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((l) => (
              <tr key={l.listingId} className="border-t border-sand align-top">
                <td className="p-2">
                  {/* The listing title is Arabic content even on the English
                      console — tag it so it renders and is read correctly. */}
                  <div className="font-bold text-sea" lang="ar" dir="rtl">
                    {l.titleAr}
                  </div>
                  {l.titleEn ? (
                    <div className="text-[11px] text-muted" lang="en" dir="ltr">
                      {l.titleEn}
                    </div>
                  ) : null}
                  <div className="text-[11px] text-faint">
                    {l.venueNameAr} ·{" "}
                    {l.area ? term(AREAS, locale, l.area) : term(CITIES, locale, l.city)}
                    {l.host ? ` · ${l.host.name ?? l.host.phone}` : c.noHost}
                  </div>
                </td>
                <td className="p-2">{term(VERTICALS, locale, l.vertical)}</td>
                <td className="p-2">
                  <Pill
                    tone={l.status === "live" ? "green" : l.status === "draft" ? "sand" : "slate"}
                  >
                    {term(LISTING_STATUS, locale, l.status)}
                  </Pill>
                  {!l.verified ? (
                    <div className="mt-1">
                      <Pill tone="red">{c.notVerified}</Pill>
                    </div>
                  ) : null}
                </td>
                <td className="p-2">
                  <button
                    className={`chip !text-[11px] ${l.mediaCount === 0 ? "badge-danger" : ""}`}
                    onClick={() => setMediaFor(l)}
                  >
                    🖼 {l.mediaCount}
                  </button>
                </td>
                <td className="p-2 tabular-nums">{l.bookings}</td>
                <td className="p-2">
                  <Money dirhams={l.gmv} />
                </td>
                <td className="p-2 tabular-nums">
                  {l.reviewCount}
                  {l.disputeCount ? (
                    <span className="text-danger">{c.disputes(l.disputeCount)}</span>
                  ) : null}
                </td>
                <td className="p-2">
                  <div className="flex flex-col gap-1 items-start">
                    <select
                      className="chip !text-[11px] !py-0.5"
                      value={l.status}
                      onChange={(e) => setStatusOf(l, e.target.value)}
                    >
                      {STATUS_KEYS.map((k) => (
                        <option key={k} value={k}>
                          {term(LISTING_STATUS, locale, k)}
                        </option>
                      ))}
                    </select>
                    <button
                      className="chip !text-[11px] !py-0.5"
                      onClick={() => setEnglishFor(l)}
                      dir="ltr"
                    >
                      {l.titleEn ? c.englishSet : c.englishMissing}
                    </button>
                    <button
                      className="chip !text-[11px] !py-0.5"
                      onClick={() => setLocationFor(l)}
                    >
                      {c.locButton}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td className="p-4 text-faint" colSpan={8}>
                  {c.noResults}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {mediaFor ? (
        <MediaManager
          listingId={mediaFor.listingId}
          title={mediaFor.titleAr}
          onClose={() => setMediaFor(null)}
          onSaved={load}
        />
      ) : null}

      {englishFor ? (
        <EnglishEditor listing={englishFor} onClose={() => setEnglishFor(null)} onSaved={load} />
      ) : null}

      {locationFor ? (
        <LocationEditor listing={locationFor} onClose={() => setLocationFor(null)} />
      ) : null}
    </div>
  );
}

/**
 * The English copy for one listing.
 *
 * Kept deliberately small and separate from the intake form: this is a
 * translation desk, not a listing editor, and the Arabic it is rendered
 * against is shown read-only beside it so whoever writes the English is
 * looking at the sentence they are answering. Empty is a legitimate final
 * state — the public site falls back to the Arabic and marks it as Arabic —
 * so nothing here is required and clearing a field is an ordinary save.
 */
function EnglishEditor({
  listing,
  onClose,
  onSaved,
}: {
  listing: BizListing;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
}) {
  const locale = useLocale();
  const c = copy[locale];
  const [titleEn, setTitleEn] = useState("");
  const [descriptionEn, setDescriptionEn] = useState("");
  const [descriptionAr, setDescriptionAr] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await api<{
          listing: { titleEn: string | null; descriptionAr: string | null; descriptionEn: string | null };
        }>(`/v1/biz/businesses/${listing.listingId}`);
        if (!live) return;
        setTitleEn(res.listing.titleEn ?? "");
        setDescriptionEn(res.listing.descriptionEn ?? "");
        setDescriptionAr(res.listing.descriptionAr ?? "");
        setLoaded(true);
      } catch {
        if (live) setMsg(copy[locale].editorLoadFailed);
      }
    })();
    return () => {
      live = false;
    };
  }, [listing.listingId, locale]);

  async function save() {
    setBusy(true);
    setMsg("");
    const title = titleEn.trim();
    const description = descriptionEn.trim();
    try {
      await api(`/v1/biz/listings/${listing.listingId}`, {
        method: "PATCH",
        // Null, not "", so "never written" stays distinguishable from
        // "written and then emptied" for anyone auditing coverage.
        body: JSON.stringify({
          titleEn: title || null,
          descriptionEn: description || null,
        }),
      });
      setMsg(title || description ? c.editorSaved : c.editorCleared);
      await onSaved?.();
    } catch {
      setMsg(c.editorSaveFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-sea-dark/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-surface w-full sm:max-w-2xl max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-bubble shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-surface/95 backdrop-blur border-b border-sand px-4 py-3 flex items-center justify-between gap-2">
          <h2 className="font-bold text-sea truncate text-sm">
            {c.englishTitleFor(listing.titleAr)}
          </h2>
          <div className="flex items-center gap-2 shrink-0">
            <button
              className="btn-primary !py-1.5 !px-4 !text-sm disabled:opacity-40"
              disabled={!loaded || busy}
              onClick={save}
            >
              {busy ? "…" : c.save}
            </button>
            <button
              onClick={onClose}
              aria-label={c.close}
              className="w-8 h-8 rounded-full bg-sand text-sea font-bold"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="p-4">
          {msg ? <p className="mb-3 text-sm font-bold text-sea">{msg}</p> : null}
          <p className="text-xs text-faint mb-3 leading-relaxed">{c.editorIntro}</p>

          {!loaded ? (
            <p className="text-sm text-faint">{c.loading}</p>
          ) : (
            <>
              <div className="rounded-2xl bg-sand p-3 mb-3">
                <div className="text-[11px] font-bold text-muted mb-1">{c.arabicNow}</div>
                <div className="text-sm font-bold text-sea" lang="ar" dir="rtl">
                  {listing.titleAr}
                </div>
                {descriptionAr ? (
                  <p className="text-xs text-muted mt-1 leading-relaxed" lang="ar" dir="rtl">
                    {descriptionAr}
                  </p>
                ) : null}
              </div>

              <label className="block text-xs font-bold text-muted">
                {c.fTitleEn}
                <input
                  className="input !py-2 !text-sm mt-1"
                  dir="ltr"
                  lang="en"
                  value={titleEn}
                  onChange={(e) => setTitleEn(e.target.value)}
                />
              </label>

              <label className="block text-xs font-bold text-muted mt-3">
                {c.fDescriptionEn}
                <textarea
                  className="input !py-2 !text-sm mt-1 h-32"
                  dir="ltr"
                  lang="en"
                  value={descriptionEn}
                  onChange={(e) => setDescriptionEn(e.target.value)}
                />
              </label>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type Disclosure = "area" | "staged" | "public";

/**
 * Mirrors the API's `defaultDisclosure`. A venue nobody has set behaves as
 * this, and the operator should be able to see which one that is rather than
 * guessing from a blank radio group — the whole screen exists to stop people
 * changing a setting they do not understand.
 */
function defaultDisclosure(venueType: string): Disclosure {
  return venueType === "service" ? "area" : "staged";
}

/**
 * Who may see where this venue is.
 *
 * The dangerous operator here is not the careless one, it is the helpful one:
 * someone tidying the catalogue, noticing that half the providers have no pin,
 * and setting them all to `public` so the map looks finished. That would put
 * house numbers of women who work from home onto a public marketplace, and it
 * cannot be undone by changing the setting back.
 *
 * So the screen leads with whose decision this is, states plainly why the
 * default is what it is, and puts the safe option first. The three
 * descriptions are written for someone on the phone to a provider, in the
 * words they would use to her — not as definitions of the enum.
 *
 * API GAP — `PATCH /v1/biz/listings/:id` neither accepts `locationDisclosure`
 * (it is not in the route's Zod object, so it is silently stripped) nor could
 * store it if it did: the column lives on `venues`, and that handler writes to
 * `listings`. Rather than pretend, the save reads the endpoint's own `changed`
 * array and says out loud when nothing moved. The moment the API takes the
 * field this screen starts working with no edit.
 */
function LocationEditor({
  listing,
  onClose,
}: {
  listing: BizListing;
  onClose: () => void;
}) {
  const locale = useLocale();
  const c = copy[locale];
  const [venueType, setVenueType] = useState("");
  const [initial, setInitial] = useState<Disclosure | null>(null);
  const [value, setValue] = useState<Disclosure | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await api<{
          venue: { type: string; locationDisclosure: string | null };
        }>(`/v1/biz/businesses/${listing.listingId}`);
        if (!live) return;
        const current = (["area", "staged", "public"] as const).includes(
          res.venue.locationDisclosure as Disclosure,
        )
          ? (res.venue.locationDisclosure as Disclosure)
          : defaultDisclosure(res.venue.type);
        setVenueType(res.venue.type);
        setInitial(current);
        setValue(current);
        setLoaded(true);
      } catch {
        if (live) setMsg(copy[locale].editorLoadFailed);
      }
    })();
    return () => {
      live = false;
    };
  }, [listing.listingId, locale]);

  const options: { key: Disclosure; title: string; body: string }[] = [
    { key: "area", title: c.locArea, body: c.locAreaBody },
    { key: "staged", title: c.locStaged, body: c.locStagedBody },
    { key: "public", title: c.locPublic, body: c.locPublicBody },
  ];

  async function save() {
    if (!value) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await api<{ ok: boolean; changed?: string[] }>(
        `/v1/biz/listings/${listing.listingId}`,
        { method: "PATCH", body: JSON.stringify({ locationDisclosure: value }) },
      );
      if (res.changed?.includes("locationDisclosure")) {
        setInitial(value);
        setMsg(c.locSaved);
      } else {
        // The endpoint answered 200 and dropped the field. Saying "saved"
        // here would have an operator ring a provider and tell her something
        // untrue about where her house is published.
        setMsg(c.locNotAccepted);
      }
    } catch {
      setMsg(c.locSaveFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-sea-dark/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-surface w-full sm:max-w-2xl max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-bubble shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-surface/95 backdrop-blur border-b border-sand px-4 py-3 flex items-center justify-between gap-2">
          <h2 className="font-bold text-sea truncate text-sm">
            {c.locTitleFor(listing.venueNameAr)}
          </h2>
          <div className="flex items-center gap-2 shrink-0">
            <button
              className="btn-primary !py-1.5 !px-4 !text-sm disabled:opacity-40"
              disabled={!loaded || busy || value === initial}
              onClick={save}
            >
              {busy ? "…" : c.save}
            </button>
            <button
              onClick={onClose}
              aria-label={c.close}
              className="w-8 h-8 rounded-full bg-sand text-sea font-bold"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="p-4">
          {msg ? <p className="mb-3 text-sm font-bold text-sea">{msg}</p> : null}

          {/* Whose decision this is, before any of the options are readable. */}
          <p className="text-sm text-muted leading-relaxed">{c.locLead}</p>
          <p className="text-xs text-faint leading-relaxed mt-2">{c.locWarn}</p>

          {!loaded ? (
            <p className="text-sm text-faint mt-4">{c.loading}</p>
          ) : (
            <div className="space-y-2 mt-4">
              {options.map((o) => {
                const isDefault = o.key === defaultDisclosure(venueType);
                return (
                  <label
                    key={o.key}
                    className={`flex gap-3 rounded-2xl p-3 cursor-pointer ${
                      value === o.key ? "bg-sand" : "bg-sand/50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="locationDisclosure"
                      className="mt-1 shrink-0"
                      checked={value === o.key}
                      onChange={() => setValue(o.key)}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-sea">{o.title}</span>
                      <span className="block text-xs text-muted leading-relaxed mt-0.5">
                        {o.body}
                      </span>
                      <span className="flex flex-wrap gap-1 mt-1.5">
                        {isDefault ? <Pill tone="slate">{c.locDefaultFor}</Pill> : null}
                        {o.key === initial ? <Pill tone="green">{c.locCurrent}</Pill> : null}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
