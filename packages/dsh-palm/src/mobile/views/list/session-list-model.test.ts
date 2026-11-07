/**
 * 会话列表的"在跑"判据（W3-4）：与首页徽标、运行总览必须是同一个答案。
 *
 * 这条测试的重点不是数学，而是**优先级**：列表自己有一整套花名册/心跳判据，
 * 但聊天页一旦发布过状态，就得以它为准 —— 否则"列表绿点、点进去已结束"复发。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { SessionView } from '../../shared/session-view.ts'
import { dispatchStatusEvent, resetStatusStoreForTest } from '../../session-status-store.ts'
import { emptyLiveState, patchRow } from './session-list-model.ts'

function row(overrides: Partial<SessionView> = {}): SessionView {
  return {
    sessionId: 's1',
    title: '会话',
    updatedAt: Date.now(),
    running: false,
    blank: false,
    ...overrides,
  }
}

beforeEach(() => { resetStatusStoreForTest() })

describe('patchRow 的在跑判据', () => {
  it('没有共享证据时用本模型自己的判据（status 帧说在跑）', () => {
    const live = emptyLiveState()
    live.status.set('s1', true)
    live.statusAt.set('s1', Date.now())
    expect(patchRow(row(), live).running).toBe(true)
  })

  it('共享状态说停了 → 即使本模型判据说在跑，也以共享为准', () => {
    dispatchStatusEvent('s1', { type: 'turn', at: Date.now(), source: 'frame', running: false, turnNo: 1 })
    const live = emptyLiveState()
    live.status.set('s1', true)
    live.statusAt.set('s1', Date.now())
    expect(patchRow(row(), live).running).toBe(false)
  })

  it('共享状态说在跑 → 即使本模型判据说停了，也以共享为准', () => {
    dispatchStatusEvent('s1', { type: 'turn', at: Date.now(), source: 'frame', running: true, turnNo: 1 })
    const live = emptyLiveState()
    expect(patchRow(row({ running: false }), live).running).toBe(true)
  })

  it('显式注入的读法覆盖默认（测试/特殊页面用）', () => {
    const live = emptyLiveState()
    expect(patchRow(row(), live, Date.now(), () => true).running).toBe(true)
    expect(patchRow(row({ running: true }), live, Date.now(), () => false).running).toBe(false)
  })
})
