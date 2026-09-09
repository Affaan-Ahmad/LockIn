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
 * Offline, a navigation falls back to `/offline` — a static page that says so
 * plainly. It does NOT show stale coursework, because the coursework was never
 * cached. That is a smaller offline experience than a note-taking app would
 * offer, and it is the honest one for a product whose whole promise is that a
 * deadline shown is a deadline that is current.
 *
 * Online, the win is start-up: the app shell's JavaScript comes from disk
 * instead of the network, so a cold launch of the installed app paints in one
 * round trip instead of several.
 */

const VERSION = 'v1';
const STATIC_CACHE = `lockin-static-${VERSION}`;
const SHELL_CACHE = `lockin-shell-${VERSION}`;

/** Fetched on install so the offline page is available before it is needed. */
const SHELL_URLS = ['/offline'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individually, not addAll: addAll rejects the whole install if any one
      // request fails, and a service worker that refuses to install because an
      // icon 404'd is worse than one missing an icon.
      await Promise.all(
        SHELL_URLS.map(async (url) => {
          try {
            const response = await fetch(url, { cache: 'reload' });
            if (response.ok) await cache.put(url, response);
          } catch {
            /* Offline during install. The fetch handler copes. */
          }
        }),
      );
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
    return await fetch(request);
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
