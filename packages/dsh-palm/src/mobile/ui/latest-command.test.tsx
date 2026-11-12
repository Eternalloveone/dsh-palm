// @vitest-environment jsdom
/**
 * 「当前命令」条（折叠态）的渲染契约。
 *
 * 钉三件事：固定一行、换命令时交叉淡化、状态落到 data-state。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { LatestCommand } from './latest-command.tsx'
import { mobileCss } from '../mobile-styles.ts'

afterEach(() => { cleanup(); vi.useRealTimers() })

/** 去掉注释后的样式表：规则边界才好用 `}` 定位。 */
const CSS = mobileCss.replace(/\/\*[\s\S]*?\*\//g, '')

/** 读一条规则的声明体。 */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp('(?:^|[}])\\s*' + escaped + '\\s*\\{([^}]*)\\}').exec(CSS)
  if (match === null) throw new Error(`样式表里找不到规则 ${selector}`)
  return match[1] ?? ''
}

describe('LatestCommand（折叠态的当前命令）', () => {
  it('渲染一条命令：文案 + 状态点 + 状态落到 data-state', () => {
    const { container } = render(<LatestCommand text="改 delivery-card.tsx · 第 4 组用例" state="running" />)
    const line = container.querySelector('.chat-cmdline')!
    expect(line.getAttribute('data-state')).toBe('running')
    expect(line.getAttribute('aria-label')).toBe('改 delivery-card.tsx · 第 4 组用例')
    expect(line.textContent).toContain('改 delivery-card.tsx')
    expect(line.querySelector('.chat-cmdline-mark')).not.toBeNull()
  })

  it('换命令时交叉淡化：旧文案离场 + 新文案入场并存 320ms，之后只剩新的', () => {
    vi.useFakeTimers()
    const { container, rerender } = render(<LatestCommand text="跑 vitest" />)
    expect(container.querySelectorAll('.chat-cmdline-item')).toHaveLength(1)

    rerender(<LatestCommand text="改 delivery-card.tsx" />)
    const out = container.querySelector("[data-phase='out']")
    const incoming = container.querySelector("[data-phase='in']")
    expect(out?.textContent).toBe('跑 vitest')
    expect(incoming?.textContent).toBe('改 delivery-card.tsx')

    act(() => { vi.advanceTimersByTime(320) })
    expect(container.querySelector("[data-phase='out']")).toBeNull()
    expect(container.querySelectorAll('.chat-cmdline-item')).toHaveLength(1)
  })

  it('高度锁死、超长省略：换文案不会改变布局', () => {
    const line = ruleBody('.chat-cmdline')
    expect(line).toContain('block-size: 20px')
    expect(line).toContain('overflow: hidden')
    expect(ruleBody('.chat-cmdline-item')).toContain('text-overflow: ellipsis')
    // 淡入淡出必须登记减弱动效（结构用例之外这里再钉一次本地契约）。
    const reduced = mobileCss.includes(".chat-cmdline-item[data-phase='in']")
    expect(reduced).toBe(true)
  })
})
