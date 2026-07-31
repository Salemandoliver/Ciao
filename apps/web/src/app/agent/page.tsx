"use client";
/**
 * Field Agent capture — §8.10.
 * Offline-first checklist runner: bundles queue in localStorage and sync when
 * coverage returns. Output: a listing 90% publish-ready before leaving the driveway.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/logo";
import { api, ensureSession, ApiError } from "@/lib/api";

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
  notes?: string;
}

const QUEUE_KEY = "ciao_agent_queue";

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

  useEffect(() => {
    ensureSession().then((ok) => {
      if (!ok) return router.push("/login?next=/agent");
      setQueue(loadQueue());
    });
  }, [router]);

  function capture() {
    if (!form.venueId) return setMsg("أدخل معرّف المكان (يصلك من العمليات)");
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
          setMsg("حُفظ محليًا ✓ — سيُرفع عند توفر الشبكة");
        },
        () => {
          const q = [...loadQueue(), bundle];
          saveQueue(q);
          setQueue(q);
          setMsg("حُفظ محليًا (بدون GPS) ✓");
        },
        { timeout: 5000 },
      );
    } else {
      const q = [...loadQueue(), bundle];
      saveQueue(q);
      setQueue(q);
      setMsg("حُفظ محليًا ✓");
    }
  }

  async function sync() {
    const q = loadQueue();
    if (q.length === 0) return setMsg("لا حزم بانتظار الرفع");
    try {
      const r = await api<{ results: { bundleId: string; status: string }[] }>(
        "/v1/agent/verifications/sync",
        { method: "POST", body: JSON.stringify({ bundles: q }) },
      );
      const synced = new Set(r.results.map((x) => x.bundleId));
      const remaining = q.filter((b) => !synced.has(b.bundleId));
      saveQueue(remaining);
      setQueue(remaining);
      setMsg(`رُفعت ${r.results.length} حزمة ✓`);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "الشبكة ضعيفة — الحزم محفوظة، أعد المحاولة لاحقًا");
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
        <Link href="/"><Logo size={36} /></Link>
        <button className="chip" onClick={sync}>
          ⬆ رفع ({queue.length} بانتظار)
        </button>
      </header>

      <div className="card p-5 space-y-3">
        <h1 className="font-bold text-xl text-sea">توثيق ميداني — قائمة الفحص</h1>
        <input
          dir="ltr"
          className="input"
          placeholder="Venue ID"
          value={form.venueId}
          onChange={(e) => setForm((f) => ({ ...f, venueId: e.target.value }))}
        />
        <label className="block text-sm font-bold">
          إثبات الملكية / التفويض الذي عاينته:
          <select
            className="input mt-1"
            value={form.identityEvidenceGrade}
            onChange={(e) =>
              setForm((f) => ({ ...f, identityEvidenceGrade: e.target.value as never }))
            }
          >
            <option value="deed">صك ملكية</option>
            <option value="utility_bill_attestation">فاتورة مرافق + إقرار</option>
            <option value="local_attestation">شهادة وجيه محلي</option>
          </select>
        </label>

        <div className="rounded-xl bg-sand p-3">
          <p className="font-bold text-sm mb-1">⚡ المولّد — يجب تشغيله فعليًا</p>
          <Toggle label="شغّلت المولّد بنفسي وهو يعمل" k="generatorRan" />
          <div className="flex gap-2">
            <input
              dir="ltr"
              className="input !py-2"
              placeholder="KVA"
              value={form.generatorKva}
              onChange={(e) => setForm((f) => ({ ...f, generatorKva: e.target.value }))}
            />
          </div>
          <Toggle label="الوقود مشمول في السعر" k="fuelIncluded" />
        </div>

        <label className="block text-sm font-bold">
          💧 مصدر المياه:
          <select
            className="input mt-1"
            value={form.waterSupply}
            onChange={(e) => setForm((f) => ({ ...f, waterSupply: e.target.value as never }))}
          >
            <option value="municipal">شبكة عامة</option>
            <option value="tank">خزان</option>
            <option value="well">بئر</option>
            <option value="none">لا يوجد</option>
          </select>
        </label>

        <div className="rounded-xl bg-sand p-3">
          <p className="font-bold text-sm mb-1">🔒 تقييم الستر</p>
          <Toggle label="المسبح مسوَّر بالكامل" k="walledPool" />
          <Toggle label="مكشوف على الجيران" k="overlooked" />
          <Toggle label="مدخل عائلي منفصل" k="separateFamilyEntrance" />
        </div>

        <div className="rounded-xl bg-sand p-3">
          <p className="font-bold text-sm mb-1">⚠️ أساسيات السلامة</p>
          <Toggle label="تخزين الغاز سليم" k="gasStorageSane" />
          <Toggle label="عمق المسبح مُعلَّم" k="poolDepthMarked" />
        </div>

        <textarea
          className="input min-h-20"
          placeholder="ملاحظات (تسعير مقترح، حالة الطريق، ملاحظات المضيف…)"
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
        />

        <button className="btn-amber w-full" onClick={capture}>
          📸 احفظ الحزمة (يعمل بدون شبكة)
        </button>
        {msg ? <p className="text-sm font-bold text-sea">{msg}</p> : null}
        <p className="text-xs text-sea/50">
          الصور تُرفع من تطبيق الكاميرا الموجّه (قريبًا) — حاليًا ترسلها للعمليات عبر
          واتساب مع رقم الحزمة.
        </p>
      </div>
    </main>
  );
}
