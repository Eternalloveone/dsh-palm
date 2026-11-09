// @vitest-environment jsdom
/**
 * 连接提示（极简一行）的契约：
 * 1. 一行、展开 ≤28px、11px 弱化色（琥珀 / 灰），**无图标块、无按钮**；
 * 2. 断线「连接中断，正在重连…」；恢复「已重连」，800ms 后 `data-state` 收起；
 * 3. 收起**不卸载** —— 节点一直在 DOM 里，只是 0 高 + 透明（否则下面的正文会跳）。
 *
 * 与状态条的 `unknown` 是两件事：断线只说明没有权威数据，状态条自己保持 unknown。
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OfflineBanner, RECONNECT_FLASH_MS } from './offline-banner.tsx'
import { mobileCss } from '../../../mobile-styles.ts'

afterEach(() => { cleanup(); vi.useRealTimers() })

/** 去掉注释后的样式表：规则边界才好用 `}` 定位。 */
const CSS = mobileCss.replace(/\/\*[\s\S]*?\*\//g, '')

/** 读一条规则的声明体（选择器要写全，且必须从规则边界开始）。 */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp('(?:^|[}])\\s*' + escaped + '\\s*\\{([^}]*)\\}').exec(CSS)
  if (match === null) throw new Error(`样式表里找不到规则 ${selector}`)
  return match[1] ?? ''
}

/** 读一个 px 令牌的数值（没定义或不是 px 一律报错，不做「读不到就放过」）。 */
function pxToken(name: string): number {
  const match = new RegExp(name + ':\\s*(-?\\d+(?:\\.\\d+)?)px').exec(mobileCss)
  if (match === null) throw new Error(`找不到 px 令牌 ${name}`)
  return Number(match[1])
}

describe('OfflineBanner（断线提示 · 极简一行）', () => {
  it('没断线时也常驻 DOM：data-state=gone、空文案、0 高（收起不是卸载）', () => {
    const { container } = render(<OfflineBanner offline={false} />)
    const node = container.querySelector('.chat-offline-banner')
    expect(node).not.toBeNull()
    expect(node?.getAttribute('data-state')).toBe('gone')
    expect(node?.textContent).toBe('')
    expect(ruleBody(".chat-offline-banner[data-state='gone']")).toContain('block-size: 0')
  })

  it('断线：一行「连接中断，正在重连…」，无图标块、无按钮', () => {
    const { container } = render(<OfflineBanner offline />)
    expect(screen.getByText('连接中断，正在重连…')).toBeTruthy()
    expect(container.querySelector('.chat-offline-banner')?.getAttribute('data-state')).toBe('off')
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('svg')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
  })

  it('恢复：先改口「已重连」，800ms 后 data-state 收起，但节点仍在 DOM', () => {
    vi.useFakeTimers()
    const { container, rerender } = render(<OfflineBanner offline />)
    rerender(<OfflineBanner offline={false} />)
    const node = container.querySelector('.chat-offline-banner')
    expect(node?.textContent).toBe('已重连')
    expect(node?.getAttribute('data-state')).toBe('back')
    act(() => { vi.advanceTimersByTime(RECONNECT_FLASH_MS - 1) })
    expect(node?.getAttribute('data-state')).toBe('back')
    act(() => { vi.advanceTimersByTime(1) })
    expect(node?.getAttribute('data-state')).toBe('gone')
    expect(node?.textContent).toBe('')
    // 同一颗节点：没有条件渲染、没有 key 变化。
    expect(container.querySelector('.chat-offline-banner')).toBe(node)
  })

  it('样式契约：展开 ≤28px、字 11px、琥珀弱化色；旧的重试按钮与滑入动画已删', () => {
    expect(pxToken('--palm-offline-h')).toBeLessThanOrEqual(28)
    expect(pxToken('--palm-offline-size')).toBe(11)
    const banner = ruleBody('.chat-offline-banner')
    expect(banner).toContain('block-size: var(--palm-offline-h)')
    expect(banner).toContain('font-size: var(--palm-offline-size)')
    expect(banner).toContain('var(--palm-warn)')
    // 不把「断线」染成错误红：状态未知 ≠ 出错。
    expect(banner).not.toContain('var(--palm-danger)')
    expect(mobileCss).not.toContain('.chat-offline-retry')
    expect(mobileCss).not.toContain('@keyframes banner-in')
  })
})
