"use client";
/**
 * Field Agent capture — §8.10.
 * Offline-first checklist runner: bundles queue in localStorage and sync when
 * coverage returns. Output: a listing 90% publish-ready before leaving the driveway.
 *
 * The English is deliberately short. This screen is read one-handed, standing
 * at a gate in full sun, on a phone with one bar of signal — so every label is
 * a few words, and the ones that carry a rule («يجب تشغيله فعليًا») keep the
 * rule rather than turning into a polite hint.
 */
import { useEffect, useState } from "react";
import { Link, useLocale, useRouter } from "@/lib/locale";
import { Logo } from "@/components/logo";
import { LanguageToggle } from "@/components/language-toggle";
import { api, ensureSession, ApiError } from "@/lib/api";
import type { Locale } from "@/lib/i18n";
import type { NeighbourRecord } from "@/lib/types";
import { NEIGHBOUR_KINDS_LABELS, NEIGHBOUR_KIND_EMOJI, NEIGHBOUR_KIND_KEYS, term } from "@/lib/vocab";

interface Bundle {
  bundleId: string;
  venueId: string;
  visitDate: string;
  gps?: { lat: string; lng: string };
  identityEvidenceGrade: "deed" | "utility_bill_attestation" | "local_attestation";
  amenities: { key: string; present: boolean; detail?: string }[];
  generatorRunTest?: { ran: boolean; kva?: number; fuelIncluded?: boolean };
  waterSupply?: "municipal" | "tank" | "well" | "none";
  privacy?: { walledPool: boolean; overlooked: boolean; separateFamilyEntrance: boolean };
  safetyBasics?: { gasStorageSane: boolean; poolDepthMarked: boolean };
  evidenceMedia: { ref: string; kind: string }[];
  /**
   * What is around the place, recorded while the agent is still standing in
   * front of it. It rides in the verification bundle rather than going out as
   * its own save because that is the only request this screen is allowed to
   * make: the console runs as `agent`, and `PATCH /v1/biz/listings/:id` is
   * behind the ops guard.
   *
   * API GAP — the sync endpoint's `checklistSchema` does not list `neighbours`
   * yet, so Zod strips it and the ops approval step has nothing to copy onto
   * `venues.neighbours`. The capture, the offline queue and the payload are
   * all correct; three lines in the API turn them on. Do not paper over this
   * with a second endpoint.
   */
  neighbours?: NeighbourRecord[];
  notes?: string;
}

/** What one row of the nearby form holds before it is cleaned into a record. */
interface NeighbourDraft {
  kind: string;
  nameAr: string;
  walkMinutes: string;
  driveMinutes: string;
  noteAr: string;
  lat?: string;
  lng?: string;
}

/**
 * Six, not eight. The API accepts eight; asking for eight in the field
 * produces two good lines and six that say "nice supermarket".
 */
const MAX_NEIGHBOURS = 6;

const EMPTY_NEIGHBOUR: NeighbourDraft = {
  kind: "supermarket",
  nameAr: "",
  walkMinutes: "",
  driveMinutes: "",
  noteAr: "",
};

const QUEUE_KEY = "ciao_agent_queue";

const copy = {
  ar: {
    upload: (n: number) => `⬆ رفع (${n} بانتظار)`,
    title: "توثيق ميداني — قائمة الفحص",
    needVenueId: "أدخل معرّف المكان (يصلك من العمليات)",
    savedLocal: "حُفظ محليًا ✓ — سيُرفع عند توفر الشبكة",
    savedNoGps: "حُفظ محليًا (بدون GPS) ✓",
    savedPlain: "حُفظ محليًا ✓",
    queueEmpty: "لا حزم بانتظار الرفع",
    uploaded: (n: number) => `رُفعت ${n} حزمة ✓`,
    uploadFailed: "الشبكة ضعيفة — الحزم محفوظة، أعد المحاولة لاحقًا",
    evidenceLabel: "إثبات الملكية / التفويض الذي عاينته:",
    deed: "صك ملكية",
    utilityBill: "فاتورة مرافق + إقرار",
    localAttestation: "شهادة وجيه محلي",
    generatorTitle: "⚡ المولّد — يجب تشغيله فعليًا",
    generatorRan: "شغّلت المولّد بنفسي وهو يعمل",
    fuelIncluded: "الوقود مشمول في السعر",
    waterLabel: "💧 مصدر المياه:",
    municipal: "شبكة عامة",
    tank: "خزان",
    well: "بئر",
    none: "لا يوجد",
    privacyTitle: "🔒 تقييم الستر",
    walledPool: "المسبح مسوَّر بالكامل",
    overlooked: "مكشوف على الجيران",
    separateEntrance: "مدخل عائلي منفصل",
    safetyTitle: "⚠️ أساسيات السلامة",
    gasSane: "تخزين الغاز سليم",
    poolDepthMarked: "عمق المسبح مُعلَّم",
    neighboursTitle: "🧭 ما حول المكان — من ٤ إلى ٦",
    neighboursIntro:
      "الملاحظة هي المهم، مش الاسم. اكتب الشي اللي ما يعرفوش إلا اللي وقف هنا: «قسم عائلي في الطابق الأول»، «يفتح ٦ الصبح حتى في العيد».",
    nName: "الاسم — مخبزة النور",
    nWalk: "مشي (د)",
    nDrive: "سيارة (د)",
    nNote: "الملاحظة — قسم عائلي في الطابق الأول",
    nPin: "📍 خذ الموقع",
    nPinned: "📍 اتسجّل ✓",
    nRemove: "احذف",
    nAdd: "＋ أضف مكان",
    nCount: (n: number) => `${n} من ${MAX_NEIGHBOURS}`,
    nNeedFour: "أربعة على الأقل — الباقي ما يستاهلش الزيارة",
    notesPlaceholder: "ملاحظات (تسعير مقترح، حالة الطريق، ملاحظات المضيف…)",
    save: "📸 احفظ الحزمة (يعمل بدون شبكة)",
    photoNote:
      "الصور تُرفع من تطبيق الكاميرا الموجّه (قريبًا) — حاليًا ترسلها للعمليات عبر واتساب مع رقم الحزمة.",
  },
  en: {
    upload: (n: number) => `⬆ Upload (${n} waiting)`,
    title: "Site check — inspection list",
    needVenueId: "Enter the venue ID (ops send it to you)",
    savedLocal: "Saved on this phone ✓ — uploads when there is signal",
    savedNoGps: "Saved on this phone (no GPS) ✓",
    savedPlain: "Saved on this phone ✓",
    queueEmpty: "Nothing waiting to upload",
    uploaded: (n: number) => `${n} uploaded ✓`,
    uploadFailed: "Weak signal — nothing is lost, try again later",
    evidenceLabel: "Ownership or authority you saw:",
    deed: "Title deed",
    utilityBill: "Utility bill + declaration",
    localAttestation: "Local elder's attestation",
    generatorTitle: "⚡ Generator — you must actually run it",
    generatorRan: "I ran it myself and it works",
    fuelIncluded: "Fuel included in the price",
    waterLabel: "💧 Water source:",
    municipal: "Mains",
    tank: "Tank",
    well: "Well",
    none: "None",
    privacyTitle: "🔒 Privacy and screening",
    walledPool: "Pool fully walled",
    overlooked: "Overlooked by neighbours",
    separateEntrance: "Separate family entrance",
    safetyTitle: "⚠️ Safety basics",
    gasSane: "Gas stored safely",
    poolDepthMarked: "Pool depth marked",
    neighboursTitle: "🧭 What's nearby — 4 to 6",
    neighboursIntro:
      "The note is what matters, not the name. Write the thing only someone standing here would know: \"family section on the first floor\", \"opens at 6, even on Eid\".",
    nName: "Name — Al-Nour bakery",
    nWalk: "Walk (min)",
    nDrive: "Drive (min)",
    nNote: "The note — family section on the first floor",
    nPin: "📍 Take the pin",
    nPinned: "📍 Pinned ✓",
    nRemove: "Remove",
    nAdd: "＋ Add a place",
    nCount: (n: number) => `${n} of ${MAX_NEIGHBOURS}`,
    nNeedFour: "Four at the least — anything less was not worth the trip",
    notesPlaceholder: "Notes (suggested price, road condition, host's remarks…)",
    save: "📸 Save bundle (works offline)",
    photoNote:
      "Photos will upload from the guided camera app (coming soon) — for now send them to ops on WhatsApp with the bundle number.",
  },
} satisfies Record<Locale, unknown>;

function loadQueue(): Bundle[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as Bundle[];
  } catch {
    return [];
  }
}
function saveQueue(q: Bundle[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

export default function AgentPage() {
  const locale = useLocale();
  const c = copy[locale];
  const router = useRouter();
  const [queue, setQueue] = useState<Bundle[]>([]);
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({
    venueId: "",
    identityEvidenceGrade: "utility_bill_attestation" as Bundle["identityEvidenceGrade"],
    generatorRan: false,
    generatorKva: "",
    fuelIncluded: false,
    waterSupply: "tank" as NonNullable<Bundle["waterSupply"]>,
    walledPool: false,
    overlooked: false,
    separateFamilyEntrance: false,
    gasStorageSane: true,
    poolDepthMarked: false,
    notes: "",
  });
  // Four rows up front, because an empty list with an "add" button gets
  // skipped and a form that is already open gets filled in.
  const [neighbours, setNeighbours] = useState<NeighbourDraft[]>(() =>
    Array.from({ length: 4 }, () => ({ ...EMPTY_NEIGHBOUR })),
  );

  function setNeighbour<K extends keyof NeighbourDraft>(i: number, k: K, v: NeighbourDraft[K]) {
    setNeighbours((list) => list.map((n, j) => (j === i ? { ...n, [k]: v } : n)));
  }

  /** The pin for one neighbour — the agent walks over, or does not bother. */
  function pinNeighbour(i: number) {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setNeighbours((list) =>
          list.map((n, j) =>
            j === i
              ? { ...n, lat: String(pos.coords.latitude), lng: String(pos.coords.longitude) }
              : n,
          ),
        ),
      () => undefined,
      { timeout: 5000, enableHighAccuracy: true },
    );
  }

  /** Drafts → records. A row with no name never happened. */
  function cleanNeighbours(): NeighbourRecord[] {
    const minutes = (v: string) => {
      const n = Math.trunc(Number(v));
      return Number.isFinite(n) && n > 0 && n <= 120 ? n : undefined;
    };
    return neighbours
      .filter((n) => n.nameAr.trim())
      .slice(0, MAX_NEIGHBOURS)
      .map((n) => ({
        kind: n.kind,
        nameAr: n.nameAr.trim(),
        walkMinutes: minutes(n.walkMinutes),
        driveMinutes: minutes(n.driveMinutes),
        noteAr: n.noteAr.trim() || undefined,
        lat: n.lat,
        lng: n.lng,
      }));
  }

  useEffect(() => {
    ensureSession().then((ok) => {
      if (!ok) return router.push("/login?next=/agent");
      setQueue(loadQueue());
    });
  }, [router]);

  function capture() {
    if (!form.venueId) return setMsg(c.needVenueId);
    const nearby = cleanNeighbours();
    const bundle: Bundle = {
      bundleId: crypto.randomUUID(),
      venueId: form.venueId,
      visitDate: new Date().toISOString().slice(0, 10),
      identityEvidenceGrade: form.identityEvidenceGrade,
      amenities: [
        {
          key: "generator",
          present: form.generatorRan,
          detail: form.generatorKva ? `${form.generatorKva} KVA` : undefined,
        },
        { key: "water_tank", present: form.waterSupply !== "none", detail: form.waterSupply },
        { key: "pool", present: form.walledPool },
      ],
      generatorRunTest: {
        ran: form.generatorRan,
        kva: form.generatorKva ? Number(form.generatorKva) : undefined,
        fuelIncluded: form.fuelIncluded,
      },
      waterSupply: form.waterSupply,
      privacy: {
        walledPool: form.walledPool,
        overlooked: form.overlooked,
        separateFamilyEntrance: form.separateFamilyEntrance,
      },
      safetyBasics: {
        gasStorageSane: form.gasStorageSane,
        poolDepthMarked: form.poolDepthMarked,
      },
      evidenceMedia: [],
      neighbours: nearby.length ? nearby : undefined,
      notes: form.notes || undefined,
    };
    // GPS pin if available.
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          bundle.gps = {
            lat: String(pos.coords.latitude),
            lng: String(pos.coords.longitude),
          };
          const q = [...loadQueue(), bundle];
          saveQueue(q);
          setQueue(q);
          setMsg(c.savedLocal);
        },
        () => {
          const q = [...loadQueue(), bundle];
          saveQueue(q);
          setQueue(q);
          setMsg(c.savedNoGps);
        },
        { timeout: 5000 },
      );
    } else {
      const q = [...loadQueue(), bundle];
      saveQueue(q);
      setQueue(q);
      setMsg(c.savedPlain);
    }
  }

  async function sync() {
    const q = loadQueue();
    if (q.length === 0) return setMsg(c.queueEmpty);
    try {
      const r = await api<{ results: { bundleId: string; status: string }[] }>(
        "/v1/agent/verifications/sync",
        { method: "POST", body: JSON.stringify({ bundles: q }) },
      );
      const synced = new Set(r.results.map((x) => x.bundleId));
      const remaining = q.filter((b) => !synced.has(b.bundleId));
      saveQueue(remaining);
      setQueue(remaining);
      setMsg(c.uploaded(r.results.length));
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : c.uploadFailed);
    }
  }

  const Toggle = ({ label, k }: { label: string; k: keyof typeof form }) => (
    <label className="flex items-center gap-2 py-1">
      <input
        type="checkbox"
        checked={Boolean(form[k])}
        onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.checked }))}
      />
      <span className="text-sm font-bold">{label}</span>
    </label>
  );

  return (
    <main className="mx-auto max-w-xl px-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/"><Logo /></Link>
        <div className="flex items-center gap-3">
          <LanguageToggle />
          <button className="chip" onClick={sync}>
            {c.upload(queue.length)}
          </button>
        </div>
      </header>

      <div className="card p-5 space-y-3">
        <h1 className="font-bold text-xl text-sea">{c.title}</h1>
        <input
          dir="ltr"
          className="input"
          placeholder="Venue ID"
          value={form.venueId}
          onChange={(e) => setForm((f) => ({ ...f, venueId: e.target.value }))}
        />
        <label className="block text-sm font-bold">
          {c.evidenceLabel}
          <select
            className="input mt-1"
            value={form.identityEvidenceGrade}
            onChange={(e) =>
              setForm((f) => ({ ...f, identityEvidenceGrade: e.target.value as never }))
            }
          >
            <option value="deed">{c.deed}</option>
            <option value="utility_bill_attestation">{c.utilityBill}</option>
            <option value="local_attestation">{c.localAttestation}</option>
          </select>
        </label>

        <div className="rounded-xl bg-sand p-3">
          <p className="font-bold text-sm mb-1">{c.generatorTitle}</p>
          <Toggle label={c.generatorRan} k="generatorRan" />
          <div className="flex gap-2">
            <input
              dir="ltr"
              className="input !py-2"
              placeholder="KVA"
              value={form.generatorKva}
              onChange={(e) => setForm((f) => ({ ...f, generatorKva: e.target.value }))}
            />
          </div>
          <Toggle label={c.fuelIncluded} k="fuelIncluded" />
        </div>

        <label className="block text-sm font-bold">
          {c.waterLabel}
          <select
            className="input mt-1"
            value={form.waterSupply}
            onChange={(e) => setForm((f) => ({ ...f, waterSupply: e.target.value as never }))}
          >
            <option value="municipal">{c.municipal}</option>
            <option value="tank">{c.tank}</option>
            <option value="well">{c.well}</option>
            <option value="none">{c.none}</option>
          </select>
        </label>

        <div className="rounded-xl bg-sand p-3">
          <p className="font-bold text-sm mb-1">{c.privacyTitle}</p>
          <Toggle label={c.walledPool} k="walledPool" />
          <Toggle label={c.overlooked} k="overlooked" />
          <Toggle label={c.separateEntrance} k="separateFamilyEntrance" />
        </div>

        <div className="rounded-xl bg-sand p-3">
          <p className="font-bold text-sm mb-1">{c.safetyTitle}</p>
          <Toggle label={c.gasSane} k="gasStorageSane" />
          <Toggle label={c.poolDepthMarked} k="poolDepthMarked" />
        </div>

        {/*
          What's nearby. Laid out for a thumb in the sun: a native select for
          the kind, then the note in the widest field on the screen, because
          the note is the line a family will read and the name is not.
        */}
        <div className="rounded-xl bg-sand p-3">
          <p className="font-bold text-sm">{c.neighboursTitle}</p>
          <p className="text-xs text-muted mt-0.5 mb-2 leading-relaxed">{c.neighboursIntro}</p>
          <div className="space-y-3">
            {neighbours.map((n, i) => (
              <div key={i} className="rounded-xl bg-surface p-2 space-y-1.5">
                <div className="flex gap-1.5">
                  <select
                    className="input !py-2 !text-sm"
                    value={n.kind}
                    onChange={(e) => setNeighbour(i, "kind", e.target.value)}
                  >
                    {NEIGHBOUR_KIND_KEYS.map((k) => (
                      <option key={k} value={k}>
                        {NEIGHBOUR_KIND_EMOJI[k]} {term(NEIGHBOUR_KINDS_LABELS, locale, k)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label={c.nRemove}
                    className="chip shrink-0 px-3"
                    onClick={() => setNeighbours((list) => list.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                </div>
                <input
                  className="input !py-2 !text-sm"
                  dir="rtl"
                  lang="ar"
                  placeholder={c.nName}
                  value={n.nameAr}
                  onChange={(e) => setNeighbour(i, "nameAr", e.target.value)}
                />
                <div className="flex gap-1.5">
                  <input
                    className="input !py-2 !text-sm"
                    inputMode="numeric"
                    placeholder={c.nWalk}
                    value={n.walkMinutes}
                    onChange={(e) => setNeighbour(i, "walkMinutes", e.target.value)}
                  />
                  <input
                    className="input !py-2 !text-sm"
                    inputMode="numeric"
                    placeholder={c.nDrive}
                    value={n.driveMinutes}
                    onChange={(e) => setNeighbour(i, "driveMinutes", e.target.value)}
                  />
                  <button
                    type="button"
                    className={`chip shrink-0 whitespace-nowrap ${n.lat ? "badge-success" : ""}`}
                    onClick={() => pinNeighbour(i)}
                  >
                    {n.lat ? c.nPinned : c.nPin}
                  </button>
                </div>
                {/* The point of the whole section — so it is the biggest box. */}
                <textarea
                  className="input !py-2 min-h-16 font-bold"
                  dir="rtl"
                  lang="ar"
                  placeholder={c.nNote}
                  value={n.noteAr}
                  onChange={(e) => setNeighbour(i, "noteAr", e.target.value)}
                />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 mt-2">
            <button
              type="button"
              className="chip disabled:opacity-40"
              disabled={neighbours.length >= MAX_NEIGHBOURS}
              onClick={() => setNeighbours((list) => [...list, { ...EMPTY_NEIGHBOUR }])}
            >
              {c.nAdd}
            </button>
            <span className="text-xs text-muted">
              {c.nCount(neighbours.filter((n) => n.nameAr.trim()).length)}
              {neighbours.filter((n) => n.nameAr.trim()).length < 4 ? ` · ${c.nNeedFour}` : ""}
            </span>
          </div>
        </div>

        <textarea
          className="input min-h-20"
          placeholder={c.notesPlaceholder}
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
        />

        <button className="btn-amber w-full" onClick={capture}>
          {c.save}
        </button>
        {msg ? <p className="text-sm font-bold text-sea">{msg}</p> : null}
        <p className="text-xs text-faint">{c.photoNote}</p>
      </div>
    </main>
  );
}
