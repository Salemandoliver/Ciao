"use client";
/**
 * Catalogue — every business on the platform, and how a new one gets added.
 *
 * Onboarding is one form, not three: host account, place, and listing are
 * created together, because a venue with no host or a host who can't log in
 * is the kind of orphan record that costs a supply team a whole afternoon.
 * The listing lands as a draft — publishing is deliberate and requires a
 * field visit plus photos (§11.2, §8.3).
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { Money, Pill, STATUS_AR, Section, VERTICAL_AR } from "./lib";
import { MediaManager } from "./media";

export interface BizListing {
  listingId: string;
  slug: string;
  titleAr: string;
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

export function CatalogueTab() {
  const [items, setItems] = useState<BizListing[]>([]);
  const [type, setType] = useState<"all" | "coast" | "hall" | "service">("all");
  const [status, setStatus] = useState<"all" | "draft" | "live" | "paused" | "delisted">("all");
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [mediaFor, setMediaFor] = useState<BizListing | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const q = new URLSearchParams({ type, status });
    if (search) q.set("search", search);
    try {
      setItems((await api<{ items: BizListing[] }>(`/v1/biz/businesses?${q}`)).items);
    } catch {
      setMsg("تعذر تحميل القائمة");
    }
  }, [type, status, search]);

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
      setMsg(`✅ أُضيف «${res.slug}» كمسودة — ${res.next}`);
      setForm(EMPTY_FORM);
      setAdding(false);
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError ? `تعذر الإضافة: ${e.message}` : "تعذر الإضافة");
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
          ? "لا يمكن النشر قبل المعاينة الميدانية واعتماد المكان (§11.2)"
          : code.includes("media")
            ? "لا يمكن النشر بدون صور — أضف الصور أولًا"
            : "تعذر تغيير الحالة",
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
            {t === "all" ? "الكل" : VERTICAL_AR[t]}
          </button>
        ))}
        <select
          className="chip !py-1"
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
        >
          <option value="all">كل الحالات</option>
          {Object.entries(STATUS_AR).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <input
          className="input !py-1.5 !text-sm max-w-[200px]"
          placeholder="بحث بالاسم أو الرمز"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="btn-amber !py-1.5 !px-4 !text-sm" onClick={() => setAdding((a) => !a)}>
          {adding ? "إلغاء" : "+ إضافة نشاط"}
        </button>
      </div>

      {msg ? <p className="mb-3 text-sm font-bold text-sea">{msg}</p> : null}

      {adding ? (
        <Section title="إضافة نشاط جديد">
          <p className="text-xs text-faint mb-3">
            يُنشأ حساب المضيف والمكان والإعلان معًا. يبدأ الإعلان كمسودة — لا يُنشر إلا بعد
            المعاينة الميدانية وإضافة الصور.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            <label className="block text-xs font-bold text-muted">
              نوع النشاط
              <select
                className="input !py-2 !text-sm mt-1"
                value={form.vertical}
                onChange={(e) => set("vertical", e.target.value as typeof form.vertical)}
              >
                <option value="coast">شاليه / استراحة</option>
                <option value="hall">قاعة أفراح</option>
                <option value="service">خدمة</option>
              </select>
            </label>
            {form.vertical === "service" ? (
              <label className="block text-xs font-bold text-muted">
                فئة الخدمة
                <select
                  className="input !py-2 !text-sm mt-1"
                  value={form.serviceCategory}
                  onChange={(e) => set("serviceCategory", e.target.value)}
                >
                  <option value="catering">ضيافة وطعام</option>
                  <option value="photography">تصوير</option>
                  <option value="makeup">مكياج</option>
                  <option value="hair">تصفيف شعر</option>
                  <option value="cakes">كعك وحلويات</option>
                  <option value="gym">نادي رياضي</option>
                </select>
              </label>
            ) : (
              <label className="block text-xs font-bold text-muted">
                سياسة الإلغاء
                <select
                  className="input !py-2 !text-sm mt-1"
                  value={form.cancellationTier}
                  onChange={(e) =>
                    set("cancellationTier", e.target.value as typeof form.cancellationTier)
                  }
                >
                  <option value="flexible">مرنة</option>
                  <option value="moderate">متوسطة</option>
                  <option value="strict">صارمة</option>
                </select>
              </label>
            )}
            <label className="block text-xs font-bold text-muted">
              هاتف المضيف
              <input
                className="input !py-2 !text-sm mt-1"
                dir="ltr"
                placeholder="09XXXXXXXX"
                value={form.hostPhone}
                onChange={(e) => set("hostPhone", e.target.value)}
              />
            </label>
            <label className="block text-xs font-bold text-muted">
              اسم المضيف
              <input
                className="input !py-2 !text-sm mt-1"
                value={form.hostName}
                onChange={(e) => set("hostName", e.target.value)}
              />
            </label>
            <label className="block text-xs font-bold text-muted">
              اسم المكان
              <input
                className="input !py-2 !text-sm mt-1"
                value={form.venueNameAr}
                onChange={(e) => set("venueNameAr", e.target.value)}
              />
            </label>
            <label className="block text-xs font-bold text-muted">
              المدينة
              <select
                className="input !py-2 !text-sm mt-1"
                value={form.city}
                onChange={(e) => set("city", e.target.value)}
              >
                <option value="tripoli">طرابلس</option>
                <option value="misrata">مصراتة</option>
                <option value="benghazi">بنغازي</option>
                <option value="zawiya">الزاوية</option>
                <option value="khoms">الخمس</option>
              </select>
            </label>
            <label className="block text-xs font-bold text-muted">
              المنطقة
              <input
                className="input !py-2 !text-sm mt-1"
                placeholder="janzour"
                dir="ltr"
                value={form.area}
                onChange={(e) => set("area", e.target.value)}
              />
            </label>
            <label className="block text-xs font-bold text-muted">
              عنوان الإعلان (عربي)
              <input
                className="input !py-2 !text-sm mt-1"
                value={form.titleAr}
                onChange={(e) => set("titleAr", e.target.value)}
              />
            </label>
            <label className="block text-xs font-bold text-muted">
              الرمز في الرابط
              <div className="flex gap-1 mt-1">
                <input
                  className="input !py-2 !text-sm"
                  dir="ltr"
                  placeholder="janzour-villa"
                  value={form.slug}
                  onChange={(e) => set("slug", e.target.value)}
                />
                <button className="chip shrink-0" onClick={suggestSlug} type="button">
                  اقترح
                </button>
              </div>
            </label>
            <label className="block text-xs font-bold text-muted">
              السعر الأساسي (د.ل)
              <input
                className="input !py-2 !text-sm mt-1"
                inputMode="numeric"
                value={form.baseNightly}
                onChange={(e) => set("baseNightly", e.target.value)}
              />
            </label>
            {form.vertical === "hall" ? (
              <label className="block text-xs font-bold text-muted">
                سعة القسم النسائي
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
                  أقصى عدد ضيوف
                  <input
                    className="input !py-2 !text-sm mt-1"
                    inputMode="numeric"
                    value={form.maxGuests}
                    onChange={(e) => set("maxGuests", e.target.value)}
                  />
                </label>
                <label className="block text-xs font-bold text-muted">
                  عدد الغرف
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
              الوصف
              <textarea
                className="input !py-2 !text-sm mt-1 h-20"
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
                عائلات فقط
              </label>
            ) : null}
          </div>
          <button
            className="btn-primary !py-2 !text-sm mt-3"
            disabled={busy || !form.hostPhone || !form.slug || !form.titleAr || !form.venueNameAr}
            onClick={submit}
          >
            {busy ? "جارٍ الحفظ…" : "أضف كمسودة"}
          </button>
        </Section>
      ) : null}

      <div className="card mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-sand/60 text-muted">
            <tr>
              <th className="text-start p-2">النشاط</th>
              <th className="text-start p-2">النوع</th>
              <th className="text-start p-2">الحالة</th>
              <th className="text-start p-2">الصور</th>
              <th className="text-start p-2">حجوزات</th>
              <th className="text-start p-2">القيمة</th>
              <th className="text-start p-2">التقييمات</th>
              <th className="text-start p-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((l) => (
              <tr key={l.listingId} className="border-t border-sand align-top">
                <td className="p-2">
                  <div className="font-bold text-sea">{l.titleAr}</div>
                  <div className="text-[11px] text-faint">
                    {l.venueNameAr} · {l.area ?? l.city}
                    {l.host ? ` · ${l.host.name ?? l.host.phone}` : " · بلا مضيف"}
                  </div>
                </td>
                <td className="p-2">{VERTICAL_AR[l.vertical] ?? l.vertical}</td>
                <td className="p-2">
                  <Pill
                    tone={
                      l.status === "live" ? "green" : l.status === "draft" ? "sand" : "slate"
                    }
                  >
                    {STATUS_AR[l.status] ?? l.status}
                  </Pill>
                  {!l.verified ? (
                    <div className="mt-1">
                      <Pill tone="red">غير موثّق</Pill>
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
                    <span className="text-danger"> · {l.disputeCount} شكوى</span>
                  ) : null}
                </td>
                <td className="p-2">
                  <select
                    className="chip !text-[11px] !py-0.5"
                    value={l.status}
                    onChange={(e) => setStatusOf(l, e.target.value)}
                  >
                    {Object.entries(STATUS_AR).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td className="p-4 text-faint" colSpan={8}>
                  لا نتائج
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
    </div>
  );
}
