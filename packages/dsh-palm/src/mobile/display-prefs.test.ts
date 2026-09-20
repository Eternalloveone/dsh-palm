// @vitest-environment jsdom
/** display-prefs haptics: the default-on flag, its persistence, and buzz(). */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buzz, getHaptics, setHaptics } from './display-prefs.ts'

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('haptics preference', () => {
  it('defaults on and persists the toggle', () => {
    expect(getHaptics()).toBe(true)
    setHaptics(false)
    expect(getHaptics()).toBe(false)
    setHaptics(true)
    expect(getHaptics()).toBe(true)
  })

  it('buzz() vibrates when on, stays silent when off, and never throws without the API', () => {
    const vibrate = vi.fn()
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true })
    buzz()
    expect(vibrate).toHaveBeenCalledWith(15)
    vibrate.mockClear()
    setHaptics(false)
    buzz()
    expect(vibrate).not.toHaveBeenCalled()
    setHaptics(true)
    // A browser without the vibrate API: silently inert, no throw.
    Object.defineProperty(navigator, 'vibrate', { value: undefined, configurable: true })
    expect(() => buzz()).not.toThrow()
  })
})
