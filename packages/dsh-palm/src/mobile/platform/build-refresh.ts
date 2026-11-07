/**
 * Pick up a new front-end build without asking the user to clear anything.
 *
 * The phone keeps the PWA in memory: closing the sheet and reopening it from
 * the home screen usually restores the SAME page instead of reloading it, and a
 * long-lived tab survives every host restart. The host ships a new bundle on
 * each build, but that page keeps executing the JS it loaded hours ago — which
 * is exactly why a fix verified on a fresh load ("the queue dock works") can
 * still be missing on the phone ("still nothing there").
 *
 * The shell names the bundle by content hash, so the loaded hash (BUILD_HASH,
 * read from the script tag that requested this module) and the served hash (a
 * no-store read of /m/) answer "is this page older than the host?". When they
 * differ, reload once. The sessionStorage marker keeps a broken/half-deployed
 * build from turning that into a reload loop.
 *
 * @module dsh-palm/mobile/build-refresh
 */

import { buildHash } from './build-info.ts'

/** Parse the bundle hash out of the shell HTML. */
export function parseBuildHash(html: string): string | undefined {
  return /mobile\.js\?v=([A-Za-z0-9_-]+)/.exec(html)?.[1]
}

/**
 * Should this page reload to reach `served`?
 *
 * @param loaded - Hash of the bundle actually running in this page.
 * @param served - Hash the host serves right now.
 * @param alreadyReloaded - This page already reloaded once for this hash.
 */
export function shouldReload(loaded: string | undefined, served: string | undefined, alreadyReloaded: boolean): boolean {
  if (loaded === undefined || served === undefined) return false
  if (loaded === served) return false
  return !alreadyReloaded
}

/** Storage key remembering the hash this page reloaded for. */
const RELOADED_KEY = 'dsh.palm.buildReloadedFor'

/** Options for {@link watchBuildRefresh}. */
export interface BuildRefreshOptions {
  /** Recheck cadence while the page stays visible (default 5 min). */
  intervalMs?: number
  /** Swap the reload for a callback (tests, and shells without a document). */
  onReload?: () => void
}

/**
 * Watch for a newer build and reload the page once when one appears.
 * @returns teardown function.
 */
export function watchBuildRefresh(options: BuildRefreshOptions = {}): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => {}
  let stopped = false
  const check = async (): Promise<void> => {
    if (stopped || document.visibilityState === 'hidden') return
    try {
      const response = await fetch('/m/', { cache: 'no-store' })
      if (!response.ok) return
      const served = parseBuildHash(await response.text())
      let alreadyReloaded = false
      try { alreadyReloaded = window.sessionStorage.getItem(RELOADED_KEY) === served } catch { /* private mode */ }
      // 每次现读：入口模块可能比 script 标签先求值，常量会读到 undefined。
      if (!shouldReload(buildHash(), served, alreadyReloaded)) return
      try { window.sessionStorage.setItem(RELOADED_KEY, served ?? '') } catch { /* private mode */ }
      stopped = true
      if (options.onReload !== undefined) options.onReload()
      else window.location.reload()
    } catch {
      // Offline or the host is restarting: the next tick tries again.
    }
  }
  const onWake = (): void => { if (document.visibilityState === 'visible') void check() }
  document.addEventListener('visibilitychange', onWake)
  window.addEventListener('online', onWake)
  const timer = window.setInterval(() => { void check() }, options.intervalMs ?? 5 * 60_000)
  return () => {
    stopped = true
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', onWake)
    window.removeEventListener('online', onWake)
  }
}
