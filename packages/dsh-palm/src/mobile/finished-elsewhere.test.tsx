// @vitest-environment jsdom
/**
 * 「别的会话跑完了」这条在聊天页的形态。
 *
 * 背景（2026-10-29 真机）：它原来是底部浮层，而输入区同样钉底且 z-index 更低，
 * 浮层直接把输入框盖住。改成：聊天页走顶部 HUD（不占底部），底部浮层只留在
 * 没有输入区的页面。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FinishedElsewhereBar } from './run-status.tsx'

afterEach(() => { cleanup() })

describe('FinishedElsewhereBar（聊天页顶部条）', () => {
  it('写完状态与用时，点它就打开那个会话', () => {
    const onOpen = vi.fn()
    const onDismiss = vi.fn()
    render(
      <FinishedElsewhereBar
        title="会话 b9f3373f"
        status="done"
        durationMs={158_000}
        onOpen={onOpen}
        onDismiss={onDismiss}
      />,
    )
    const strip = screen.getByRole('button', { name: /会话 b9f3373f/ })
    expect(strip.textContent).toContain('已完成')
    expect(strip.textContent).toContain('2分38秒')
    fireEvent.click(strip)
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('出错的回合写「出错退出」，被中断的写「已中断」', () => {
    const { unmount } = render(
      <FinishedElsewhereBar title="A" status="error" onOpen={() => {}} onDismiss={() => {}} />,
    )
    expect(screen.getByRole('button', { name: /A/ }).textContent).toContain('出错退出')
    unmount()
    render(<FinishedElsewhereBar title="B" status="stopped" onOpen={() => {}} onDismiss={() => {}} />)
    expect(screen.getByRole('button', { name: /B/ }).textContent).toContain('已中断')
  })

  it('点关闭只收起，不跳转', () => {
    const onOpen = vi.fn()
    const onDismiss = vi.fn()
    render(<FinishedElsewhereBar title="C" status="done" onOpen={onOpen} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: '收起这条提示' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('不带时长时不显示时间（缺锚点也不写 0 秒）', () => {
    render(<FinishedElsewhereBar title="D" status="done" onOpen={() => {}} onDismiss={() => {}} />)
    expect(screen.getByRole('button', { name: /D/ }).textContent).not.toContain('秒')
  })
})
