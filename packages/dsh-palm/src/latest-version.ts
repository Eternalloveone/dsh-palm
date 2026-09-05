/**
 * Latest-version lookup for the About sheet: ask the npm registry for the
 * package's `latest` dist-tag. The phone never fetches the registry
 * directly (the /m/ CSP is connect-src 'self'); the host answers through
 * `mobile.latestVersion` instead, and this module keeps the fetch logic
 * unit-testable.
 *
 * Failures return undefined — an offline registry must never break the
 * settings page, only hide the "check" outcome.
 */

const NPM_REGISTRY_BASE = 'https://registry.npmjs.org'

/** The registry's `latest` dist-tag, or undefined when unreachable. */
export async function fetchLatestVersion(pkgName: string): Promise<string | undefined> {
  try {
    // Scoped names ride the registry path with the slash encoded
    // (@scope%2Fname), the form the npm public API documents.
    const response = await fetch(`${NPM_REGISTRY_BASE}/${pkgName.replace('/', '%2F')}/latest`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) return undefined
    const body = await response.json() as { version?: unknown }
    return typeof body.version === 'string' && body.version !== '' ? body.version : undefined
  } catch {
    return undefined
  }
}

/** Compare two dotted numeric versions (0.7.3 > 0.7.2); false on garbage. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (value: string): number[] =>
    value.split('.').map(part => Number.parseInt(part, 10)).filter(part => Number.isFinite(part))
  const left = parse(candidate)
  const right = parse(current)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const l = left[index] ?? 0
    const r = right[index] ?? 0
    if (l > r) return true
    if (l < r) return false
  }
  return false
}
