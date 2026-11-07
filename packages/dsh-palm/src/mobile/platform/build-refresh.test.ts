// @vitest-environment jsdom
/**
 * build-refresh: a phone that has been running the old bundle for hours must
 * pick up a new build by itself — nobody is going to clear the cache by hand.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseBuildHash, shouldReload, watchBuildRefresh } from './build-refresh.ts'

const SHELL = '<html><head><script type="module" src="/m/mobile.js?v=93819a18"></script></head></html>'

describe('parseBuildHash', () => {
  it('reads the content hash out of the shell', () => {
    expect(parseBuildHash(SHELL)).toBe('93819a18')
    expect(parseBuildHash('<html></html>')).toBeUndefined()
  })
})

describe('shouldReload', () => {
  it('reloads only when the served hash differs and has not been tried', () => {
    expect(shouldReload('aaa', 'bbb', false)).toBe(true)
    // Same build: nothing to do (and this is the common case on every wake).
    expect(shouldReload('aaa', 'aaa', false)).toBe(false)
    // Unknown hashes prove nothing.
    expect(shouldReload(undefined, 'bbb', false)).toBe(false)
    expect(shouldReload('aaa', undefined, false)).toBe(false)
    // Already reloaded for this hash: a broken deploy must not loop.
    expect(shouldReload('aaa', 'bbb', true)).toBe(false)
  })
})

describe('watchBuildRefresh', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reloads when the host serves a different bundle', async () => {
    const onReload = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(SHELL, { status: 200 })))
    // The running page was built from another hash; BUILD_HASH comes from the
    // script tag, which jsdom lacks, so stub it through a matching document tag.
    const script = document.createElement('script')
    script.setAttribute('src', '/m/mobile.js?v=oldhash1')
    document.head.appendChild(script)
    const stop = watchBuildRefresh({ onReload, intervalMs: 60_000 })
    document.dispatchEvent(new Event('visibilitychange'))
    await new Promise(resolve => setTimeout(resolve, 50))
    stop()
    expect(onReload).toHaveBeenCalledTimes(1)
    script.remove()
  })

  it('does not reload while the served build matches the loaded one', async () => {
    const onReload = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>no hash</html>', { status: 200 })))
    const stop = watchBuildRefresh({ onReload, intervalMs: 60_000 })
    document.dispatchEvent(new Event('visibilitychange'))
    await new Promise(resolve => setTimeout(resolve, 50))
    stop()
    expect(onReload).not.toHaveBeenCalled()
  })
})
