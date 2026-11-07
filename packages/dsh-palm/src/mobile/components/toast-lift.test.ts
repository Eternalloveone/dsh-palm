import { describe, expect, it } from 'vitest'
import { DEFAULT_TOAST_LIFT, toastLiftPx } from './toast-lift.ts'

describe('toastLiftPx', () => {
  it('clears the composer with a gap, and never drops below the floor', () => {
    // A short composer still gets the minimum: the toast must not sit on the input.
    expect(toastLiftPx({ composerHeight: 72, hudHeight: 0 })).toBe(96)
    expect(toastLiftPx({ composerHeight: 96, hudHeight: 0 })).toBe(108)
  })

  it('adds the HUD height (queue dock / goal bar / status bar)', () => {
    // This is the reported bug: with a queue dock the toast must move up by
    // exactly that block, otherwise it covers 「撤回」.
    expect(toastLiftPx({ composerHeight: 96, hudHeight: 120 })).toBe(228)
  })

  it('adds the keyboard when the layout viewport did not shrink (iOS)', () => {
    expect(toastLiftPx({ composerHeight: 96, hudHeight: 0, keyboardHeight: 300 })).toBe(408)
  })

  it('ignores negative / non-finite measurements', () => {
    expect(toastLiftPx({ composerHeight: -50, hudHeight: Number.NaN, keyboardHeight: -1 })).toBe(96)
  })

  it('keeps a sane default for the no-JS path', () => {
    expect(DEFAULT_TOAST_LIFT).toBe(104)
  })
})
