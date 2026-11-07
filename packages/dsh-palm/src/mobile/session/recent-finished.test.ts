// @vitest-environment jsdom
/** recent-finished：刚结束账本（去重/上限/TTL/持久化/订阅）。 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FINISHED_MAX,
  FINISHED_TTL_MS,
  clearFinishedRuns,
  finishedRuns,
  recordFinishedRun,
  resetFinishedRunsForTest,
  shortSessionId,
  subscribeFinishedRuns,
} from './recent-finished.ts'

const T0 = 1_700_000_000_000

beforeEach(() => {
  window.localStorage.clear()
  clearFinishedRuns()
})

describe('recent-finished', () => {
  it('keeps the newest first and dedupes per session', () => {
    recordFinishedRun({ sessionId: 's-1', title: '第一个', finishedAt: T0, status: 'done' }, T0)
    recordFinishedRun({ sessionId: 's-2', title: '第二个', finishedAt: T0 + 1_000, status: 'error' }, T0 + 1_000)
    recordFinishedRun({ sessionId: 's-1', title: '第一个（又跑完一次）', finishedAt: T0 + 2_000, status: 'done' }, T0 + 2_000)
    const entries = finishedRuns(T0 + 2_000)
    expect(entries.map(entry => entry.title)).toEqual(['第一个（又跑完一次）', '第二个'])
  })

  it('keeps at most FINISHED_MAX entries', () => {
    for (let index = 0; index < FINISHED_MAX + 4; index += 1) {
      recordFinishedRun({
        sessionId: `s-${index}`,
        title: `会话 ${index}`,
        finishedAt: T0 + index,
        status: 'done',
      }, T0 + index)
    }
    expect(finishedRuns(T0 + FINISHED_MAX + 4)).toHaveLength(FINISHED_MAX)
  })

  it('drops entries older than the TTL', () => {
    recordFinishedRun({ sessionId: 's-old', title: '老记录', finishedAt: T0, status: 'done' }, T0)
    expect(finishedRuns(T0 + FINISHED_TTL_MS + 1)).toHaveLength(0)
  })

  it('shows the turn duration and summary when they are known', () => {
    recordFinishedRun({
      sessionId: 's-1',
      title: '带用时',
      finishedAt: T0,
      status: 'done',
      durationMs: 519_000,
      summary: '修好了',
    }, T0)
    const [entry] = finishedRuns(T0)
    expect(entry?.durationMs).toBe(519_000)
    expect(entry?.summary).toBe('修好了')
  })

  it('falls back to a short id when the title is empty', () => {
    recordFinishedRun({ sessionId: 'session-abcdef12-3456', title: '', finishedAt: T0, status: 'done' }, T0)
    expect(finishedRuns(T0)[0]?.title).toBe('abcdef12')
  })

  it('persists to localStorage and reloads from it', () => {
    recordFinishedRun({ sessionId: 's-1', title: '重启后还在', finishedAt: T0, status: 'done' }, T0)
    resetFinishedRunsForTest()
    expect(finishedRuns(T0)[0]?.title).toBe('重启后还在')
  })

  it('survives a corrupt storage payload', () => {
    window.localStorage.setItem('dsh-palm.finished-runs.v1', '{not json')
    resetFinishedRunsForTest()
    expect(finishedRuns(T0)).toEqual([])
  })

  it('notifies subscribers on record and clear', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeFinishedRuns(listener)
    recordFinishedRun({ sessionId: 's-1', title: '一条', finishedAt: T0, status: 'done' }, T0)
    expect(listener).toHaveBeenCalled()
    clearFinishedRuns()
    expect(finishedRuns(T0)).toEqual([])
    unsubscribe()
  })

  it('shortens a session id for display', () => {
    expect(shortSessionId('session-d82d46ff-d13c')).toBe('d82d46ff')
  })
})
