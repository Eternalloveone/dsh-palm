import { describe, expect, it } from 'vitest'
import { deriveStatusFrame, feedStatusFrame } from './status-feed.ts'
import { createSessionStatus } from './session-status.ts'

const row = (turn: number | undefined, step: number | undefined, time = 0) => ({ turn, step, time })

const baseInput = {
  running: true,
  runningTurn: 5 as number | undefined,
  messages: [row(5, undefined, 1_000)],
  rawRows: [row(5, 1), row(5, 3), row(4, 9)],
  queueItems: [],
  goal: undefined,
  goalBusy: false,
  todo: undefined,
  jobs: [],
  subagents: [],
}

describe('状态条投影：deriveStatusFrame', () => {
  it('帧里没有轮号时，用最靠后那一行的轮兜底', () => {
    const frame = deriveStatusFrame({ ...baseInput, runningTurn: undefined, messages: [row(2, undefined), row(7, undefined)] })
    expect(frame.turnNo).toBeUndefined()
    // 兜底只用于算 step；喂给状态机的轮号仍是帧里那个（undefined）
    expect(frame.turnStep).toBeUndefined()
  })

  it('步序取**原始行**里这一轮的最大 step（合并行只剩第一步）', () => {
    expect(deriveStatusFrame(baseInput).turnStep).toBe(3)
  })

  it('最近活动时刻只看最后 8 行', () => {
    const messages = [row(9, undefined, 99_999), ...Array.from({ length: 8 }, (_, i) => row(9, undefined, 100 + i))]
    expect(deriveStatusFrame({ ...baseInput, messages }).lastActivityAt).toBe(107)
  })
})

describe('状态条投影：feedStatusFrame', () => {
  it('五条事件各进各的槽位，并留下帧来源', () => {
    const frame = deriveStatusFrame({ ...baseInput, goal: { text: 'g' }, todo: { seq: 1, items: [] }, jobs: [{ id: 'j1', kind: 'task', label: 'j', status: 'running', startedAt: 0 }] })
    const state = feedStatusFrame(createSessionStatus(), frame, 10_000)
    expect(state.turn?.value.running).toBe(true)
    expect(state.turn?.value.turnNo).toBe(5)
    expect(state.turn?.value.step).toBe(3)
    expect(state.queue?.value).toEqual([])
    expect(state.goal?.value).toEqual({ text: 'g' })
    expect(state.jobs?.value?.map(job => job.id)).toEqual(['j1'])
    expect(state.revision).toBeGreaterThan(0)
  })

  it('扫过期：租约到点后不再算数', () => {
    const frame = deriveStatusFrame(baseInput)
    const alive = feedStatusFrame(createSessionStatus(), frame, 10_000)
    expect(alive.turn).toBeDefined()
    const expired = feedStatusFrame(alive, { ...frame, running: false }, 10_000 + 600_000)
    expect(expired.turn?.until).toBeGreaterThan(0)
    // 同一帧在很久之后再喂：旧租约被扫掉，只剩新这一帧的
    expect(expired.turn?.at).toBe(610_000)
  })

  it('不修改入参（纯函数）', () => {
    const state = createSessionStatus()
    const snapshot = JSON.stringify(state)
    feedStatusFrame(state, deriveStatusFrame(baseInput), 1_000)
    expect(JSON.stringify(state)).toBe(snapshot)
  })
})
