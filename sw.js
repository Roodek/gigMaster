const CACHE_NAME = 'gigmaster-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  'https://cdn.tailwindcss.com',
  'https://esm.sh/react@^19.2.1/',
  'https://esm.sh/react@^19.2.1',
  'https://esm.sh/lucide-react@^0.559.0',
  'https://esm.sh/react-dom@^19.2.1/',
  'https://esm.sh/pdfjs-dist@3.11.174',
  'https://esm.sh/pdfjs-dist@3.11.174/',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
];

// Install event: cache core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Activate event: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event: Network first, fall back to cache for HTML/API, Cache first for static assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // For external CDNs (modules, tailwind), use Stale-While-Revalidate
  // This ensures fast load but updates eventually
  if (url.hostname === 'cdn.tailwindcss.com' || url.hostname === 'esm.sh' || url.hostname === 'cdn-icons-png.flaticon.com' || url.hostname === 'cdnjs.cloudflare.com') {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((cachedResponse) => {
          const fetchPromise = fetch(event.request).then((networkResponse) => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
          return cachedResponse || fetchPromise;
        });
      })
    );
    return;
  }

  // For local files, try network first, then cache (to ensure development updates are seen)
  // In a production build, you might want Cache First for hashed assets.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Check if we received a valid response
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});