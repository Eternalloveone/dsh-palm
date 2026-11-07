// @vitest-environment jsdom
/**
 * 键盘遮挡高度（W2-5）：公式与订阅都要能单独验证。
 *
 * 真机上的键盘问题是"看不见的老毛病"（toast 被键盘顶住、输入区被盖住），
 * 以前只能靠人肉复现；这里把公式与订阅拆开钉住。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { keyboardInsetPx, useKeyboardInset } from './use-keyboard-inset.ts'

interface FakeViewport {
  set: (height: number, offsetTop?: number) => void
  fire: (type: string) => void
  restore: () => void
}

/** 在 window 上装一个可控的 visualViewport。 */
function installViewport(height: number, offsetTop = 0): FakeViewport {
  const listeners = new Map<string, Set<() => void>>()
  const state = { height, offsetTop }
  const viewport = {
    get height() { return state.height },
    get offsetTop() { return state.offsetTop },
    addEventListener(type: string, handler: () => void) {
      const set = listeners.get(type) ?? new Set<() => void>()
      set.add(handler)
      listeners.set(type, set)
    },
    removeEventListener(type: string, handler: () => void) {
      listeners.get(type)?.delete(handler)
    },
  }
  const original = Object.getOwnPropertyDescriptor(window, 'visualViewport')
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
  return {
    set: (nextHeight, nextTop = 0) => { state.height = nextHeight; state.offsetTop = nextTop },
    fire: (type) => { for (const handler of listeners.get(type) ?? []) handler() },
    restore: () => {
      if (original === undefined) delete (window as unknown as Record<string, unknown>).visualViewport
      else Object.defineProperty(window, 'visualViewport', original)
    },
  }
}

describe('keyboardInsetPx', () => {
  const originalHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight')
  beforeEach(() => { Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 }) })
  afterEach(() => {
    if (originalHeight === undefined) delete (window as unknown as Record<string, unknown>).innerHeight
    else Object.defineProperty(window, 'innerHeight', originalHeight)
  })

  it('没有 visualViewport 时按 0 处理（桌面浏览器）', () => {
    expect(keyboardInsetPx()).toBe(0)
  })

  it('键盘高度 = 布局视口 - 可视高度 - 顶部偏移', () => {
    const handle = installViewport(500, 20)
    expect(keyboardInsetPx()).toBe(280)
    handle.restore()
  })

  it('布局视口已经缩小时返回 0，而不是负数', () => {
    const handle = installViewport(900, 0)
    expect(keyboardInsetPx()).toBe(0)
    handle.restore()
  })
})

describe('useKeyboardInset', () => {
  const originalHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight')
  beforeEach(() => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
  })
  afterEach(() => {
    if (originalHeight === undefined) delete (window as unknown as Record<string, unknown>).innerHeight
    else Object.defineProperty(window, 'innerHeight', originalHeight)
  })

  it('挂载时不回调（调用方各自做首帧初始化）', () => {
    const handle = installViewport(600, 0)
    const onChange = vi.fn()
    renderHook(() => useKeyboardInset(onChange))
    expect(onChange).not.toHaveBeenCalled()
    handle.restore()
  })

  it('visualViewport resize 后回调新值', () => {
    const handle = installViewport(600, 0)
    const onChange = vi.fn()
    renderHook(() => useKeyboardInset(onChange))
    onChange.mockClear()

    handle.set(400, 0)
    handle.fire('resize')
    expect(onChange).toHaveBeenCalledWith(400)
    handle.restore()
  })

  it('卸载后不再回调', () => {
    const handle = installViewport(600, 0)
    const onChange = vi.fn()
    const { unmount } = renderHook(() => useKeyboardInset(onChange))
    unmount()
    onChange.mockClear()

    handle.fire('resize')
    expect(onChange).not.toHaveBeenCalled()
    handle.restore()
  })
})
