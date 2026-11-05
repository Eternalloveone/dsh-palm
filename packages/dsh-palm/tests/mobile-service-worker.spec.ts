import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const ORIGIN = 'https://dsh.example'
/** Any legacy name: activate must delete it while keeping the current cache. */
const CACHE_NAME = 'dsh-remote-mobile-shell-v3'
/** The name the served source carries once the host substitutes the hash. */
const SERVED_CACHE_NAME = 'dsh-remote-mobile-shell-__BUILD_HASH__'

type WorkerRequest = { method: string; mode: string; url: string }
type FetchListener = (event: { request: WorkerRequest; respondWith(response: Promise<Response> | Response): void }) => void
type LifecycleListener = (event: { waitUntil(promise: Promise<unknown>): void }) => void

interface WorkerHarness {
  dispatch(request: WorkerRequest): Promise<Response | undefined>
  setCached(path: string, response: Response): void
  cached(path: string): Response | undefined
  dispatchLifecycle(type: 'install' | 'activate'): Promise<void>
  lifecycle: { skipped: number; claimed: number }
  deleted: string[]
}

function cacheKey(input: unknown): string {
  const url = typeof input === 'string' ? input : (input as { url: string }).url
  return new URL(url, ORIGIN).href
}

async function loadWorker(
  fetcher: (request: WorkerRequest) => Promise<Response>,
  cacheNames: string[] = [CACHE_NAME],
): Promise<WorkerHarness> {
  const handlers = new Map<string, (event: never) => void>()
  const entries = new Map<string, Response>()
  const deleted: string[] = []
  const lifecycle = { skipped: 0, claimed: 0 }
  const cache = {
    add: async (input: unknown): Promise<void> => {
      const key = cacheKey(input)
      entries.set(key, (await fetcher({ method: 'GET', mode: 'same-origin', url: key })).clone())
    },
    match: async (input: unknown): Promise<Response | undefined> => entries.get(cacheKey(input))?.clone(),
    put: async (input: unknown, response: Response): Promise<void> => { entries.set(cacheKey(input), response.clone()) },
    keys: async () => [...entries.keys()].map(key => ({ url: key })),
    delete: async (input: unknown): Promise<boolean> => entries.delete(cacheKey(input)),
  }
  const caches = {
    open: async (_name: string) => cache,
    keys: async () => [...cacheNames],
    delete: async (name: string): Promise<boolean> => { deleted.push(name); return true },
  }
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: (event: never) => void): void => { handlers.set(type, listener) },
    skipWaiting: async (): Promise<void> => { lifecycle.skipped += 1 },
    clients: { claim: async (): Promise<void> => { lifecycle.claimed += 1 } },
  }
  const source = await readFile(new URL('../assets/mobile-service-worker.js', import.meta.url), 'utf8')
  runInNewContext(source, { Error, Promise, Response, Set, URL, caches, fetch: fetcher, self })
  const fetchListener = handlers.get('fetch') as FetchListener | undefined
  if (fetchListener === undefined) throw new Error('worker did not register a fetch listener')

  return {
    lifecycle,
    deleted,
    setCached: (path, response) => { entries.set(new URL(path, ORIGIN).href, response.clone()) },
    cached: (path) => entries.get(new URL(path, ORIGIN).href),
    dispatch: async (request) => {
      let response: Promise<Response> | undefined
      fetchListener({
        request,
        respondWith: (value) => { response = Promise.resolve(value) },
      })
      return response === undefined ? undefined : await response
    },
    dispatchLifecycle: async (type) => {
      const listener = handlers.get(type) as LifecycleListener | undefined
      if (listener === undefined) throw new Error(`worker did not register ${type}`)
      const waits: Array<Promise<unknown>> = []
      listener({ waitUntil: (promise) => { waits.push(promise) } })
      await Promise.all(waits)
    },
  }
}

describe('mobile service worker', () => {
  it('returns the static offline page for a 503 mobile navigation instead of cached shell HTML', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('upstream unavailable', { status: 503 }))
    const worker = await loadWorker(fetcher)
    worker.setCached('/m/', new Response('stale mobile shell'))
    worker.setCached('/m/offline.html', new Response('offline page'))

    const response = await worker.dispatch({ method: 'GET', mode: 'navigate', url: ORIGIN + '/m/' })
    expect(response).toBeDefined()
    expect(await response?.text()).toBe('offline page')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('caches the versioned mobile bundle under its full URL and falls back to the same version offline', async () => {
    const bundleUrl = ORIGIN + '/m/mobile.js?v=abc12345'
    const fetcher = vi.fn().mockResolvedValue(new Response('fresh bundle'))
    const worker = await loadWorker(fetcher)

    // Network hit: served and cached under the full (hash-carrying) URL.
    const online = await worker.dispatch({ method: 'GET', mode: 'same-origin', url: bundleUrl })
    expect(await online?.text()).toBe('fresh bundle')
    expect(fetcher).toHaveBeenCalledTimes(1)

    // Offline: the same-version cached copy is served; a different hash never is.
    const offlineFetcher = vi.fn().mockRejectedValue(new TypeError('offline'))
    const offlineWorker = await loadWorker(offlineFetcher)
    offlineWorker.setCached('/m/mobile.js?v=abc12345', new Response('cached same version'))
    const fallback = await offlineWorker.dispatch({ method: 'GET', mode: 'same-origin', url: bundleUrl })
    expect(await fallback?.text()).toBe('cached same version')

    const otherVersion = await offlineWorker.dispatch({ method: 'GET', mode: 'same-origin', url: ORIGIN + '/m/mobile.js?v=deadbeef' })
    expect(otherVersion).toBeDefined()
    expect(otherVersion?.status).toBe(503)
  })

  it('does not intercept the paired-device mobile API channel', async () => {
    const fetcher = vi.fn()
    const worker = await loadWorker(fetcher)

    const response = await worker.dispatch({ method: 'GET', mode: 'same-origin', url: ORIGIN + '/m/api/mobile.preferences' })
    expect(response).toBeUndefined()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('precaches the current bundle on install and keeps it through activate', async () => {
    const fetcher = vi.fn(async (input: unknown) => {
      const url = typeof input === 'string' ? new URL(input, ORIGIN).href : (input as { url: string }).url
      if (url.endsWith('/m/')) return new Response('<script src="/m/mobile.js?v=abcdef12"></script>')
      return new Response('bundle bytes')
    })
    const worker = await loadWorker(fetcher)

    await worker.dispatchLifecycle('install')
    expect(fetcher).toHaveBeenCalled()
    expect(worker.cached('/m/mobile.js?v=abcdef12')).toBeDefined()

    // The old activate deleted every `?v=` bundle entry and every chunk — i.e.
    // exactly what install had just precached, so the precache was pure waste.
    await worker.dispatchLifecycle('activate')
    expect(worker.cached('/m/mobile.js?v=abcdef12')).toBeDefined()
    expect(worker.lifecycle.skipped).toBe(1)
    expect(worker.lifecycle.claimed).toBe(1)
  })

  it('activate drops caches from older builds only', async () => {
    const worker = await loadWorker(vi.fn(), [SERVED_CACHE_NAME, CACHE_NAME])
    await worker.dispatchLifecycle('activate')
    expect(worker.deleted).toEqual([CACHE_NAME])
  })
})
