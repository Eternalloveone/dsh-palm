/**
 * Reading one field out of a host-supplied config object.
 *
 * DSH 0.1.6+ hands live `Volatile<T>` references to `apply` for every
 * `.volatile()` field: an object with `get()`. Some builds wrap a plain value
 * instead. On 2026-10-20 a wrapper reached `readFileSync` as `devicesFile`,
 * the device store never loaded, and every restart asked the phone to pair
 * again — the failure was invisible because nothing checks the *type* of the
 * resolved value. These helpers do: unwrap, then verify, then fall back.
 */

/** Peel the value out of a `Volatile`-style wrapper (or return it as-is). */
export function unwrapConfigValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  const candidate = value as { get?: () => unknown; value?: unknown }
  if (typeof candidate.get === 'function') return unwrapConfigValue(candidate.get())
  if ('value' in candidate) return unwrapConfigValue(candidate.value)
  return value
}

/** A non-empty string, or the fallback when the wrapper did not hold one. */
export function asConfigString(value: unknown, fallback: string): string {
  const inner = unwrapConfigValue(value)
  return typeof inner === 'string' && inner !== '' ? inner : fallback
}

/** A finite number, or the fallback when the wrapper did not hold one. */
export function asConfigNumber(value: unknown, fallback: number): number {
  const inner = unwrapConfigValue(value)
  return typeof inner === 'number' && Number.isFinite(inner) ? inner : fallback
}

/** A real boolean, or the fallback when the wrapper did not hold one. */
export function asConfigBoolean(value: unknown, fallback: boolean): boolean {
  const inner = unwrapConfigValue(value)
  return typeof inner === 'boolean' ? inner : fallback
}

/** A non-empty string or undefined — for fields where "unset" is legitimate. */
export function asOptionalConfigString(value: unknown): string | undefined {
  const inner = unwrapConfigValue(value)
  return typeof inner === 'string' && inner !== '' ? inner : undefined
}
