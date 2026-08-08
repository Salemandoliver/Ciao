"use client";
/**
 * The brand message — what the home page says, written here instead of shipped.
 *
 * The band under the trust strip on the marketplace used to be three strings
 * in a React component, which meant «عيد مبارك» cost a pull request, a build
 * and a deploy, and taking it down again cost another three. A greeting whose
 * entire value is that it is timely should not wait in a deploy queue.
 *
 * Three decisions worth knowing before reading the code:
 *
 * **The preview is the real component.** `BrandBand` is the marketplace's own
 * file, duplicated byte-for-byte and guarded by `tools/component-drift.mjs`.
 * Not a mock-up, not "styled to look like" it — the same JSX, so a headline
 * three words too long wraps here exactly as it will wrap there. The preview
 * also renders on a sand ground at the marketplace's measure rather than
 * filling this screen, because a band that looks balanced across 1400px of
 * console and cramped across 700px of phone is a preview that lied.
 *
 * **Arabic is required and English is not.** The market reads Arabic; the
 * English pages serve a minority. Demanding both would mean an operator who
 * wants a greeting up in ten minutes either writes an English line she does
 * not care about or does not publish, and a half-translated site is a smaller
 * problem than a stale one. Where English is missing the preview shows the
 * Arabic marked as Arabic, which is what the page will do.
 *
 * **Nothing is deleted.** Retiring hides a message and keeps it, because a
 * finished campaign is both the record of what the country was told and next
 * year's draft. The list is a calendar, not a queue.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  brandMessageState,
  pickBrandMessage,
  renderBrandMessage,
  type BrandMessage,
  type BrandMessageState,
} from "@ciao/shared";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { CITIES, term } from "@/lib/vocab";
import { encodeImage, isSupportedImage, toBase64 } from "@/lib/encode-image";
import type { Locale } from "@/lib/i18n";
import { BrandBand } from "@/components/brand-band";
import { Pill, Section } from "./lib";

type Row = BrandMessage & { updatedAt: string };

const VERTICAL_KEYS = ["coast", "hall", "service"] as const;

/** A blank message. Priority 10 so a first campaign beats the standing copy. */
const EMPTY = {
  id: "",
  name: "",
  overlineAr: "",
  overlineEn: "",
  headlineAr: "",
  headlineEn: "",
  accentAr: "",
  accentEn: "",
  bodyAr: "",
  bodyEn: "",
  imageUrl: "",
  imageAltAr: "",
  imageAltEn: "",
  ctaLabelAr: "",
  ctaLabelEn: "",
  ctaHref: "",
  startsOn: "",
  endsOn: "",
  city: "",
  vertical: "",
  priority: "10",
  active: true,
};

type Form = typeof EMPTY;

function toForm(r: Row): Form {
  return {
    id: r.id,
    name: r.name,
    overlineAr: r.overlineAr ?? "",
    overlineEn: r.overlineEn ?? "",
    headlineAr: r.headlineAr,
    headlineEn: r.headlineEn ?? "",
    accentAr: r.accentAr ?? "",
    accentEn: r.accentEn ?? "",
    bodyAr: r.bodyAr ?? "",
    bodyEn: r.bodyEn ?? "",
    imageUrl: r.imageUrl ?? "",
    imageAltAr: r.imageAltAr ?? "",
    imageAltEn: r.imageAltEn ?? "",
    ctaLabelAr: r.ctaLabelAr ?? "",
    ctaLabelEn: r.ctaLabelEn ?? "",
    ctaHref: r.ctaHref ?? "",
    startsOn: r.startsOn ?? "",
    endsOn: r.endsOn ?? "",
    city: r.city ?? "",
    vertical: r.vertical ?? "",
    priority: String(r.priority),
    active: r.active,
  };
}

/** Empty strings become nulls: "" is a value, and the column means "unset". */
const orNull = (s: string) => (s.trim() ? s.trim() : null);

function toPayload(f: Form) {
  return {
    name: f.name.trim(),
    overlineAr: orNull(f.overlineAr),
    overlineEn: orNull(f.overlineEn),
    headlineAr: f.headlineAr.trim(),
    headlineEn: orNull(f.headlineEn),
    accentAr: orNull(f.accentAr),
    accentEn: orNull(f.accentEn),
    bodyAr: orNull(f.bodyAr),
    bodyEn: orNull(f.bodyEn),
    imageUrl: orNull(f.imageUrl),
    imageAltAr: orNull(f.imageAltAr),
    imageAltEn: orNull(f.imageAltEn),
    ctaLabelAr: orNull(f.ctaLabelAr),
    ctaLabelEn: orNull(f.ctaLabelEn),
    ctaHref: orNull(f.ctaHref),
    startsOn: orNull(f.startsOn),
    endsOn: orNull(f.endsOn),
    city: orNull(f.city),
    vertical: orNull(f.vertical),
    priority: Number(f.priority) || 0,
    active: f.active,
  };
}

/** The draft as the shared rule sees it, so the preview can rank it honestly. */
function toMessage(f: Form): BrandMessage {
  const p = toPayload(f);
  return { ...p, id: f.id || "draft", active: p.active } as BrandMessage;
}

const copy = {
  ar: {
    why: "ما تكتبه هنا يظهر على الصفحة الرئيسية لتشاو",
    whyBody:
      "المساحة تحت شريط الثقة. اكتب رسالة موسمية مثل «عيد مبارك»، أو عرضًا، وحدّد أيام ظهورها — تنزل وتُرفع وحدها في مواعيدها، بدون أي تحديث للتطبيق.",
    listTitle: (n: number) => `الرسائل (${n})`,
    newMessage: "+ رسالة جديدة",
    cancel: "إلغاء",
    noMessages: "لا رسائل بعد — الصفحة تعرض الرسالة الثابتة",

    stLive: "على الصفحة الآن",
    stScheduled: "مجدولة",
    stExpired: "انتهت",
    stRetired: "موقوفة",
    stOutranked: "محجوبة برسالة أعلى",

    preview: "المعاينة",
    previewNote: "هكذا تظهر تمامًا على الصفحة الرئيسية",
    previewAr: "بالعربية",
    previewEn: "بالإنجليزية",

    fName: "اسم داخلي",
    fNameHint: "لا يظهر لأحد — للتفريق بين الرسائل هنا",
    secAr: "النص بالعربية",
    secEn: "النص بالإنجليزية",
    enHint: "اتركه فارغًا وسيظهر النص العربي في الصفحة الإنجليزية",
    fOverline: "السطر الصغير فوق العنوان",
    fHeadline: "العنوان",
    fAccent: "آخر كلمة (تظهر بالذهبي)",
    fBody: "الفقرة الجانبية",
    secImage: "صورة صغيرة",
    imageHint:
      "تظهر بجانب الكلام لا خلفه — هلال، فانوس، صورة منتج. النص يبقى نصًا حتى يُقرأ ويُترجم.",
    pick: "اختر صورة",
    remove: "إزالة",
    fImageAlt: "وصف الصورة لقارئ الشاشة",
    secCta: "زر (اختياري)",
    fCtaLabel: "نص الزر",
    fCtaHref: "الوجهة داخل تشاو",
    ctaHrefHint: "مسار داخلي يبدأ بـ / — مثل ‎/search?type=hall",
    secWhen: "متى تظهر",
    fStartsOn: "من يوم",
    fEndsOn: "إلى يوم (شامل)",
    whenHint: "اتركهما فارغين لتظل ظاهرة حتى توقفها بنفسك",
    secWho: "لمن تظهر",
    fCity: "المدينة",
    fVertical: "القسم",
    everyone: "الجميع",
    allCities: "كل المدن",
    allVerticals: "كل الأقسام",
    targetWarn:
      "الصفحة الرئيسية لا تعرف مدينة الزائر، فالرسالة الموجّهة تظهر في صفحات البحث المطابقة فقط.",
    fPriority: "الأولوية",
    priorityHint: "الأعلى يفوز حين تتصادف رسالتان",

    save: "حفظ",
    saving: "جارٍ الحفظ…",
    edit: "تعديل",
    retire: "إيقاف",
    saved: "✅ تم الحفظ",
    loadFailed: "تعذر تحميل الرسائل",
    saveFailed: "تعذر الحفظ",
    forbidden: "ليست لديك صلاحية التسويق",
    headlineRequired: "العنوان بالعربية مطلوب",
    nameRequired: "الاسم الداخلي مطلوب",
    badWindow: "تاريخ النهاية قبل تاريخ البداية",
    badHref: "الوجهة يجب أن تكون مسارًا داخليًا يبدأ بـ /",
    notImage: "هذا الملف ليس صورة",
    uploadFailed: "تعذر رفع الصورة",
    uploading: "جارٍ الرفع…",
    uploadsOff: "رفع الصور غير مُهيّأ على الخادم",
  },
  en: {
    why: "What you write here appears on Ciao's home page",
    whyBody:
      "The space under the trust strip. Write a seasonal message like «Eid Mubarak», or a promotion, and set the days it runs — it goes up and comes down on its own, with no app release.",
    listTitle: (n: number) => `Messages (${n})`,
    newMessage: "+ New message",
    cancel: "Cancel",
    noMessages: "No messages yet — the page is showing the standing copy",

    stLive: "On the page now",
    stScheduled: "Scheduled",
    stExpired: "Finished",
    stRetired: "Retired",
    stOutranked: "Beaten by a higher message",

    preview: "Preview",
    previewNote: "Exactly how it renders on the home page",
    previewAr: "In Arabic",
    previewEn: "In English",

    fName: "Internal name",
    fNameHint: "Nobody sees this — it is how you tell messages apart here",
    secAr: "Arabic",
    secEn: "English",
    enHint: "Leave blank and the English page shows the Arabic",
    fOverline: "Small line above the headline",
    fHeadline: "Headline",
    fAccent: "Last word (shown in gold)",
    fBody: "Paragraph beside it",
    secImage: "Small picture",
    imageHint:
      "It sits beside the words, not behind them — a crescent, a lantern, a product shot. The words stay words, so they can be read aloud and translated.",
    pick: "Choose an image",
    remove: "Remove",
    fImageAlt: "Description for a screen reader",
    secCta: "Button (optional)",
    fCtaLabel: "Button text",
    fCtaHref: "Where it goes on Ciao",
    ctaHrefHint: "An internal path starting with / — e.g. /search?type=hall",
    secWhen: "When it runs",
    fStartsOn: "From",
    fEndsOn: "To (inclusive)",
    whenHint: "Leave both blank to run until you retire it",
    secWho: "Who sees it",
    fCity: "City",
    fVertical: "Vertical",
    everyone: "Everyone",
    allCities: "All cities",
    allVerticals: "All verticals",
    targetWarn:
      "The home page does not know a visitor's city, so a targeted message appears only on matching search pages.",
    fPriority: "Priority",
    priorityHint: "The higher one wins when two messages overlap",

    save: "Save",
    saving: "Saving…",
    edit: "Edit",
    retire: "Retire",
    saved: "✅ Saved",
    loadFailed: "Could not load the messages",
    saveFailed: "Could not save",
    forbidden: "You do not have the marketing capability",
    headlineRequired: "The Arabic headline is required",
    nameRequired: "The internal name is required",
    badWindow: "The end date is before the start date",
    badHref: "The destination must be an internal path starting with /",
    notImage: "That file is not an image",
    uploadFailed: "Could not upload the image",
    uploading: "Uploading…",
    uploadsOff: "Image uploads are not configured on the server",
  },
} satisfies Record<Locale, unknown>;

const STATE_TONE: Record<BrandMessageState, string> = {
  live: "green",
  scheduled: "amber",
  expired: "slate",
  retired: "slate",
  outranked: "slate",
};

/*
 * No `canWrite` prop.
 *
 * The tab is opened by the `marketing` capability and the API demands the same
 * capability to write, so anyone who can see this screen can use it. A
 * read-only mode here would be a state the product cannot reach — dead branches
 * that nobody exercises and that rot into a lie about who can do what.
 */
export function BrandMessageTab() {
  const locale = useLocale();
  const t = copy[locale];
  const [items, setItems] = useState<Row[]>([]);
  const [today, setToday] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: Row[]; today: string }>("/v1/biz/brand-messages");
      setItems(r.items);
      setToday(r.today);
    } catch (e) {
      setMsg(e instanceof ApiError && e.status === 403 ? t.forbidden : t.loadFailed);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * The draft competes against the saved messages in the preview's ranking.
   *
   * Without this the composer would happily show a beautiful preview of a
   * message that will never appear, because something with a higher priority
   * is already scheduled over the same days — which is precisely the mistake
   * the preview exists to catch. When editing, the draft replaces its own
   * saved row rather than competing with it.
   */
  const draft = useMemo(() => (form ? toMessage(form) : null), [form]);
  const ranked = useMemo(() => {
    const saved = items.filter((r) => r.id !== form?.id) as BrandMessage[];
    return draft ? [...saved, draft] : saved;
  }, [items, draft, form?.id]);
  const draftWins = useMemo(() => {
    if (!draft || !today) return false;
    const winner = pickBrandMessage(ranked, today, {
      city: draft.city,
      vertical: draft.vertical,
    });
    return winner?.id === draft.id;
  }, [ranked, draft, today]);

  function edit(r: Row) {
    setForm(toForm(r));
    setMsg("");
  }

  async function pickImage(file: File) {
    if (!isSupportedImage(file)) {
      setMsg(t.notImage);
      return;
    }
    setUploading(true);
    setMsg("");
    try {
      /*
       * The thumbnail encoding, not the full one.
       *
       * This picture renders at 96 CSS pixels and never larger; shipping the
       * 1600px catalogue encoding to a phone for a 96px box is the single most
       * common way a marketplace wastes a guest's data, and here it would be
       * on the busiest page on the site.
       */
      const { thumb } = await encodeImage(file);
      const r = await api<{ url: string }>("/v1/biz/media/upload", {
        method: "POST",
        body: JSON.stringify({
          kind: "brand",
          contentType: thumb.contentType,
          width: thumb.width,
          data: await toBase64(thumb.blob),
        }),
      });
      setForm((f) => (f ? { ...f, imageUrl: r.url } : f));
    } catch (e) {
      const m = e instanceof ApiError ? e.message : "";
      setMsg(m.includes("unconfigured") ? t.uploadsOff : t.uploadFailed);
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!form) return;
    if (!form.name.trim()) return setMsg(t.nameRequired);
    if (!form.headlineAr.trim()) return setMsg(t.headlineRequired);
    if (form.startsOn && form.endsOn && form.endsOn < form.startsOn) return setMsg(t.badWindow);
    setBusy(true);
    setMsg("");
    try {
      const payload = toPayload(form);
      if (form.id) {
        await api(`/v1/biz/brand-messages/${form.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await api("/v1/biz/brand-messages", { method: "POST", body: JSON.stringify(payload) });
      }
      setMsg(t.saved);
      setForm(null);
      await load();
    } catch (e) {
      const m = e instanceof ApiError ? e.message : "";
      setMsg(
        e instanceof ApiError && e.status === 403
          ? t.forbidden
          : m.includes("window_ends_before")
            ? t.badWindow
            : m.includes("cta_href")
              ? t.badHref
              : t.saveFailed,
      );
    } finally {
      setBusy(false);
    }
  }

  async function retire(r: Row) {
    try {
      await api(`/v1/biz/brand-messages/${r.id}`, { method: "DELETE" });
      await load();
    } catch {
      setMsg(t.saveFailed);
    }
  }

  function field(
    label: string,
    key: keyof Form,
    opts: { dir?: "rtl" | "ltr"; area?: boolean; placeholder?: string } = {},
  ) {
    if (!form) return null;
    const common = {
      className: "input !py-2 !text-sm mt-1",
      dir: opts.dir,
      placeholder: opts.placeholder,
      value: String(form[key] ?? ""),
      onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }),
    };
    return (
      <label className="text-xs font-bold text-muted">
        {label}
        {opts.area ? <textarea rows={3} {...common} /> : <input {...common} />}
      </label>
    );
  }

  return (
    <div>
      {msg ? <p className="mb-3 text-sm font-bold text-sea">{msg}</p> : null}

      <div className="card p-4">
        <h3 className="font-bold text-sea text-sm">{t.why}</h3>
        <p className="text-xs text-muted mt-1 leading-relaxed">{t.whyBody}</p>
      </div>

      {form ? (
        <>
          <Section title={t.preview} hint={t.previewNote}>
            {/*
              Bounded to the marketplace's own measure and set on its own
              ground. The console is a wide desktop screen and the home page is
              usually a phone; previewing at console width would flatter every
              headline ever written and warn about none of them.
            */}
            <div className="rounded-2xl bg-sand p-4 sm:p-6">
              <p className="text-[11px] font-bold text-muted mb-1">{t.previewAr}</p>
              <div className="max-w-[680px]" dir="rtl" lang="ar">
                <BrandBand message={renderBrandMessage(toMessage(form), "ar")} />
              </div>
              <p className="text-[11px] font-bold text-muted mt-6 mb-1">{t.previewEn}</p>
              <div className="max-w-[680px]" dir="ltr" lang="en">
                <BrandBand message={renderBrandMessage(toMessage(form), "en")} />
              </div>
            </div>
            {/*
              The one thing a preview cannot show by looking right: that
              something else will be on the page instead.
            */}
            {!draftWins ? (
              <p className="mt-3 text-xs font-bold text-amber-dark">{t.stOutranked}</p>
            ) : null}
          </Section>

          <Section title={form.id ? t.edit : t.newMessage}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {field(t.fName, "name", { placeholder: "عيد الفطر ٢٠٢٧" })}
              <label className="text-xs font-bold text-muted">
                {t.fPriority}
                <input
                  className="input !py-2 !text-sm mt-1"
                  inputMode="numeric"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                />
              </label>
            </div>
            <p className="text-[11px] text-muted mt-1">
              {t.fNameHint} · {t.priorityHint}
            </p>

            <h3 className="font-bold text-sea text-sm mt-4">{t.secAr}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
              {field(t.fOverline, "overlineAr", { dir: "rtl" })}
              {field(t.fHeadline, "headlineAr", { dir: "rtl" })}
              {field(t.fAccent, "accentAr", { dir: "rtl" })}
              {field(t.fBody, "bodyAr", { dir: "rtl", area: true })}
            </div>

            <h3 className="font-bold text-sea text-sm mt-4">{t.secEn}</h3>
            <p className="text-[11px] text-muted">{t.enHint}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
              {field(t.fOverline, "overlineEn", { dir: "ltr" })}
              {field(t.fHeadline, "headlineEn", { dir: "ltr" })}
              {field(t.fAccent, "accentEn", { dir: "ltr" })}
              {field(t.fBody, "bodyEn", { dir: "ltr", area: true })}
            </div>

            <h3 className="font-bold text-sea text-sm mt-4">{t.secImage}</h3>
            <p className="text-[11px] text-muted">{t.imageHint}</p>
            <div className="flex items-center gap-3 mt-2">
              {form.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={form.imageUrl}
                  alt=""
                  className="w-16 h-16 rounded-xl object-cover flex-shrink-0"
                />
              ) : null}
              <label className="chip cursor-pointer">
                {uploading ? t.uploading : t.pick}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void pickImage(f);
                  }}
                />
              </label>
              {form.imageUrl ? (
                <button
                  className="chip"
                  onClick={() => setForm({ ...form, imageUrl: "", imageAltAr: "", imageAltEn: "" })}
                >
                  {t.remove}
                </button>
              ) : null}
            </div>
            {form.imageUrl ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                {field(`${t.fImageAlt} (${t.secAr})`, "imageAltAr", { dir: "rtl" })}
                {field(`${t.fImageAlt} (${t.secEn})`, "imageAltEn", { dir: "ltr" })}
              </div>
            ) : null}

            <h3 className="font-bold text-sea text-sm mt-4">{t.secCta}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-1">
              {field(`${t.fCtaLabel} (${t.secAr})`, "ctaLabelAr", { dir: "rtl" })}
              {field(`${t.fCtaLabel} (${t.secEn})`, "ctaLabelEn", { dir: "ltr" })}
              {field(t.fCtaHref, "ctaHref", { dir: "ltr", placeholder: "/search?type=hall" })}
            </div>
            <p className="text-[11px] text-muted mt-1">{t.ctaHrefHint}</p>

            <h3 className="font-bold text-sea text-sm mt-4">{t.secWhen}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
              <label className="text-xs font-bold text-muted">
                {t.fStartsOn}
                <input
                  type="date"
                  className="input !py-2 !text-sm mt-1"
                  dir="ltr"
                  value={form.startsOn}
                  onChange={(e) => setForm({ ...form, startsOn: e.target.value })}
                />
              </label>
              <label className="text-xs font-bold text-muted">
                {t.fEndsOn}
                <input
                  type="date"
                  className="input !py-2 !text-sm mt-1"
                  dir="ltr"
                  value={form.endsOn}
                  onChange={(e) => setForm({ ...form, endsOn: e.target.value })}
                />
              </label>
            </div>
            <p className="text-[11px] text-muted mt-1">{t.whenHint}</p>

            <h3 className="font-bold text-sea text-sm mt-4">{t.secWho}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
              <label className="text-xs font-bold text-muted">
                {t.fCity}
                <select
                  className="input !py-2 !text-sm mt-1"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                >
                  <option value="">{t.allCities}</option>
                  {Object.keys(CITIES[locale]).map((k) => (
                    <option key={k} value={k}>
                      {term(CITIES, locale, k)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-bold text-muted">
                {t.fVertical}
                <select
                  className="input !py-2 !text-sm mt-1"
                  value={form.vertical}
                  onChange={(e) => setForm({ ...form, vertical: e.target.value })}
                >
                  <option value="">{t.allVerticals}</option>
                  {VERTICAL_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {form.city || form.vertical ? (
              <p className="mt-2 text-xs text-sea border-s-4 border-amber ps-3 py-1">
                {t.targetWarn}
              </p>
            ) : null}

            <div className="flex gap-2 mt-4">
              <button className="btn" disabled={busy} onClick={() => void save()}>
                {busy ? t.saving : t.save}
              </button>
              <button className="chip" onClick={() => setForm(null)}>
                {t.cancel}
              </button>
            </div>
          </Section>
        </>
      ) : null}

      <Section
        title={t.listTitle(items.length)}
        action={
          <button className="chip" onClick={() => setForm(EMPTY)}>
            {t.newMessage}
          </button>
        }
      >
        {items.length === 0 ? (
          <p className="text-sm text-muted">{t.noMessages}</p>
        ) : (
          <ul className="divide-y divide-sea/10">
            {items.map((r) => {
              const state = today
                ? brandMessageState(r, items as BrandMessage[], today)
                : "scheduled";
              const label = {
                live: t.stLive,
                scheduled: t.stScheduled,
                expired: t.stExpired,
                retired: t.stRetired,
                outranked: t.stOutranked,
              }[state];
              return (
                <li key={r.id} className="py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {/*
                      The internal name and the headline are the operator's own
                      Arabic, so they are declared as Arabic — on the English
                      console they are still Arabic, and the locale audit is
                      right to insist.
                    */}
                    <p className="font-bold text-sea truncate" lang="ar" dir="rtl">
                      {r.name}
                    </p>
                    <p className="text-xs text-muted truncate" lang="ar" dir="rtl">
                      {r.headlineAr} {r.accentAr ?? ""}
                    </p>
                    <p className="text-[11px] text-muted mt-1" dir="ltr">
                      {r.startsOn ?? "—"} → {r.endsOn ?? "—"}
                      {r.city || r.vertical
                        ? ` · ${[r.city && term(CITIES, locale, r.city), r.vertical]
                            .filter(Boolean)
                            .join(" · ")}`
                        : ` · ${t.everyone}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Pill tone={STATE_TONE[state]}>{label}</Pill>
                    <button className="chip" onClick={() => edit(r)}>
                      {t.edit}
                    </button>
                    {r.active ? (
                      <button className="chip" onClick={() => void retire(r)}>
                        {t.retire}
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
