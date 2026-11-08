// @vitest-environment jsdom
/**
 * 首屏 idle 预取：正常路径必须先有组件、再切页 —— 用户点入口时不能再经过
 * 懒加载骨架（`PageSkeleton`），预取失败也不许影响功能。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { createLazyView, prefetchOnIdle } from './lazy-view.tsx'

describe('首屏后 idle 预取剩余 chunk', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('idle 之前不下载：到点后每个 loader 各拉一次，之后入口同步可渲染', async () => {
    const loader = vi.fn(async () => ({ default: () => <div>设置页</div> }))
    const view = createLazyView(loader)
    prefetchOnIdle([view.warm])
    // 首帧不做任何下载（不抢首屏带宽）。
    expect(loader).not.toHaveBeenCalled()
    await act(async () => { await vi.runAllTimersAsync() })
    expect(loader).toHaveBeenCalledTimes(1)
    // 预取完成后再进页面：组件已经缓存，不经过懒加载降级，也不画骨架。
    render(<view.View />)
    expect(screen.getByText('设置页')).toBeTruthy()
    expect(document.querySelector('.page-loading')).toBeNull()
  })

  it('预取失败被吞掉：不影响其它 loader，也不留下未处理的拒绝', async () => {
    const broken = vi.fn(async () => { throw new Error('离线') })
    const healthy = vi.fn(async () => ({ default: () => <div>产物页</div> }))
    const brokenView = createLazyView(broken)
    const healthyView = createLazyView(healthy)
    prefetchOnIdle([brokenView.warm, healthyView.warm])
    await act(async () => { await vi.runAllTimersAsync() })
    expect(broken).toHaveBeenCalledTimes(1)
    expect(healthy).toHaveBeenCalledTimes(1)
    render(<healthyView.View />)
    expect(screen.getByText('产物页')).toBeTruthy()
  })

  it('反复预取不会重复下载（warm 内部已有 inflight 去重）', async () => {
    const loader = vi.fn(async () => ({ default: () => <div>搜索页</div> }))
    const view = createLazyView(loader)
    prefetchOnIdle([view.warm])
    prefetchOnIdle([view.warm])
    await act(async () => { await vi.runAllTimersAsync() })
    await act(async () => { await vi.runAllTimersAsync() })
    expect(loader).toHaveBeenCalledTimes(1)
    render(<view.View />)
    expect(screen.getByText('搜索页')).toBeTruthy()
  })
})
