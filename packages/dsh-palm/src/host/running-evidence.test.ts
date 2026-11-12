// @vitest-environment node
/**
 * `computeTurnState` 的"预读边界"路径（2026-11-11 性能）。
 *
 * `mobile.sessionState` 现在把 `readChatTailPage` 随页带回的边界直接传进来，
 * 同一个请求不再读两遍日志尾页。这里用一个不存在的会话名证明：传了边界就
 * 完全走内存判断，日志读不到也不影响结论。
 */
import { describe, expect, it } from 'vitest'
import { computeTurnState } from './running-evidence.ts'

describe('computeTurnState：预读边界', () => {
  it('传了 turn/start 边界就直接判在跑，且不再读日志', async () => {
    const startAt = Date.now() - 1_000
    const state = await computeTurnState('no-such-session-for-precomputed-boundary', {
      type: 'turn/start',
      time: startAt,
      seq: 7,
    })
    expect(state.running).toBe(true)
    expect(state.seq).toBe(7)
    expect(state.turnStartAt).toBe(startAt)
  })

  it('传了 turn/end 边界就直接判收工', async () => {
    const state = await computeTurnState('no-such-session-for-precomputed-boundary', {
      type: 'turn/end',
      time: Date.now(),
      seq: 8,
    })
    expect(state.running).toBe(false)
    expect(state.seq).toBe(8)
  })
})
