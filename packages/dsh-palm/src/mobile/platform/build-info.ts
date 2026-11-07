/**
 * Which build is this page actually running?
 *
 * The version inlined into the bundle (package.json's `version`) only changes
 * when the page really loads a new bundle — a backgrounded PWA keeps the old JS
 * in memory and a stale service-worker cache can serve the old shell, so "the
 * phone still says 1.3.3" is a question about the LOADED build, not about the
 * host. The shell already carries the answer: the host names the bundle by a
 * content hash (`mobile.js?v=93819a18`), and the tag that requested this module
 * is exactly the loaded one. Reading it beats fetching the current bundle, which
 * would answer for the host instead of for this page.
 *
 * @module dsh-palm/mobile/build-info
 */

/** Parse `?v=<hash>` out of the script tag that loaded the running bundle. */
export function buildHash(): string | undefined {
  if (typeof document === 'undefined') return undefined
  const script = document.querySelector('script[src*="mobile.js"]')
  const src = script?.getAttribute('src') ?? ''
  const match = /[?&]v=([A-Za-z0-9_-]+)/.exec(src)
  return match?.[1]
}

/** The running build's hash, resolved once at import. */
export const BUILD_HASH: string | undefined = buildHash()
