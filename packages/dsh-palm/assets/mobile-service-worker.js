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
/* Local patch (2026-09-11): the versioned bundle is cache-FIRST. The 08-28
   patch claimed repeat visits skipped the download, but networkFirst fetches
   every time and its cache write is skipped for query URLs — so the page's
   /m/mobile.js?v=<hash> request was never cached and every open re-downloaded
   the whole bundle (~152 KB brotli, 269 KB before the minify work). The page
   always carries the content hash and mobile-routes serves those bytes
   unchanged for the process lifetime, so same URL means same bytes: a cache
   hit is always correct. The unversioned URL keeps network-first. Bumped the
   cache name so old entries are purged on activate. */
/* Local patch (2026-10-21): the surface split into content-hashed chunks under
   /m/mobile/ (chat + settings views, lazy-loaded). Chunks are cache-first like
   the versioned bundle; any stale entry is dropped on activate together with
   the previous shell cache, so the bumped name below also clears the chunks the
   old bundle referenced. */
// Build hash is injected by the host when it serves this file
// (`mobile-routes.ts` substitutes __BUILD_HASH__ with the current bundle hash).
// A new build therefore ships different worker bytes, which is what makes the
// browser install a new worker and run the activate cleanup below. A hardcoded
// name (the old `-v6`) meant bundle-only releases never touched the cache and
// old bundles piled up forever, eating the IndexedDB/outbox quota.
const BUILD_HASH = '__BUILD_HASH__'
const CACHE_NAME = `dsh-remote-mobile-shell-${BUILD_HASH}`
const OFFLINE_URL = '/m/offline.html'
/**
 * The shell document, cached under a query-less key. A navigation carries
 * `?workspace=…&session=…`, so the request URL can never be the cache key; any
 * offline navigation is answered with this one shell (the SPA reads the query
 * from `location` after boot).
 */
const SHELL_URL = '/m/'
const SHELL_PATHS = new Set([
  '/m/',
  '/m/manifest.webmanifest',
  '/m/apple-touch-icon.png',
  '/m/icon-192.png',
  '/m/icon-512.png',
  OFFLINE_URL,
])

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME)
    await cache.add(OFFLINE_URL)
    // Precache the exact bundle the page currently references. The page's own
    // request cannot populate the cache until this worker controls it, so
    // without this the first controlled load still pays the download and an
    // offline open has no bundle at all. The URL carries the content hash, so
    // the entry can never go stale.
    try {
      const page = await fetch('/m/', { cache: 'no-store' })
      // Cache the shell itself (not only its bundle): an offline phone must be
      // able to boot the cached app and show cached conversations, instead of
      // the static offline page.
      await cache.put(SHELL_URL, page.clone())
      const html = await page.text()
      const match = /src="(\/m\/mobile\.js\?v=[0-9a-f]{8})"/.exec(html)
      if (match !== null) await cache.add(match[1])
    } catch {
      // Offline install or an unreachable host: the cache-first path fills the
      // entry on the next successful load instead.
    }
    // Take over on the next page load instead of waiting for every client to
    // close: an iOS home-screen PWA is frozen, not destroyed, so "waiting" can
    // last for days and the user keeps the old build.
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    for (const key of keys) {
      // Every build gets its own cache (name carries the build hash); anything
      // else is from an older build and is dead weight.
      if (key.startsWith('dsh-remote-mobile-shell-') && key !== CACHE_NAME) {
        await caches.delete(key)
      }
    }
    // NOTE: the current cache must NOT be pruned here. It used to delete every
    // `/m/mobile.js?v=…` entry and every `/m/mobile/` chunk, which is exactly
    // what install had just precached — making the precache 100% wasted work.
    await self.clients.claim()
  })())
})

/* Web Push (L2): show the notification the host pushed. The payload is the
   same shape the L1 channel delivers ({ title, body, tag, data }). */
self.addEventListener('push', event => {
  let title = 'DSH Remote'
  let body = ''
  let tag = ''
  let data = {}
  let actions = []
  try {
    const parsed = event.data ? event.data.json() : {}
    if (typeof parsed.title === 'string' && parsed.title !== '') title = parsed.title
    if (typeof parsed.body === 'string') body = parsed.body
    if (typeof parsed.tag === 'string') tag = parsed.tag
    if (parsed.data !== null && typeof parsed.data === 'object') data = parsed.data
    // Lock-screen buttons. Chrome/Android render these on the notification;
    // iOS ignores the field entirely (its Web Push has no action support), so
    // the same payload still lands there as a plain tap-through.
    if (Array.isArray(parsed.actions)) {
      actions = parsed.actions
        .filter(action => action !== null && typeof action === 'object' && typeof action.action === 'string')
        .map(action => ({ action: action.action, title: String(action.title ?? action.action) }))
    }
  } catch {
    // Non-JSON payload: fall back to the defaults.
  }
  event.waitUntil(self.registration.showNotification(title, {
    body,
    tag,
    icon: '/m/icon-192.png',
    data,
    ...(actions.length > 0 ? { actions } : {}),
  }))
})

/* Answer an approval straight from the notification — no app, no window.
   Returns a short verdict string for the toast. */
async function answerFromNotification(record, action) {
  const rpcId = typeof record.decisionRpcId === 'string' ? record.decisionRpcId : ''
  const approvalId = typeof record.decisionId === 'string' ? record.decisionId : ''
  const sessionId = typeof record.sessionId === 'string' ? record.sessionId : ''
  if (rpcId === '' || approvalId === '' || sessionId === '') return '这个审批已经过期'
  const outcome = action === 'allow' ? 'allowed-once' : 'rejected'
  try {
    const response = await fetch('/m/api/mobile.respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        rpcId: `sw-${Date.now().toString(36)}`,
        payload: { rpcId, response: { sessionId, approvalId, outcome } },
      }),
    })
    const body = await response.json()
    const result = body && body.result ? body.result : {}
    if (result.ok === true) return outcome === 'allowed-once' ? '已允许' : '已拒绝'
    const message = result.error && typeof result.error.message === 'string' ? result.error.message : '答复失败'
    return message
  } catch {
    return '网络不可用，请打开 app 处理'
  }
}

/* Notification click: focus an existing window or open one, deep-linked to
   the session the notification came from. When the tap was one of the
   lock-screen buttons, answer instead and stay out of the way. */
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
    // Tapping the body of a decision notification lands ON the decision, not
    // on the session: iOS has no action buttons, so this is how a blocked
    // turn gets answered there without hunting for the panel.
    if (typeof record.decisionId === 'string' && record.decisionId !== '') {
      url.searchParams.set('decision', record.decisionId)
      if (typeof record.decisionKind === 'string' && record.decisionKind !== '') {
        url.searchParams.set('decisionKind', record.decisionKind)
      }
    }
    const action = typeof event.action === 'string' ? event.action : ''
    if ((action === 'allow' || action === 'deny') && record.decisionKind === 'approval') {
      event.waitUntil(answerFromNotification(record, action).then(verdict => self.registration.showNotification(verdict, {
        tag: 'dsh-verdict',
        icon: '/m/icon-192.png',
        silent: true,
      })).catch(() => {}))
      return
    }
  }
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
    for (const client of windowClients) {
      if ('focus' in client) {
        client.focus()
        // 已经在这个目标上（同 path+query）就只聚焦，不 navigate：
        // 旧实现无条件 navigate → 点通知会把正在看的会话整页重载（滚动位置、
        // 输入框草稿、展开状态全丢）。换成"只在目标不同时才跳"。
        const sameTarget = (() => {
          try {
            const current = new URL(client.url)
            return current.pathname + current.search === url.pathname + url.search
          } catch {
            return false
          }
        })()
        if (!sameTarget && 'navigate' in client) client.navigate(url.toString())
        return
      }
    }
    return clients.openWindow(url.toString())
  }))
})

/* Subscription rotation (pushsubscriptionchange): the endpoint can be replaced
   without the page knowing. There is no payload here, so ask every open window
   to re-subscribe via the normal app path and re-register it host-side; when no
   window is open the next app start's enableWebPush covers it. */
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) client.postMessage({ type: 'palm:resubscribe' })
  })())
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname === '/api' || url.pathname.startsWith('/api/') || url.pathname === '/m/api' || url.pathname.startsWith('/m/api/')) return

  // Versioned bundle: cache-first, keyed by the full URL (the content hash in
  // the query). A repeat open of the same version costs no network at all;
  // an upgrade changes the page's hash (the navigation below is network-first),
  // so the new URL misses the cache and fetches fresh bytes automatically.
  // The unversioned URL carries no such guarantee and stays network-first.
  if (url.pathname === '/m/mobile.js') {
    event.respondWith(url.search === '' ? networkFirst(request, request) : cacheFirst(request))
    return
  }

  /* Local patch (2026-10-21): the surface is split into content-hashed chunks
     under /m/mobile/ (the chat and settings views). Their URL contains the
     build hash, so cache-first is always correct — and it is what keeps a
     lazy view from paying a download on every open. Cache entries are purged
     on activate by the bundle rule below, which drops the whole /m/ prefix. */
  if (url.pathname.startsWith('/m/mobile/')) {
    event.respondWith(cacheFirst(request))
    return
  }

  const isMobileNavigation = request.mode === 'navigate' && (url.pathname === '/m/' || url.pathname === '/m')
  if (isMobileNavigation) {
    event.respondWith(navigationFirst(request))
    return
  }

  if (SHELL_PATHS.has(url.pathname)) event.respondWith(networkFirst(request, url.pathname))
})

/**
 * Serve the cached bytes for an immutable, content-hashed URL, fetching and
 * caching them on a miss. The hash in the URL is the version, so a hit can
 * never be stale.
 */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(request)
  if (cached !== undefined) return cached
  try {
    const response = await fetch(request)
    if (response.ok) await cache.put(request, response.clone())
    return response
  } catch {
    return new Response('', { status: 503, statusText: 'Service Unavailable' })
  }
}

/**
 * Navigation: network-first, cache the shell on success, fall back to the
 * cached shell when offline (a frozen phone can still boot the app and read
 * cached conversations), then to the static offline page.
 */
async function navigationFirst(request) {
  const cache = await caches.open(CACHE_NAME)
  try {
    const response = await fetch(request)
    if (response.status >= 500) throw new Error('mobile shell unavailable')
    if (response.ok) await cache.put(SHELL_URL, response.clone())
    return response
  } catch {
    const shell = await cache.match(SHELL_URL)
    if (shell !== undefined) return shell
    const offline = await cache.match(OFFLINE_URL)
    if (offline !== undefined) return offline
    return new Response('', { status: 503, statusText: 'Service Unavailable' })
  }
}

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
