// Offline support.
//
// - Page loads (navigations) are NETWORK-FIRST: online, you always get the newest version;
//   offline (or if the network takes longer than NAV_TIMEOUT_MS), the cached copy is used.
// - Everything else on our own origin (hashed JS and CSS, images) is cache-first with a
//   background refresh. Hashed file names never change content, so this is safe and fast.
// - Cross-origin requests (YouTube, direct audio links) are never touched here.
//
// The first visit must be online. Right after registering, the page sends this worker the
// list of files it just loaded and they are cached, so the very next load can be offline.
//
// History: the first version served pages stale-while-revalidate without event.waitUntil, so
// the browser could stop the worker before the refresh finished and users stayed on an old
// build. Bumping CACHE below discards those old entries.
const CACHE = 'instrumento-v2';
const NAV_TIMEOUT_MS = 4000;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// ignoreVary: we keep exactly one copy per URL. Servers send `Vary: Origin`, and module
// scripts and stylesheets loaded with the crossorigin attribute carry an Origin header that
// the copies stored by cache.add() do not, so without this they never match.
const lookup = (cache, request) => cache.match(request, { ignoreVary: true });

async function networkFirst(event, cache, request) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NAV_TIMEOUT_MS);
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);
    if (response.ok) event.waitUntil(cache.put(request, response.clone()));
    return response;
  } catch {
    return (await lookup(cache, request)) ?? Response.error();
  }
}

async function cacheFirst(event, cache, request) {
  const cached = await lookup(cache, request);
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) return cache.put(request, response.clone()).then(() => response);
      return response;
    })
    .catch(() => undefined);
  // waitUntil keeps the worker alive until the refresh is stored.
  event.waitUntil(refresh);
  return cached ?? (await refresh) ?? Response.error();
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches
      .open(CACHE)
      .then((cache) =>
        request.mode === 'navigate' ? networkFirst(event, cache, request) : cacheFirst(event, cache, request),
      ),
  );
});

// The page lists the same-origin files it loaded (the first load happens before this worker
// controls the page, so the fetch handler above never saw those requests). allSettled so one
// missing file (for example a favicon 404) cannot stop the rest from being cached.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'precache' || !Array.isArray(event.data.urls)) return;
  event.waitUntil(
    caches.open(CACHE).then((cache) => Promise.allSettled(event.data.urls.map((url) => cache.add(url)))),
  );
});
