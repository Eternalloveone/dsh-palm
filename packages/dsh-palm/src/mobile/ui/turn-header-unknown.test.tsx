// @vitest-environment jsdom
/**
 * unknown 态的界面契约 + 首帧不抖（真机：进会话先「已完成」，一秒后跳「运行中」）：
 *
 * 1. `kind='unknown'` = **无权威数据**：灰、写着「状态未知 · 等宿主回报」、不报步数、不报耗时
 *    （2026-11-10：以前这里是一个破折号，用户看不懂）；
 * 2. 未水合的首块是骨架：与真实任务头同一套类名（高度同构），没有「加载中…」文案；
 * 3. 一次水合只改口一次：unknown → 终态；之后同一轮再收到「在跑」也不许改写。
 *
 * 状态词与计时只在状态条：unknown 档没有 `[data-role="strip-time"]`。
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TurnHeader, TurnHeadSkeleton } from './turn-header.tsx'
import { deriveTaskStatus, foldTaskStatus } from '../session/task-status.ts'
import { mobileCss } from '../mobile-styles.ts'

afterEach(() => { cleanup() })

/** 去掉注释后的样式表：规则边界才好用 `}` 定位。 */
const CSS = mobileCss.replace(/\/\*[\s\S]*?\*\//g, '')

/** 读一条规则的声明体（选择器要写全，且必须从规则边界开始）。 */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp('(?:^|[}])\\s*' + escaped + '\\s*\\{([^}]*)\\}').exec(CSS)
  if (match === null) throw new Error(`样式表里找不到规则 ${selector}`)
  return match[1] ?? ''
}

describe('TurnHeader：unknown 只陈述事实', () => {
  it('写「确认中」而不是空白，右端时钟照走', () => {
    const { container } = render(<TurnHeader kind="unknown" steps={{ done: 3, total: 7 }} durationMs={12_400} />)
    const head = container.querySelector('.palm-turn-head')!
    expect(head.getAttribute('data-kind')).toBe('unknown')
    // 2026-11-11：待定态也要有字 —— 「确认中」陈述的是"在等宿主回话"，不假装在跑、也不留白。
    expect(container.querySelector('.palm-strip [data-part="label"]')!.textContent).toBe('等回话')
    expect(container.querySelector('.palm-strip [data-part="detail"]')).toBeNull()
    expect(container.querySelector('.palm-turn-state')).toBeNull()
    expect(container.querySelector('.palm-turn-steps')).toBeNull()
    // 时钟照走（这条断言就是「右端不能突然消失」）。
    expect(container.querySelector('[data-role="strip-time"]')!.textContent).toBe('12s')
    expect(container.textContent).not.toContain('已完成')
    // 状态条：仍然画（不许整块消失），但没有刻度轨（不编步数）。
    expect(container.querySelector('.palm-strip')!.getAttribute('data-kind')).toBe('unknown')
    expect(container.querySelector('.palm-strip-rail')).toBeNull()
  })

  it('终态照旧报步数与耗时（unknown 的规则不外溢），且耗时只在状态条', () => {
    const { container } = render(<TurnHeader kind="done" steps={{ done: 7, total: 7 }} durationMs={12_400} />)
    const label = container.querySelector('.palm-strip [data-part="label"]')!
    expect(label.textContent).toContain('7 步')
    expect(container.querySelector('[data-role="strip-time"]')!.textContent).toBe('12s')
    expect(container.querySelector('.palm-turn-time')).toBeNull()
    expect(container.querySelector('.palm-turn-state')).toBeNull()
  })
})

describe('TurnHeadSkeleton：未水合的首块', () => {
  it('与真实任务头同一套类名（高度同构），且不写「加载中…」也不写结论', () => {
    const { container } = render(
      <>
        <TurnHeadSkeleton />
        <TurnHeader kind="done" goal="把首帧跳变修掉" steps={{ done: 7, total: 7 }} durationMs={12_400} />
      </>,
    )
    const [skeleton, real] = Array.from(container.querySelectorAll('.palm-turn-head'))
    expect(skeleton.className).toBe(real.className)
    for (const part of ['.palm-turn-goal', '.palm-strip']) {
      expect(skeleton.querySelector(part), part).not.toBeNull()
      expect(real.querySelector(part), part).not.toBeNull()
    }
    // 顶部状态行随真实头一起删了：骨架也不许再画一个。
    for (const gone of ['.palm-turn-top', '.palm-turn-dot', '.palm-turn-state']) {
      expect(skeleton.querySelector(gone), gone).toBeNull()
    }
    const text = skeleton.textContent ?? ''
    expect(text).not.toContain('加载中')
    expect(text).not.toContain('已完成')
    expect(text).not.toContain('运行中')
    expect(container.textContent).not.toContain('加载中')
  })

  it('骨架与真实任务头同高：逐行同一套类名，目标行吃同一个 --palm-turn-goal-h', () => {
    const { container } = render(
      <>
        <TurnHeadSkeleton />
        <TurnHeader kind="done" goal="把首帧跳变修掉" durationMs={12_400} />
      </>,
    )
    const [skeleton, real] = Array.from(container.querySelectorAll('.palm-turn-head'))
    // 真实头（一行目标、无元信息）的行序 = 骨架的行序；同一套类名 = 同一套高度令牌。
    const rows = (head: Element): string[] => Array.from(head.children).map(child => child.className)
    expect(rows(skeleton)).toEqual(rows(real))
    expect(skeleton.querySelector('.palm-turn-goal')).not.toBeNull()
    expect(real.querySelector('.palm-turn-goal')).not.toBeNull()
    // 目标行的最小行高由令牌钉死，骨架占位与真实目标共用这一个值。
    expect(ruleBody('.palm-turn-goal')).toContain('min-block-size: var(--palm-turn-goal-h)')
    // 骨架没有元信息行（真实头没给元信息时也没有），两边都靠 --palm-turn-gap 分行。
    expect(skeleton.querySelector('.palm-turn-meta')).toBeNull()
    expect(ruleBody('.palm-turn-head')).toContain('gap: var(--palm-turn-gap)')
  })

  it('骨架的状态条画成占位块，不再是「一个空控件 + 破折号」', () => {
    // 2026-11-10 加载态实拍：骨架里的状态条是真的 StatusStrip（kind=unknown），
    // 于是加载时屏幕上出现一条空药丸 + 一个「—」，看起来像坏掉的控件。
    const { container } = render(<TurnHeadSkeleton />)
    const strip = container.querySelector('.palm-strip')
    expect(strip).not.toBeNull()
    expect(strip!.getAttribute('data-skeleton')).toBe('true')
    expect(strip!.getAttribute('aria-hidden')).toBe('true')
    // 不再有文字，也就不再有一个假的「—」。
    expect(strip!.textContent).toBe('')
    expect(container.textContent).toBe('')
  })
})

describe('水合只改口一次：unknown → 终态，之后不许 done → running', () => {
  const at = 1_700_000_000_000

  it('未水合 unknown，水合后终态，迟到的 running 仍是终态', () => {
    // 未水合：没有裁决（宿主快照没到）→ unknown。
    const before = deriveTaskStatus({ now: at, turn: { turnNo: 4 }, activity: { streaming: true } })
    expect(before.kind).toBe('unknown')

    // 水合：宿主快照说这一轮没在跑 → 终态（一次改口）。
    const settled = foldTaskStatus(before, { now: at, turn: { running: false, turnNo: 4 }, outcome: 'completed' })
    expect(settled.kind).toBe('done')

    // 迟到的「在跑」：同一轮，终态锁定必须拦住（否则就是真机那条 done→running）。
    const late = foldTaskStatus(settled, {
      now: at + 1_000,
      turn: { running: true, turnNo: 4, startedAt: at },
      activity: { streaming: true },
    })
    expect(late.kind).toBe('done')
    expect(late).toEqual(settled)

    // 只有轮号变大才允许重新点亮。
    const next = foldTaskStatus(late, { now: at + 2_000, turn: { running: true, turnNo: 5, startedAt: at + 2_000 } })
    expect(next.kind).toBe('think')
    expect(next.terminal).toBe(false)
  })

  it('渲染出来的状态词序列里不会出现「已完成 → 运行中」的倒序', () => {
    const sequence = []
    let status = deriveTaskStatus({ now: at, turn: { turnNo: 4 } })
    sequence.push(status.kind)
    status = foldTaskStatus(status, { now: at, turn: { running: false, turnNo: 4 }, outcome: 'completed' })
    sequence.push(status.kind)
    status = foldTaskStatus(status, { now: at + 1_000, turn: { running: true, turnNo: 4 } })
    sequence.push(status.kind)
    expect(sequence).toEqual(['unknown', 'done', 'done'])
    const { container } = render(<TurnHeader kind={status.kind} />)
    expect(container.querySelector('.palm-strip [data-part="label"]')!.textContent).toBe('成了')
  })
})
