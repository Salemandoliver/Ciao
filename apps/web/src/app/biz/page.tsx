"use client";
/**
 * Ciao Business — the internal console.
 *
 * One place to run the company: what needs attention today, the supply
 * catalogue and how new businesses join it, the money, the people, the imagery
 * and settings that steer the public app, and the trail of who changed what.
 *
 * The role shown here is decoded from the access token for display only —
 * every endpoint re-checks the role server-side, so a tampered token buys
 * nothing but a differently-shaped screen.
 */
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Logo } from "@/components/logo";
import { ApiError, api, ensureSession, sessionRole } from "@/lib/api";
import { OverviewTab } from "./overview";
import { CatalogueTab } from "./catalogue";
import { FinanceTab } from "./finance";
import { PeopleTab } from "./people";
import { SettingsTab } from "./settings";
import { AuditTab } from "./audit";

const TABS = [
  ["overview", "📊", "نظرة عامة"],
  ["catalogue", "🏝", "الأنشطة"],
  ["finance", "💰", "المالية"],
  ["people", "👥", "المستخدمون"],
  ["settings", "⚙️", "الإعدادات"],
  ["audit", "📜", "سجل التدقيق"],
] as const;

type TabKey = (typeof TABS)[number][0];

function BizConsole() {
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<TabKey>((params.get("tab") as TabKey) ?? "overview");
  const [state, setState] = useState<"loading" | "ready" | "denied">("loading");
  const [role, setRole] = useState("");

  useEffect(() => {
    ensureSession().then(async (ok) => {
      if (!ok) return router.push("/login?next=/biz");
      try {
        // The overview is the cheapest ops-gated call — use it as the probe so
        // an under-privileged user gets one clear message, not six failures.
        await api("/v1/biz/overview?days=1");
        setState("ready");
        setRole(sessionRole());
      } catch (e) {
        setState(e instanceof ApiError && e.status === 403 ? "denied" : "ready");
      }
    });
  }, [router]);

  function go(next: TabKey) {
    setTab(next);
    window.history.replaceState(null, "", `/biz?tab=${next}`);
  }

  const isAdmin = role === "admin";

  return (
    <main className="mx-auto max-w-6xl px-4 pb-16">
      <header className="flex items-center justify-between gap-3 py-4">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Logo size={34} />
          </Link>
          <div>
            <h1 className="font-bold text-sea leading-tight">تشاو بزنس</h1>
            <p className="text-[11px] text-sea/55">النظام الداخلي لإدارة المنصّة</p>
          </div>
        </div>
        <nav className="flex items-center gap-2 text-xs font-bold text-sea">
          <Link href="/ops" className="chip">
            لوحة العمليات
          </Link>
          <Link href="/" className="chip">
            التطبيق
          </Link>
        </nav>
      </header>

      {state === "loading" ? (
        <p className="p-4 text-sea/60">جارٍ التحقق من الصلاحية…</p>
      ) : state === "denied" ? (
        <div className="card p-6 text-center">
          <p className="font-bold text-sea">هذه المنطقة لفريق تشاو الداخلي</p>
          <p className="text-sm text-sea/60 mt-2">
            تحتاج صلاحية «عمليات» أو «مدير». إن كنت من الفريق، اطلب من المدير رفع صلاحيتك.
          </p>
          <Link href="/" className="btn-primary !py-2 !text-sm inline-block mt-4">
            العودة للتطبيق
          </Link>
        </div>
      ) : (
        <>
          <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1">
            {TABS.map(([key, emoji, label]) => (
              <button
                key={key}
                onClick={() => go(key)}
                className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                  tab === key ? "bg-sea text-white" : "bg-white text-sea/70 hover:bg-sand"
                }`}
              >
                <span aria-hidden>{emoji}</span>
                {label}
              </button>
            ))}
          </div>

          <div className="mt-3">
            {tab === "overview" ? <OverviewTab /> : null}
            {tab === "catalogue" ? <CatalogueTab /> : null}
            {tab === "finance" ? <FinanceTab /> : null}
            {tab === "people" ? <PeopleTab isAdmin={isAdmin} /> : null}
            {tab === "settings" ? <SettingsTab isAdmin={isAdmin} /> : null}
            {tab === "audit" ? <AuditTab /> : null}
          </div>
        </>
      )}
    </main>
  );
}

export default function BizPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sea/60">…</p>}>
      <BizConsole />
    </Suspense>
  );
}
