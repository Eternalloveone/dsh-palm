// @vitest-environment jsdom
/**
 * iOS install hint: who gets told to add the page to the home screen, and the
 * one-time acknowledgement. The UA strings are the real shapes (iOS Safari,
 * iPadOS pretending to be macOS, an iOS browser that cannot install, Android).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { dismissInstallHint, INSTALL_HINT_KEY, installHintDismissed, iosInstallHintNeeded } from './install-hint.ts'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
const IOS_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.71 Mobile/15E148 Safari/604.1'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'

describe('ios install hint', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('asks on iOS Safari opened in a tab', () => {
    expect(iosInstallHintNeeded({ userAgent: IPHONE })).toBe(true)
  })

  it('stays quiet once the page is already a home-screen app', () => {
    expect(iosInstallHintNeeded({ userAgent: IPHONE, standalone: true })).toBe(false)
    expect(iosInstallHintNeeded({ userAgent: IPHONE, displayModeStandalone: true })).toBe(false)
  })

  it('treats an iPad reporting a desktop user agent as iOS (touch points)', () => {
    expect(iosInstallHintNeeded({ userAgent: IPAD_AS_MAC, maxTouchPoints: 5 })).toBe(true)
    // The same UA on a real Mac (no touch) is not an iPad.
    expect(iosInstallHintNeeded({ userAgent: IPAD_AS_MAC, maxTouchPoints: 0 })).toBe(false)
  })

  it('never asks on Android or in an iOS browser that cannot install', () => {
    expect(iosInstallHintNeeded({ userAgent: ANDROID })).toBe(false)
    // Chrome on iOS cannot add the page to the home screen the way Safari does.
    expect(iosInstallHintNeeded({ userAgent: IOS_CHROME })).toBe(false)
  })

  it('remembers the acknowledgement', () => {
    expect(installHintDismissed()).toBe(false)
    dismissInstallHint()
    expect(localStorage.getItem(INSTALL_HINT_KEY)).toBe('1')
    expect(installHintDismissed()).toBe(true)
  })
})
