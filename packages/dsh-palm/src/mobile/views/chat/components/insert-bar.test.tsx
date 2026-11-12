// @vitest-environment jsdom
/**
 * 插入条渲染契约（4 条真机症状）：
 *  - 默认折叠成「已插入 N 条补充消息」，不一条一行；
 *  - 点摘要才展开明细；
 *  - 明细里的「撤回」把 id 交回调用方；
 *  - **运行态切换不卸载**：DOM 节点还是同一个，只有 data-state/data-running 变。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { InsertEntry } from '../../../session/insert-queue.ts'
import { mobileCss } from '../../../mobile-styles.ts'
import { InsertBarView } from './insert-bar.tsx'

afterEach(cleanup)

function entry(id: string, source: InsertEntry['source'], text: string, at = 0): InsertEntry {
  return { id, turnNo: 1, source, text, at }
}

const ENTRIES: readonly InsertEntry[] = [
  entry('a', 'user', '补一句：先跑测试', 0),
  entry('b', 'job', 'Background subagent 完成', 1),
]

function renderBar(overrides: Partial<Parameters<typeof InsertBarView>[0]> = {}) {
  return render(
    <InsertBarView
      entries={ENTRIES}
      running
      onWithdraw={vi.fn()}
      {...overrides}
    />,
  )
}

describe('InsertBarView', () => {
  it('默认展开（每条都要能被单独处理），摘要仍可收起', () => {
    // 2026-11-10 用户要求「每条插队消息可以独立编辑/删除/处理」：明细默认展开，
    // 每条右侧有自己的动作入口；摘要按钮仍可收起。
    const { container } = renderBar()
    const bar = container.querySelector('.insert-bar')
    expect(bar?.getAttribute('data-state')).toBe('shown')
    expect(screen.getByText('已插入 2 条补充消息')).toBeTruthy()
    const summary = screen.getByRole('button', { name: /已插入 2 条补充消息/ })
    expect(summary.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('[data-insert-details]')?.getAttribute('aria-hidden')).toBe('false')
  })

  it('点摘要收起/展开：aria-expanded / aria-hidden 同步翻转', () => {
    // 2026-11-10 起默认展开（每条要能被单独处理），所以第一次点击是收起。
    const { container } = renderBar()
    const summary = screen.getByRole('button', { name: /已插入 2 条补充消息/ })
    expect(summary.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('[data-insert-details]')?.getAttribute('aria-hidden')).toBe('false')
    fireEvent.click(summary)
    expect(summary.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('.insert-bar')?.getAttribute('data-expanded')).toBe('false')
    expect(container.querySelector('[data-insert-details]')?.getAttribute('aria-hidden')).toBe('true')
    fireEvent.click(summary)
    expect(summary.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('补一句：先跑测试')).toBeTruthy()
    expect(screen.getByText('Background subagent 完成')).toBeTruthy()
  })

  it('明细里的「撤回」把条目 id 交回调用方', () => {
    const onWithdraw = vi.fn()
    renderBar({ onWithdraw })
    // 默认已展开：直接点条目上的撤回。
    fireEvent.click(screen.getAllByRole('button', { name: /撤回插入消息/ })[0]!)
    expect(onWithdraw).toHaveBeenCalledWith('a')
  })

  it('运行态切换不卸载：节点同一份，只有 data 属性变', () => {
    const { container, rerender } = renderBar({ running: true })
    const bar = container.querySelector('.insert-bar')
    expect(bar).toBeTruthy()
    expect(bar?.getAttribute('data-running')).toBe('true')
    rerender(
      <InsertBarView entries={ENTRIES} running={false} onWithdraw={vi.fn()} />,
    )
    expect(container.querySelector('.insert-bar')).toBe(bar)
    expect(bar?.getAttribute('data-running')).toBe('false')
    // 节点没有重挂：摘要仍是同一轮数据，state 仍是 shown。
    expect(bar?.getAttribute('data-state')).toBe('shown')
  })

  it('空队列：组件仍挂载，只是 data-state=empty 且不出摘要', () => {
    const { container } = renderBar({ entries: [] })
    const bar = container.querySelector('.insert-bar')
    expect(bar).toBeTruthy()
    expect(bar?.getAttribute('data-state')).toBe('empty')
    expect(screen.queryByText(/已插入/)).toBeNull()
  })
})

describe('插入条样式契约', () => {
  it('摘要和明细操作各自占据独立的 44px 行，且保留 0fr → 1fr 过渡', () => {
    const row = /--palm-insert-row-h:\s*(\d+(?:\.\d+)?)px/.exec(mobileCss)
    expect(row).not.toBeNull()
    expect(Number(row?.[1])).toBe(44)
    expect(mobileCss).toMatch(/--palm-insert-h:\s*44px/)
    expect(mobileCss).toMatch(/\[data-insert-summary\]\s*\{[^}]*min-height:\s*var\(--palm-insert-h\)/)
    expect(mobileCss).toMatch(/\[data-insert-details\]\s*li\s*\{[^}]*height:\s*var\(--palm-insert-row-h\)/)
    expect(mobileCss).toMatch(/\[data-insert-withdraw\]\s*\{[^}]*height:\s*var\(--palm-insert-row-h\)/)
    expect(mobileCss).not.toMatch(/\[data-insert-withdraw\]::after\s*\{/)
    expect(mobileCss).toMatch(/--palm-insert-dur:\s*\d+ms/)
    expect(mobileCss).toMatch(/\.insert-bar\s*\{[^}]*grid-template-rows:\s*0fr/)
    expect(mobileCss).toMatch(/\.insert-bar\[data-state='shown'\]\s*\{[^}]*grid-template-rows:\s*1fr/)
  })
})
