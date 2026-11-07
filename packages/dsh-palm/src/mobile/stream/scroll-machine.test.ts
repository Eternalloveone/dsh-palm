import { describe, expect, it } from 'vitest'
import {
  createScrollState,
  FOLLOW_LATCH_PX,
  FOLLOW_THRESHOLD_PX,
  mayAutoPin,
  maySettlePin,
  SCROLL_IDLE_MS,
  scrollReducer,
} from './scroll-machine.ts'

const at = 1_000_000
const run = (state: ReturnType<typeof createScrollState>, events: Parameters<typeof scrollReducer>[1][]) =>
  events.reduce(scrollReducer, state)

describe('滚动状态机：跟随靠「锁存」，不靠距离', () => {
  it('开新会话：默认跟随、无窗口', () => {
    const state = scrollReducer({ ...createScrollState(), userMoved: true }, { type: 'open', at })
    expect(state.mode).toBe('following')
    expect(state.stick).toBe(true)
    expect(state.userMoved).toBe(false)
    expect(state.gap).toBe(0)
  })

  it('往上抬一点点（仍在 80px 带宽内）→ 立刻停止跟随（这就是「抢手势」）', () => {
    const state = run(createScrollState(), [
      { type: 'pin' },
      { type: 'gesture', at, gap: FOLLOW_LATCH_PX + 10, up: true },
    ])
    expect(state.stick).toBe(false)
    expect(state.mode).toBe('reading')
    expect(mayAutoPin(state, at + 10_000, true)).toBe(false)
  })

  it('手指按着的时候一律不跟随（惯性滑行也算）', () => {
    let state = run(createScrollState(), [{ type: 'pin' }])
    state = scrollReducer(state, { type: 'touch-start', at })
    expect(mayAutoPin(state, at + 10_000, true)).toBe(false)
    state = scrollReducer(state, { type: 'touch-end', at: at + 5_000 })
    // 刚松手还在惯性里（< SCROLL_IDLE_MS）也不跟随
    expect(mayAutoPin(state, at + 5_000 + 10, true)).toBe(false)
    expect(mayAutoPin(state, at + 5_000 + SCROLL_IDLE_MS + 1, true)).toBe(true)
  })

  it('读者自己滑回底部 → 锁存重新打开', () => {
    let state = run(createScrollState(), [
      { type: 'pin' },
      { type: 'gesture', at, gap: 900, up: true },
    ])
    expect(state.stick).toBe(false)
    state = scrollReducer(state, { type: 'gesture', at: at + 5_000, gap: 4, up: false })
    expect(state.stick).toBe(true)
    expect(mayAutoPin(state, at + 5_000 + SCROLL_IDLE_MS + 1, true)).toBe(true)
  })

  it('程序化回声（measure）不改读者的锁存', () => {
    let state = run(createScrollState(), [
      { type: 'pin' },
      { type: 'gesture', at, gap: 600, up: true },
    ])
    expect(state.stick).toBe(false)
    state = scrollReducer(state, { type: 'measure', gap: 0 })
    expect(state.stick).toBe(false)
  })

  it('阈值边界：锁存距离以内算「触底」', () => {
    const inside = run(createScrollState(), [{ type: 'gesture', at, gap: FOLLOW_LATCH_PX, up: false }])
    expect(inside.stick).toBe(true)
    const outside = run(createScrollState(), [{ type: 'gesture', at, gap: FOLLOW_LATCH_PX + 1, up: false }])
    expect(outside.stick).toBe(false)
  })

  it('定位锁：进行中不跟随，到点自动解开', () => {
    let state = scrollReducer(createScrollState(), { type: 'locate-start', at, holdMs: 2_000 })
    expect(state.mode).toBe('locating')
    expect(mayAutoPin(state, at + 100, true)).toBe(false)
    state = scrollReducer(state, { type: 'stick-on', at: at + 2_500 })
    expect(mayAutoPin(state, at + 2_001, false)).toBe(true)
  })

  it('点「回到最新消息」= 明确要跟随', () => {
    let state = run(createScrollState(), [{ type: 'gesture', at, gap: 900, up: true }])
    expect(state.stick).toBe(false)
    state = scrollReducer(state, { type: 'stick-on', at: at + 1_000 })
    expect(state.stick).toBe(true)
    expect(state.followed).toBe(true)
  })

  it('显式安静期（刚发消息）：期间不跟随，过后恢复', () => {
    let state = run(createScrollState(), [{ type: 'pin' }])
    state = scrollReducer(state, { type: 'suppress', until: at + 1_500 })
    expect(mayAutoPin(state, at + 500, true)).toBe(false)
    expect(mayAutoPin(state, at + 1_501, true)).toBe(true)
  })

  it('进会话补钉：读者一动就停手，手指按着也不钉', () => {
    let state = scrollReducer(createScrollState(), { type: 'measure', gap: 400 })
    expect(maySettlePin(state, at)).toBe(true)
    state = scrollReducer(state, { type: 'gesture', at, gap: 400, up: true })
    expect(maySettlePin(state, at + 5_000)).toBe(false)
    const touching = scrollReducer(createScrollState(), { type: 'touch-start', at })
    expect(maySettlePin(touching, at + 1)).toBe(false)
  })

  it('「回到最新消息」按钮的阈值仍然是 80px（与跟随锁存分开）', () => {
    // 提示阈值没变，变的是「要不要自动跟随」
    expect(FOLLOW_THRESHOLD_PX).toBe(80)
    expect(FOLLOW_LATCH_PX).toBeLessThan(FOLLOW_THRESHOLD_PX)
  })
})
