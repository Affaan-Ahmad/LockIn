/*
 * LockIn service worker.
 *
 * WHAT THIS CACHES, AND WHY THE LIST IS SO SHORT
 * ==============================================
 *
 * Two things only:
 *
 *   1. `/_next/static/*` — the build's own JavaScript, CSS and fonts. Every one
 *      of these URLs carries a content hash, so a given URL can only ever mean
 *      one set of bytes. They are identical for every visitor and contain no
 *      user data, which is what makes them safe to keep.
 *
 *   2. The offline page and the app icons. Static, public, and the same for
 *      everyone.
 *
 * NOTHING ELSE IS CACHED. Specifically and deliberately:
 *
 *   - No `/api/*`. Those responses are one student's coursework, and a cache is
 *     shared by every profile using this browser. A cached assignment list
 *     handed to the next person who signs in is the exact failure this file is
 *     written to avoid.
 *
 *   - No navigation responses. Every screen in this app is server-rendered
 *     *for the signed-in user* — Today contains their deadlines, Settings their
 *     email address. Caching that HTML would persist one account's data and
 *     serve it to whoever opened the app next.
 *
 *   - Nothing with a `Vary: Cookie`, nothing opaque, nothing cross-origin.
 *
 * The rule this follows: if a response could differ between two signed-in
 * users, it does not go in the cache. Where that is uncertain, it does not go
 * in the cache either.
 *
 * WHAT THE STUDENT ACTUALLY GETS
 * ==============================
 *
 * Offline, a navigation falls back to `/offline`. That page reads the snapshot
 * the Today screen wrote to IndexedDB on this device and renders it, clearly
 * labelled as a memory rather than a reading — see `src/features/offline`.
 *
 * IndexedDB, not this cache, is where that coursework lives. The distinction
 * matters: this cache is keyed by URL and shared by everything on the origin,
 * whereas the snapshot is a single record stamped with whose it is, wiped when
 * the account changes. One is a place for public bytes; the other is the only
 * place a student's data is allowed to rest on the device.
 *
 * Online, the win is start-up: the app shell's JavaScript comes from disk
 * instead of the network, so a cold launch of the installed app paints in one
 * round trip instead of several.
 */

const VERSION = 'v3';
const STATIC_CACHE = `lockin-static-${VERSION}`;
const SHELL_CACHE = `lockin-shell-${VERSION}`;

/** Fetched on install so the offline page is available before it is needed. */
const SHELL_URLS = ['/offline'];

/**
 * Caches the offline page, and the scripts it needs to actually run.
 *
 * Caching the HTML alone is not enough any more. The offline page reads a local
 * snapshot and renders it, so it is a client component: without its JavaScript
 * it paints a heading and then sits there, which is a worse failure than the
 * plain page it replaced because it looks like it is about to work.
 *
 * The chunk filenames carry a build hash and cannot be written down here, so
 * they are read out of the page's own markup at install time. Most are shared
 * with the rest of the app and would be cached anyway on the first navigation;
 * the page's own chunk is the one that would otherwise be missing at exactly
 * the moment it cannot be fetched.
 */
async function precacheOfflinePage(cache) {
  for (const url of SHELL_URLS) {
    try {
      const response = await fetch(url, { cache: 'reload' });
      if (!response.ok) continue;

      const html = await response.clone().text();
      await cache.put(url, response);

      const assets = new Set();
      const pattern = /["'](\/_next\/static\/[^"']+?\.(?:js|css))["']/g;
      let match;
      while ((match = pattern.exec(html)) !== null) assets.add(match[1]);

      const staticCache = await caches.open(STATIC_CACHE);
      await Promise.all(
        [...assets].map(async (asset) => {
          try {
            const assetResponse = await fetch(asset);
            if (assetResponse.ok) await staticCache.put(asset, assetResponse);
          } catch {
            /* One missing chunk should not fail the install. */
          }
        }),
      );
    } catch {
      /* Offline during install. The fetch handler copes. */
    }
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individually, not addAll: addAll rejects the whole install if any one
      // request fails, and a service worker that refuses to install because an
      // icon 404'd is worse than one missing an icon.
      await precacheOfflinePage(cache);
      // Take over promptly. The alternative is a new worker sitting in
      // `waiting` until every tab closes, which on an installed app can be days.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC_CACHE, SHELL_CACHE]);
      const names = await caches.keys();
      await Promise.all(names.map((name) => (keep.has(name) ? null : caches.delete(name))));
      await self.clients.claim();
    })(),
  );
});

/**
 * Refreshed once per worker startup, on the first navigation that reaches the
 * network.
 *
 * `install` runs only when this file's *bytes* change, and the offline page is
 * not this file. A deploy that fixes the offline page while leaving sw.js alone
 * therefore leaves the old copy cached forever, with no event to correct it --
 * which is exactly what happened: a CSP fix landed in the page, the worker never
 * noticed, and installs kept serving markup whose scripts the policy refused.
 * Bumping VERSION fixes that occurrence; this stops the next one.
 *
 * Reinstalling the app does not help either, which is worth knowing before
 * anyone is asked to try it. A worker and its caches belong to the browser's
 * storage for the origin, not to the home-screen shortcut.
 *
 * Once per startup is the right frequency: enough that any deploy is picked up
 * the next time the app is opened with a connection, rare enough to be invisible
 * -- and it is never awaited, so the navigation that triggered it does not wait.
 */
let shellRefreshed = false;

function refreshShellSoon() {
  if (shellRefreshed) return;
  shellRefreshed = true;
  void (async () => {
    try {
      const cache = await caches.open(SHELL_CACHE);
      await precacheOfflinePage(cache);
    } catch {
      /* The next startup tries again. */
    }
  })();
}

/** Content-hashed build output: same URL, same bytes, no user in it. */
function isImmutableAsset(url) {
  return url.pathname.startsWith('/_next/static/');
}

/** Public, static, and identical for everyone. */
function isPublicIcon(url) {
  return (
    url.pathname === '/icon.svg' ||
    url.pathname === '/icon' ||
    url.pathname === '/apple-icon' ||
    url.pathname === '/maskable-icon'
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Anything that is not a plain GET is a mutation or an upload. Never touched.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Someone else's origin is someone else's problem.
  if (url.origin !== self.location.origin) return;

  // The API carries one student's coursework and their connection state. It is
  // passed straight through, uncached, every time.
  if (url.pathname.startsWith('/api/')) return;

  if (isImmutableAsset(url)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (isPublicIcon(url)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(navigateOrOffline(request));
    return;
  }

  // Everything else falls through to the network untouched.
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit !== undefined) return hit;

  const response = await fetch(request);
  // Only complete, same-origin successes. An opaque or partial response tells
  // us nothing about what it contains, so it is not kept.
  if (response.ok && response.type === 'basic') {
    await cache.put(request, response.clone());
  }
  return response;
}

/**
 * Network first, and the response is never stored.
 *
 * The page being requested is rendered for whoever is signed in. Keeping a copy
 * would mean serving one account's screen to the next person to open the app.
 * So on success it is passed straight through, and on failure the student gets
 * a page that says the connection is gone rather than a browser error.
 */
async function navigateOrOffline(request) {
  try {
    const response = await fetch(request);
    // The connection is up, so this is the moment to make sure the copy kept
    // for when it is not still matches what the server is serving.
    refreshShellSoon();
    return response;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    const offline = await cache.match('/offline');
    if (offline !== undefined) return offline;
    return new Response('You are offline.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
