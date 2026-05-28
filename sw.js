// Otherworld 2026 — service worker
//
// Goal: make the schedule open instantly and survive flaky festival
// cell signal. Three caches, three strategies:
//
//   1. Shell (HTML, CSS, JS, icons, manifest) — cache-first.
//      Refilled when SW_VERSION below is bumped.
//   2. Data (events.json, map-data.js, etc.) — stale-while-revalidate.
//      Serves the last-known copy instantly, refreshes in background.
//   3. Google Fonts — cache-first in its own bucket so font-host
//      outages don't blank the UI.
//
// Anything else (incl. map.webp, which app.js's MapImage already
// caches to localStorage as a base64 data URL) passes through to
// the network unchanged.
//
// Update model: silent. New SW activates on the next page reload.
// Appropriate for a schedule that auto-syncs hourly upstream — a
// "tap to reload" toast every hour would be annoying.

// Bump this string to invalidate the shell cache on the next visit.
// Format is just for humans; any change triggers a refill.
const SW_VERSION = "v6-2026-05-27-fav-hardening-4";

const SHELL_CACHE = "otherworld-shell-" + SW_VERSION;
const DATA_CACHE = "otherworld-data";
const FONTS_CACHE = "otherworld-fonts";

// All caches we own — used by activate() to delete anything stale.
const OWNED_CACHES = new Set([SHELL_CACHE, DATA_CACHE, FONTS_CACHE]);

const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/site.webmanifest",
  "/favicon-16.png",
  "/favicon-32.png",
  "/apple-touch-icon.png",
  "/icon-180.png",
  "/icon-192.png",
  "/icon-512.png",
  "/logo.png",
];

// Same-origin paths that should be stale-while-revalidate.
// Everything else same-origin falls through to the network.
const DATA_PATHS = new Set([
  "/events.json",
  "/data.js",
  "/camp-aliases.json",
  "/map-data.js",
  "/map-locations.json",
  "/map-labels.json",
]);

// ── install: pre-cache the shell ─────────────────────────────────
self.addEventListener("install", event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // addAll is atomic — if any single asset 404s, the whole
      // install fails and the old SW stays in charge. That's the
      // right safety property: better to keep working old code than
      // ship a broken cache. Wrap each in Request with no-cache so
      // we always pull a fresh copy from the network on install.
      await cache.addAll(
        SHELL_ASSETS.map(p => new Request(p, { cache: "reload" }))
      );
      // Take over from any older SW as soon as install finishes,
      // rather than waiting for all tabs to close.
      await self.skipWaiting();
    })()
  );
});

// ── activate: drop stale shell caches, take control of open tabs ─
self.addEventListener("activate", event => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.map(n => {
          // Delete any otherworld-* cache we don't currently own.
          if (n.startsWith("otherworld-") && !OWNED_CACHES.has(n)) {
            return caches.delete(n);
          }
          return null;
        })
      );
      await self.clients.claim();
    })()
  );
});

// ── fetch: route by URL ──────────────────────────────────────────
self.addEventListener("fetch", event => {
  const req = event.request;

  // Only handle GETs. POST/PUT/etc. always pass through.
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Google Fonts: cache-first in their own bucket. Two hosts:
  // fonts.googleapis.com (CSS) and fonts.gstatic.com (woff2).
  if (
    url.hostname === "fonts.googleapis.com" ||
    url.hostname === "fonts.gstatic.com"
  ) {
    event.respondWith(cacheFirst(req, FONTS_CACHE));
    return;
  }

  // Same-origin only from here on. Cross-origin (other than fonts
  // above) passes through untouched.
  if (url.origin !== self.location.origin) return;

  // Data files — stale-while-revalidate.
  if (DATA_PATHS.has(url.pathname)) {
    event.respondWith(staleWhileRevalidate(req, DATA_CACHE));
    return;
  }

  // Shell assets — cache-first. We match both exact pathname and
  // the root "/" → "/index.html" navigation case.
  const isNavigation = req.mode === "navigate";
  const isShellPath =
    SHELL_ASSETS.includes(url.pathname) ||
    (isNavigation && url.pathname === "/");
  if (isShellPath) {
    event.respondWith(cacheFirst(req, SHELL_CACHE));
    return;
  }

  // Navigations to unknown routes (404, deep links) — try network,
  // fall back to cached index.html so the SPA can render its own
  // error/empty state instead of a browser error page.
  if (isNavigation) {
    event.respondWith(networkFirstWithShellFallback(req));
    return;
  }

  // Everything else (map.webp, fonts not yet matched, third-party
  // images) — passthrough.
});

// ── strategies ───────────────────────────────────────────────────

// Try cache, fall back to network. On network success, refresh the
// cache entry so future hits get the newer copy. Network failures
// while uncached → propagate the error to the page.
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) {
    // Refresh in background so the cache doesn't drift forever.
    // Don't await — the cached response is what we return.
    fetch(req)
      .then(resp => {
        if (resp && resp.ok) cache.put(req, resp.clone());
      })
      .catch(() => {});
    return cached;
  }
  const resp = await fetch(req);
  if (resp && resp.ok) cache.put(req, resp.clone());
  return resp;
}

// Return cached copy instantly (if any), kick off a network fetch
// to update the cache for next time. If nothing is cached, await
// the network.
async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const networkPromise = fetch(req)
    .then(resp => {
      if (resp && resp.ok) cache.put(req, resp.clone());
      return resp;
    })
    .catch(() => null);
  return cached || (await networkPromise) || new Response("", { status: 504 });
}

// Used for SPA navigations to non-shell paths. Try network first,
// fall back to cached index.html so the user at least sees the app
// chrome instead of an error page.
async function networkFirstWithShellFallback(req) {
  try {
    const resp = await fetch(req);
    if (resp && resp.ok) return resp;
    throw new Error("non-ok");
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    const fallback = await cache.match("/index.html");
    return fallback || new Response("", { status: 504 });
  }
}
