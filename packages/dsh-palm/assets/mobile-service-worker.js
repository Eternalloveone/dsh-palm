/* PWA worker for the standalone /m mobile shell. */
/* Local patch (2026-08-23): never cache /m/mobile.js — on weak phone links the
   network-first fallback served a stale bundle (poll:A0Q0, no question panel).
   The bundle must always come from the network. Bumped the cache name so old
   cached bundles are purged on activate. */
/* Local patch (2026-08-28): the page now references /m/mobile.js?v=<hash>
   (content hash from mobile-routes). Bundle responses ARE cached under that
   versioned URL — repeat visits skip the ~120KB download, and an upgrade
   (new hash) fetches fresh bytes automatically. Old-version bundle entries
   are purged on activate. */
/* Local patch (2026-09-02): Web Push (L2) — push + notificationclick
   handlers for the completion-notify feature. Bumped the cache name so the
   new worker replaces the old one on activate. */
const CACHE_NAME = 'dsh-remote-mobile-shell-v4'
const OFFLINE_URL = '/m/offline.html'
const SHELL_PATHS = new Set([
  '/m/',
  '/m/manifest.webmanifest',
  '/m/apple-touch-icon.png',
  '/m/icon-192.png',
  '/m/icon-512.png',
  OFFLINE_URL,
])

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.add(OFFLINE_URL)))
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    for (const key of keys) {
      if (!key.startsWith('dsh-remote-mobile-shell-')) continue
      if (key !== CACHE_NAME) {
        await caches.delete(key)
        continue
      }
      // Drop every cached bundle entry: the current page already references
      // this activation's hash, so any older bundle key is dead weight.
      const cache = await caches.open(key)
      const requests = await cache.keys()
      for (const request of requests) {
        const url = new URL(request.url)
        if (url.pathname === '/m/mobile.js' && url.search !== '') await cache.delete(request)
      }
    }
  })())
})

/* Web Push (L2): show the notification the host pushed. The payload is the
   same shape the L1 channel delivers ({ title, body, tag, data }). */
self.addEventListener('push', event => {
  let title = 'DSH Remote'
  let body = ''
  let tag = ''
  let data = {}
  try {
    const parsed = event.data ? event.data.json() : {}
    if (typeof parsed.title === 'string' && parsed.title !== '') title = parsed.title
    if (typeof parsed.body === 'string') body = parsed.body
    if (typeof parsed.tag === 'string') tag = parsed.tag
    if (parsed.data !== null && typeof parsed.data === 'object') data = parsed.data
  } catch {
    // Non-JSON payload: fall back to the defaults.
  }
  event.waitUntil(self.registration.showNotification(title, {
    body,
    tag,
    icon: '/m/icon-192.png',
    data,
  }))
})

/* Notification click: focus an existing window or open one, deep-linked to
   the session the notification came from. */
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const target = event.notification.data
  const url = new URL('/m/', self.location.origin)
  if (target !== null && typeof target === 'object') {
    const record = target
    if (typeof record.workspaceId === 'string' && record.workspaceId !== '') {
      url.searchParams.set('workspace', record.workspaceId)
    }
    if (typeof record.sessionId === 'string' && record.sessionId !== '') {
      url.searchParams.set('session', record.sessionId)
    }
  }
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
    for (const client of windowClients) {
      if ('focus' in client) {
        client.focus()
        if ('navigate' in client) client.navigate(url.toString())
        return
      }
    }
    return clients.openWindow(url.toString())
  }))
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname === '/api' || url.pathname.startsWith('/api/') || url.pathname === '/m/api' || url.pathname.startsWith('/m/api/')) return

  // Versioned bundle: network-first, cached under the full URL (hash in the
  // query). A network failure falls back to the cached copy of the SAME
  // version — never a different one.
  if (url.pathname === '/m/mobile.js') {
    event.respondWith(networkFirst(request, request))
    return
  }

  const isMobileNavigation = request.mode === 'navigate' && (url.pathname === '/m/' || url.pathname === '/m')
  if (isMobileNavigation) {
    event.respondWith(networkFirst(request, OFFLINE_URL, false))
    return
  }

  if (SHELL_PATHS.has(url.pathname)) event.respondWith(networkFirst(request, url.pathname))
})

async function networkFirst(request, fallbackPath, allowCachedResponse = true) {
  try {
    const response = await fetch(request)
    if (response.status >= 500) throw new Error('mobile shell unavailable')
    if (response.ok && new URL(request.url).search === '') {
      const cache = await caches.open(CACHE_NAME)
      await cache.put(request, response.clone())
    }
    return response
  } catch {
    const cache = await caches.open(CACHE_NAME)
    if (allowCachedResponse) {
      const cached = await cache.match(request)
      if (cached !== undefined) return cached
    }

    const fallback = await cache.match(fallbackPath)
    if (fallback !== undefined) return fallback

    return new Response('', { status: 503, statusText: 'Service Unavailable' })
  }
}
