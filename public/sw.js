// Offline support. Stale-while-revalidate for same-origin GET requests: serve from cache
// immediately if we have it, refresh the cache from the network in the background.
//
// Consequences worth knowing:
// - The first visit must be online. Right after registering, the page sends this worker the
//   list of files it just loaded, and they are cached, so the very next load can be offline.
// - After a redeploy, the first reload still shows the old version; the next one shows the
//   new one. Hashed asset names keep old and new files from mixing.
// - Cross-origin requests (Spotify, YouTube, direct audio links) are never touched here.
const CACHE = 'instrumento-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      // ignoreVary: we keep exactly one copy per URL. Servers send `Vary: Origin`, and module
      // scripts and stylesheets loaded with the crossorigin attribute carry an Origin header
      // that the copies stored by cache.add() do not, so without this they never match.
      const cached = await cache.match(request, { ignoreVary: true });
      const refresh = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached ?? Response.error());
      return cached ?? refresh;
    }),
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
