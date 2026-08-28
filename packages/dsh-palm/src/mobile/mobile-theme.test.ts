// @vitest-environment jsdom
/** mobile-theme: system default, persisted explicit palettes, document wiring. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getMobileTheme, getMobileThemeMode, setMobileTheme, setMobileThemeMode,
  subscribeMobileTheme, toggleMobileTheme,
} from './mobile-theme.ts'

const STORAGE_KEY = 'dsh.remote.theme'

/** jsdom in this setup ships a bare localStorage object; install a real fake. */
function makeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value) },
    removeItem: (key: string) => { map.delete(key) },
    clear: () => { map.clear() },
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() { return map.size },
  } as Storage
}

let storage: Storage

beforeEach(() => {
  storage = makeStorage()
  vi.stubGlobal('localStorage', storage)
  setMobileThemeMode('system')
  document.documentElement.removeAttribute('data-theme')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mobile-theme', () => {
  it('defaults to system with nothing stored (resolved light without a scheme signal)', () => {
    expect(getMobileThemeMode()).toBe('system')
    // jsdom ships no matchMedia: the resolved palette falls back to light.
    expect(getMobileTheme()).toBe('light')
    expect(storage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('system mode wires data-theme=system and the chrome color of the resolved palette', () => {
    const meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.appendChild(meta)
    // Switch dark → system so both applications run while the meta exists.
    setMobileThemeMode('dark')
    expect(meta.content).toBe('#0a0a0f')
    setMobileThemeMode('system')
    expect(document.documentElement.dataset.theme).toBe('system')
    // jsdom ships no matchMedia: system resolves to light.
    expect(meta.content).toBe('#f5f5f7')
    meta.remove()
  })

  it('toggles from system to an explicit dark, persists it, and wires the document', () => {
    expect(toggleMobileTheme()).toBe('dark')
    expect(getMobileTheme()).toBe('dark')
    expect(getMobileThemeMode()).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(storage.getItem(STORAGE_KEY)).toBe('dark')
  })

  it('toggles back to light', () => {
    setMobileTheme('dark')
    expect(toggleMobileTheme()).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(storage.getItem(STORAGE_KEY)).toBe('light')
  })

  it('boot reads the stored mode and initMobileTheme applies it', async () => {
    storage.setItem(STORAGE_KEY, 'dark')
    vi.resetModules()
    const fresh = await import('./mobile-theme.ts')
    expect(fresh.getMobileTheme()).toBe('dark')
    fresh.initMobileTheme()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('boot honors a stored system mode', async () => {
    storage.setItem(STORAGE_KEY, 'system')
    vi.resetModules()
    const fresh = await import('./mobile-theme.ts')
    expect(fresh.getMobileThemeMode()).toBe('system')
  })

  it('notifies subscribers on change', () => {
    const seen: string[] = []
    const unsubscribe = subscribeMobileTheme(() => { seen.push(getMobileTheme()) })
    setMobileTheme('dark')
    setMobileTheme('light')
    unsubscribe()
    setMobileTheme('dark')
    expect(seen).toEqual(['dark', 'light'])
  })
})
