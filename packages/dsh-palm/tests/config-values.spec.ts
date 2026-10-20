/**
 * Reading config fields out of host-supplied wrappers.
 *
 * Regression cover for 2026-10-20: `devicesFile` arrived as an object, so the
 * pairing service tried to read a store from `[object Object]`, loaded zero
 * devices, and asked the phone to pair again after every restart. A value that
 * is not the expected primitive must fall back to the default, never pass
 * through.
 */
import { describe, expect, it } from 'vitest'
import {
  asConfigBoolean,
  asConfigNumber,
  asConfigString,
  asOptionalConfigString,
  unwrapConfigValue,
} from '../src/config-values.ts'

describe('unwrapConfigValue', () => {
  it('passes primitives through untouched', () => {
    expect(unwrapConfigValue('C:\\a.json')).toBe('C:\\a.json')
    expect(unwrapConfigValue(7)).toBe(7)
    expect(unwrapConfigValue(false)).toBe(false)
    expect(unwrapConfigValue(undefined)).toBeUndefined()
    expect(unwrapConfigValue(null)).toBeNull()
  })

  it('reads a Volatile reference', () => {
    expect(unwrapConfigValue({ get: () => 'value-from-get' })).toBe('value-from-get')
  })

  it('reads a plain wrapper', () => {
    expect(unwrapConfigValue({ value: 'value-from-wrapper' })).toBe('value-from-wrapper')
  })

  it('unwraps nested wrappers', () => {
    expect(unwrapConfigValue({ get: () => ({ value: { get: () => 42 } }) })).toBe(42)
  })

  it('returns an unreadable object as-is (the caller type-checks it)', () => {
    const opaque = { path: 'somewhere' }
    expect(unwrapConfigValue(opaque)).toBe(opaque)
  })
})

describe('typed field readers', () => {
  it('takes a real string and rejects everything else', () => {
    expect(asConfigString('C:\\a.json', 'fallback')).toBe('C:\\a.json')
    expect(asConfigString({ get: () => 'C:\\b.json' }, 'fallback')).toBe('C:\\b.json')
    // The 2026-10-20 case: a wrapper the plugin cannot read is not a path.
    expect(asConfigString({ path: 'C:\\c.json' }, 'fallback')).toBe('fallback')
    expect(asConfigString('', 'fallback')).toBe('fallback')
    expect(asConfigString(undefined, 'fallback')).toBe('fallback')
    expect(asConfigString(42, 'fallback')).toBe('fallback')
  })

  it('takes a finite number and rejects the rest', () => {
    expect(asConfigNumber(600_000, 1)).toBe(600_000)
    expect(asConfigNumber({ value: 4 }, 1)).toBe(4)
    expect(asConfigNumber(Number.NaN, 1)).toBe(1)
    expect(asConfigNumber('4', 1)).toBe(1)
    expect(asConfigNumber({ path: 4 }, 1)).toBe(1)
  })

  it('takes a real boolean and rejects truthiness', () => {
    expect(asConfigBoolean(false, true)).toBe(false)
    expect(asConfigBoolean({ get: () => true }, false)).toBe(true)
    expect(asConfigBoolean({ enabled: false }, true)).toBe(true)
    expect(asConfigBoolean(0, true)).toBe(true)
  })

  it('keeps an optional string undefined unless it is a real one', () => {
    expect(asOptionalConfigString('https://example.test')).toBe('https://example.test')
    expect(asOptionalConfigString({ get: () => 'https://tunnel.test' })).toBe('https://tunnel.test')
    expect(asOptionalConfigString({ path: '/x' })).toBeUndefined()
    expect(asOptionalConfigString('')).toBeUndefined()
    expect(asOptionalConfigString(undefined)).toBeUndefined()
  })
})
