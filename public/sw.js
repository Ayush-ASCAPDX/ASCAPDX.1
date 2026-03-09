const CACHE_VERSION = "v6";
const STATIC_CACHE = `sc-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `sc-runtime-${CACHE_VERSION}`;
const API_CACHE = `sc-api-${CACHE_VERSION}`;
const MEDIA_CACHE = `sc-media-${CACHE_VERSION}`;
const CACHE_PREFIXES = ["sc-static-", "sc-runtime-", "sc-api-", "sc-media-"];

const APP_SHELL = [
  "/",
  "/chat",
  "/register",
  "/settings",
  "/profile",
  "/groups",
  "/groups/join",
  "/video",
  "/style.css",
  "/auth.js",
  "/theme.js",
  "/script.js",
  "/video.js",
  "/profile.js",
  "/groups.js",
  "/join-group.js",
  "/group.js",
  "/notifications-loader.js",
  "/call-notifications.js",
  "/pwa.js",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-maskable.svg",
  "/favicon.ico"
];

async function putInCache(cacheName, request, response) {
  if (!response || response.status !== 200) return;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;

  const overflow = keys.length - maxEntries;
  for (let index = 0; index < overflow; index += 1) {
    await cache.delete(keys[index]);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)))
        .filter((key) => ![STATIC_CACHE, RUNTIME_CACHE, API_CACHE, MEDIA_CACHE].includes(key))
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

async function networkFirst(request, cacheName, fallbackRequest = null, timeoutMs = 6000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timeoutId);
    putInCache(cacheName, request, response).catch(() => {});
    return response;
  } catch (_) {
    clearTimeout(timeoutId);
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;

    if (fallbackRequest) {
      const staticCache = await caches.open(STATIC_CACHE);
      const fallback = await staticCache.match(fallbackRequest);
      if (fallback) return fallback;
    }

    throw _;
  }
}

async function staleWhileRevalidate(request, cacheName, maxEntries = 200) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then((response) => {
      putInCache(cacheName, request, response).catch(() => {});
      trimCache(cacheName, maxEntries).catch(() => {});
      return response;
    })
    .catch(() => null);

  if (cached) {
    networkPromise.catch(() => {});
    return cached;
  }

  const network = await networkPromise;
  if (network) return network;

  return new Response("Offline", { status: 503, statusText: "Offline" });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.pathname.startsWith("/socket.io/")) return;

  // Navigation requests: prefer fresh HTML but allow offline fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      networkFirst(request, RUNTIME_CACHE, "/chat").catch(async () => {
        const cache = await caches.open(STATIC_CACHE);
        return cache.match("/chat") || cache.match("/") || Response.error();
      })
    );
    return;
  }

  // API GET requests: network-first with short timeout and cache fallback.
  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) {
    event.respondWith(
      networkFirst(request, API_CACHE, null, 4500).then(async (response) => {
        trimCache(API_CACHE, 120).catch(() => {});
        return response;
      }).catch(async () => {
        const cache = await caches.open(API_CACHE);
        return cache.match(request) || new Response(JSON.stringify({ error: "Offline" }), {
          status: 503,
          headers: { "Content-Type": "application/json" }
        });
      })
    );
    return;
  }

  // Media: cache-first-like SWR so re-open is much faster.
  if (url.origin === self.location.origin && url.pathname.startsWith("/media/")) {
    event.respondWith(
      staleWhileRevalidate(request, MEDIA_CACHE, 80)
    );
    return;
  }

  // Local static assets.
  if (url.origin === self.location.origin) {
    event.respondWith(
      staleWhileRevalidate(request, RUNTIME_CACHE, 220)
    );
  }
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = {};
  }

  const title = payload.title || "ASCAPDX Chat";
  const options = {
    body: payload.body || "You have a new notification.",
    icon: "/icon.svg",
    badge: "/icon-maskable.svg",
    tag: payload.tag || "chat-notification",
    data: {
      url: payload.url || "/chat",
      ...(payload.data || {})
    },
    requireInteraction: !!payload.requireInteraction
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || "/chat";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const absoluteTarget = new URL(targetUrl, self.location.origin).href;
      for (const client of clients) {
        if (client.url === absoluteTarget && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
