/**
 * Ciao service worker — §12.2 offline-first.
 *
 * The rule that governs everything here: **an HTML document and the JS chunks
 * it names are a matched set.** Next.js fingerprints every chunk with a build
 * hash, so page HTML from build A asks for `chunks/page-<hashA>.js`. Deploy
 * build B and those URLs stop existing.
 *
 * The first version of this file served HTML stale-while-revalidate, which
 * meant that after a deploy a returning user got cached HTML from the old
 * build whose chunks now 404 — React could not hydrate, and the browser showed
 * "Application error: a client-side exception has occurred". The app was fine;
 * the pairing was not.
 *
 * So the strategy is split by what each thing actually is:
 *
 *  - **Navigations (HTML): network-first.** An online user always gets HTML
 *    matching the deployed build. An offline user still gets the last good
 *    copy and then /offline — the §12.2 promise is kept, because a guest
 *    standing at a chalet gate during a blackout still needs their voucher.
 *  - **Build assets under `_next/static`: cache-first.** Those URLs are
 *    content-hashed and immutable, so the cache can never be stale, and every
 *    repeat visit skips the network — which is the whole game on Libyan 3G.
 *  - **Voucher data and pages: network-first**, cache-backed, as before.
 *
 * Cache names are versioned; bumping the version makes activate() purge every
 * older cache, so a browser holding a poisoned shell heals itself on reload.
 */
const VERSION = "v2";
const SHELL_CACHE = `ciao-shell-${VERSION}`;
const DATA_CACHE = `ciao-data-${VERSION}`;
const ASSET_CACHE = `ciao-assets-${VERSION}`;
const SHELL_URLS = ["/manifest.json", "/icon-192.svg", "/icon-512.svg", "/offline"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // Added individually: one missing icon must not fail the whole install
      // and leave the user with no service worker at all.
      .then((c) => Promise.all(SHELL_URLS.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

const CURRENT = [SHELL_CACHE, DATA_CACHE, ASSET_CACHE];

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !CURRENT.includes(k)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

/** Let a page tell a waiting worker to take over immediately. */
self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) {
    const copy = res.clone();
    caches.open(cacheName).then((c) => c.put(request, copy));
  }
  return res;
}

async function networkFirst(request, cacheName, fallbackUrl) {
  try {
    const res = await fetch(request);
    // Never cache a failure: a cached 404 is a bug that outlives the deploy.
    if (res.ok) {
      const copy = res.clone();
      caches.open(cacheName).then((c) => c.put(request, copy));
    }
    return res;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await caches.match(fallbackUrl);
      if (fallback) return fallback;
    }
    throw new Error("offline and uncached");
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 1. Build-hashed assets are immutable — cache-first is always correct here,
  //    and it is what makes a repeat visit cheap on a slow connection.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  // 2. Voucher data and voucher pages: network-first so the guest sees truth,
  //    cache-backed so a blackout can't lock them out of their own booking.
  const isVoucherData =
    url.pathname.startsWith("/v1/bookings/") || url.pathname === "/v1/my/bookings";
  const isVoucherPage = url.pathname.startsWith("/booking/");
  if (isVoucherData || isVoucherPage) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }

  // 3. Navigations: network-first, so HTML and its chunks always come from the
  //    same build. Offline falls back to the last good copy, then /offline.
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, SHELL_CACHE, "/offline"));
    return;
  }

  // 4. Everything else same-origin (images, fonts, manifest): cache-first.
  event.respondWith(cacheFirst(request, SHELL_CACHE).catch(() => caches.match("/offline")));
});
