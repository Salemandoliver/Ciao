/**
 * Ciao service worker — §12.2 offline-first.
 * App-shell cache + offline availability of my-bookings/vouchers.
 * Storage budget kept small (<25MB) for 1GB-RAM devices.
 */
const SHELL_CACHE = "ciao-shell-v1";
const DATA_CACHE = "ciao-data-v1";
const SHELL_URLS = ["/", "/manifest.json", "/icon-192.svg", "/icon-512.svg", "/offline"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_URLS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;

  // Booking vouchers + my-bookings: network-first, fall back to cache (§12.2).
  const isVoucherData =
    url.pathname.startsWith("/v1/bookings/") || url.pathname === "/v1/my/bookings";
  const isVoucherPage = url.pathname.startsWith("/booking/");

  if (isVoucherData || isVoucherPage) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(DATA_CACHE).then((c) => c.put(event.request, copy));
          return res;
        })
        .catch(() => caches.match(event.request)),
    );
    return;
  }

  // Static assets & pages: stale-while-revalidate.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const network = fetch(event.request)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(SHELL_CACHE).then((c) => c.put(event.request, copy));
            }
            return res;
          })
          .catch(() => cached ?? caches.match("/offline"));
        return cached ?? network;
      }),
    );
  }
});
