"use client";
/**
 * Service-worker registration, plus a self-heal for stale-shell crashes.
 *
 * A PWA that caches its own shell can strand a user on a build that no longer
 * exists: the HTML is cached, its fingerprinted chunks are gone, and the page
 * dies with "a client-side exception has occurred". sw.js is now written so
 * this cannot happen going forward (navigations are network-first), but a
 * browser already holding a poisoned cache needs a way out — and someone
 * staring at a blank error page has no reason to guess "hard-reload".
 *
 * So: catch the chunk-load failure, clear the caches, drop the worker, and
 * reload exactly once. The one-shot guard matters more than the fix — a reload
 * loop is worse than the error it replaces.
 */
import { useEffect } from "react";

const HEAL_FLAG = "ciao_sw_healed";

/** Chunk failures surface with a few different shapes across browsers. */
function isStaleChunkError(message: string): boolean {
  return (
    /ChunkLoadError/i.test(message) ||
    /Loading chunk [\w-]+ failed/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message)
  );
}

async function heal() {
  if (sessionStorage.getItem(HEAL_FLAG)) return; // already tried once this session
  sessionStorage.setItem(HEAL_FLAG, "1");
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  } catch {
    /* clearing is best-effort — reload regardless */
  }
  window.location.reload();
}

export function SwRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register("/sw.js")
      // Ask the browser to re-check sw.js now rather than on its own schedule,
      // so a fix reaches returning users on their next visit, not their fifth.
      .then((reg) => reg.update().catch(() => {}))
      .catch(() => {});

    const onError = (e: ErrorEvent) => {
      if (isStaleChunkError(e.message ?? "")) void heal();
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason as { message?: string; name?: string } | undefined;
      if (isStaleChunkError(`${reason?.name ?? ""} ${reason?.message ?? ""}`)) void heal();
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
