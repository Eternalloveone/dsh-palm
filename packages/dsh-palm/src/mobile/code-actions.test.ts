// @vitest-environment jsdom
/** code-actions shareText: system share sheet / AbortError silence / clipboard fallback. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shareText } from './code-actions.ts'

beforeEach(() => {
  vi.restoreAllMocks()
  // jsdom exposes neither the share sheet nor the async clipboard (nor the
  // legacy execCommand); define fresh stubs per test — or leave them
  // undefined for the no-support case.
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
  Object.defineProperty(document, 'execCommand', { value: vi.fn(() => true), configurable: true })
})

/** The legacy clipboard fallback used by copyText (stubbed per test file). */
function execCommandCalls(): number {
  return vi.mocked(document.execCommand).mock.calls.length
}

describe('shareText', () => {
  it('uses the system share sheet when the browser has one', async () => {
    const share = vi.fn(async () => {})
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    await shareText('结论一段')
    expect(share).toHaveBeenCalledWith({ text: '结论一段' })
  })

  it('stays silent when the user cancels the sheet (AbortError is not a failure)', async () => {
    Object.defineProperty(navigator, 'share', {
      value: vi.fn(async () => { throw new DOMException('cancelled', 'AbortError') }),
      configurable: true,
    })
    await shareText('文本')
    expect(execCommandCalls()).toBe(0)
  })

  it('falls back to the clipboard when the share sheet is missing', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await shareText('没有分享面板')
    expect(writeText).toHaveBeenCalledWith('没有分享面板')
  })

  it('also falls back when the sheet exists but errors for another reason', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    Object.defineProperty(navigator, 'share', {
      value: vi.fn(async () => { throw new Error('permission denied') }),
      configurable: true,
    })
    await shareText('降级文本')
    expect(writeText).toHaveBeenCalledWith('降级文本')
  })
})
