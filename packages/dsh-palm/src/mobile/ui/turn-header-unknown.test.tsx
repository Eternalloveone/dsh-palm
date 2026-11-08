// @vitest-environment jsdom
/**
 * unknown 态的界面契约 + 首帧不抖（真机：进会话先「已完成」，一秒后跳「运行中」）：
 *
 * 1. `kind='unknown'` = **无权威数据**：灰、没有状态词（落「—」）、不报步数、不报耗时；
 * 2. 未水合的首块是骨架：与真实任务头同一套类名（高度同构），没有「加载中…」文案；
 * 3. 一次水合只改口一次：unknown → 终态；之后同一轮再收到「在跑」也不许改写。
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TurnHeader, TurnHeadSkeleton } from './turn-header.tsx'
import { deriveTaskStatus, foldTaskStatus } from '../session/task-status.ts'

afterEach(() => { cleanup() })

describe('TurnHeader：unknown 不画任何结论', () => {
  it('没有状态词（落「—」）、没有步数、没有耗时，data-kind 交给样式表上灰', () => {
    const { container } = render(<TurnHeader kind="unknown" steps={{ done: 3, total: 7 }} durationMs={12_400} />)
    const head = container.querySelector('.palm-turn-head')!
    expect(head.getAttribute('data-kind')).toBe('unknown')
    expect(container.querySelector('.palm-turn-state')!.textContent).toBe('—')
    expect(container.querySelector('.palm-turn-steps')).toBeNull()
    expect(container.querySelector('.palm-turn-time')).toBeNull()
    expect(container.textContent).not.toContain('已完成')
    // 状态条：仍然画（不许整块消失），但没有刻度轨（不编步数）。
    expect(container.querySelector('.palm-strip')!.getAttribute('data-kind')).toBe('unknown')
    expect(container.querySelector('.palm-strip-rail')).toBeNull()
  })

  it('终态照旧报步数与耗时（unknown 的规则不外溢）', () => {
    const { container } = render(<TurnHeader kind="done" steps={{ done: 7, total: 7 }} durationMs={12_400} />)
    expect(container.querySelector('.palm-turn-state')!.textContent).toBe('已完成')
    expect(container.querySelector('.palm-turn-steps')!.textContent).toContain('7 步')
    expect(container.querySelector('.palm-turn-time')!.textContent).toBe('12.4s')
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
    for (const part of ['.palm-turn-top', '.palm-turn-dot', '.palm-turn-state', '.palm-strip']) {
      expect(skeleton.querySelector(part), part).not.toBeNull()
      expect(real.querySelector(part), part).not.toBeNull()
    }
    const text = skeleton.textContent ?? ''
    expect(text).not.toContain('加载中')
    expect(text).not.toContain('已完成')
    expect(text).not.toContain('运行中')
    expect(container.textContent).not.toContain('加载中')
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
    expect(container.querySelector('.palm-turn-state')!.textContent).toBe('已完成')
  })
})
