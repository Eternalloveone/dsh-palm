// @vitest-environment jsdom
/**
 * 鲸尾后面到底写了什么：把 12 种状态各自"画出来的文字"钉住。
 *
 * 用户 2026-11-11 报「有时候鲸尾后面是空白」。这里把每种状态实际渲染出来的文字逐个列出来，
 * 一眼就能看出哪一档没有字 —— 比读 `STRIP_WORD` 那个常量表可靠（常量是 ''，但还要经过
 * `StatusStrip` 的条件渲染：label 为空时连 `<b>` 都不画，detail/right 也可能都没有）。
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StatusStrip, type StatusStripKind } from './status-strip.tsx'
import { STRIP_ROTATE_MS, TurnHeader, stripWordOf } from './turn-header.tsx'

afterEach(() => { cleanup() })

/** 把一行状态栏里「人眼能看到」的文字拼出来：主文案 + 灰字 + 右侧。 */
function visibleText(container: HTMLElement): string {
  const label = container.querySelector('[data-part="label"]')?.textContent ?? ''
  const detail = container.querySelector('[data-part="detail"]')?.textContent ?? ''
  const right = container.querySelector('[data-part="right"]')?.textContent ?? ''
  return [label, detail, right].filter(part => part !== '').join(' | ')
}

const KINDS: StatusStripKind[] = [
  'think', 'read', 'edit', 'test', 'approve', 'stuck',
  'idle', 'unknown', 'done', 'failed', 'stopped', 'queued',
]

describe('鲸尾后面的文案：逐状态清点', () => {
  it('12 种状态各自画出来的文字（运行中带步数与耗时）', () => {
    const shown: Record<string, string> = {}
    for (const kind of KINDS) {
      const view = render(<TurnHeader kind={kind} steps={{ done: 3, total: 7 }} durationMs={75_000} />)
      shown[kind] = visibleText(view.container)
      view.unmount()
    }
    // 这里刻意写成"现状快照"：改文案时它必须跟着改，避免悄悄漂移。
    // 2026-11-11 起「进行中」四族是词池（每 4 秒/每步轮播），快照固定第 0 个词。
    expect(shown).toEqual({
      think: '琢磨着 · 3 步 | 1分15秒',
      read: '翻着 · 3 步 | 1分15秒',
      edit: '落笔 · 3 步 | 1分15秒',
      test: '跑着 · 3 步 | 1分15秒',
      approve: '等你放行 · 3 步 | 1分15秒',
      stuck: '静着 · 3 步 | 比平时慢一点 · 也可以停止后重发 | 1分15秒',
      idle: '闲着 · 3 步 | 等你发话',
      unknown: '等回话 | 1分15秒',
      done: '成了 · 3 步 | 未做改动 | 1分15秒',
      failed: '没成 · 3 步 | 1分15秒',
      stopped: '收了 · 3 步 | 1分15秒',
      queued: '排着 · 3 步 | 1分15秒',
    })
  })

  it('空闲态右侧换成「上一轮多久前」', () => {
    const view = render(<TurnHeader kind="idle" closedAtMs={Date.now() - 4 * 60_000} />)
    expect(visibleText(view.container)).toBe('闲着 | 等你发话 | 4 分钟前')
  })

  it('完成但没改动时补一句灰字', () => {
    const view = render(<TurnHeader kind="done" steps={{ done: 7, total: 7 }} changedFiles={0} durationMs={12_000} />)
    expect(visibleText(view.container)).toBe('成了 · 7 步 | 未做改动 | 12s')
  })

  /**
   * 用户 2026-11-11 报的空白：`unknown` + 没有时长（快照没到、或这一轮连开始时间都没有）
   * 时只剩一枚灰鲸尾，一个字都没有。
   *
   * 修法（同日）：主文案写「等回话」，并在没有时长时补一句灰字，陈述"在等谁"。
   */
  it('「待定」状态 + 没有时长：写「等回话」+ 一句在等什么（不再空白）', () => {
    const view = render(<TurnHeader kind="unknown" />)
    expect(visibleText(view.container)).toBe('等回话 | 还没收到这一步的结果')
  })

  it('「待定」状态 + 有时长：写「等回话」，右侧照走时钟', () => {
    const view = render(<TurnHeader kind="unknown" durationMs={42_000} />)
    expect(visibleText(view.container)).toBe('等回话 | 42s')
  })

  it('迷你版（抽屉行）永远有字：三档全是实词', () => {
    for (const [kind, label] of [['approve', '等审批'], ['test', '运行中'], ['done', '完成']] as const) {
      const view = render(<StatusStrip kind={kind} label={label} size="mini" />)
      expect(view.container.textContent).toBe(label)
      view.unmount()
    }
  })
})

/**
 * 词池契约（2026-11-11）：进行中四族按 4 秒/步数轮播，其余八档一个字都不许变。
 *
 * 为什么要轮播、以及为什么只在族内轮播，见 `turn-header.tsx` 的 `STRIP_POOL` 注释。
 * 这里只盯两件事：**会动的那几族真的在动**、**不该动的那几档一动不动**。
 */
describe('状态词池：轮播与稳定档', () => {
  it('进行中每 4 秒换一个词（同族内前进一格）', () => {
    vi.useFakeTimers()
    try {
      const view = render(<TurnHeader kind="think" steps={{ done: 0, total: 5 }} />)
      expect(visibleText(view.container)).toBe('琢磨着 · 0 步')
      act(() => { vi.advanceTimersByTime(STRIP_ROTATE_MS) })
      expect(visibleText(view.container)).toBe('盘算着 · 0 步')
      act(() => { vi.advanceTimersByTime(STRIP_ROTATE_MS) })
      expect(visibleText(view.container)).toBe('捋一捋 · 0 步')
    } finally {
      vi.useRealTimers()
    }
  })

  it('关键档不轮播：等你/静着/成了/没成 过了 20 秒还是同一个词', () => {
    vi.useFakeTimers()
    try {
      for (const [kind, word] of [['approve', '等你放行'], ['stuck', '静着'], ['done', '成了'], ['failed', '没成']] as const) {
        const view = render(<TurnHeader kind={kind} />)
        act(() => { vi.advanceTimersByTime(STRIP_ROTATE_MS * 5) })
        expect(visibleText(view.container), kind).toContain(word)
        view.unmount()
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('步数前进也换词（不必等满 4 秒）', () => {
    const view = render(<TurnHeader kind="edit" steps={{ done: 1, total: 5 }} />)
    expect(visibleText(view.container)).toBe('落笔 · 1 步')
    view.rerender(<TurnHeader kind="edit" steps={{ done: 2, total: 5 }} />)
    expect(visibleText(view.container)).toBe('动刀 · 2 步')
  })

  it('换一种动作就回到本族第一个词（不在族尾兜底词上开局）', () => {
    const view = render(<TurnHeader kind="think" />)
    // 先把 think 的索引推两格：盘算着 → 捋一捋
    act(() => { view.rerender(<TurnHeader kind="think" steps={{ done: 1, total: 9 }} />) })
    act(() => { view.rerender(<TurnHeader kind="think" steps={{ done: 2, total: 9 }} />) })
    expect(visibleText(view.container)).toContain('捋一捋')
    // 换动作 → 回到 edit 的首词「落笔」，而不是接着走成「改文件」
    act(() => { view.rerender(<TurnHeader kind="edit" steps={{ done: 2, total: 9 }} />) })
    expect(visibleText(view.container)).toContain('落笔')
  })

  it('stripWordOf 取模不越界，单字档恒定', () => {
    expect(stripWordOf('think', 0)).toBe('琢磨着')
    expect(stripWordOf('think', 6)).toBe('琢磨着')
    expect(stripWordOf('think', 999)).toBe('过脑子')
    expect(stripWordOf('approve', 7)).toBe('等你放行')
  })
})
