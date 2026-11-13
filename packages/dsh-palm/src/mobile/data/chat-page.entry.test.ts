// @vitest-environment node
/**
 * 首屏取数的三条分支（根治第 2 阶段的数据面契约）。
 *
 * 1. 宿主支持 `maxRows`：**只用一次** sessionState 的结果，不再打 logTail；
 * 2. 老宿主只回一页（25 行）：回退 logTail，并**记住**结论 —— 下一次不再白试；
 * 3. 通道报错：静默回退 logTail（首屏不能因为这个失败）。
 *
 * 回退链上的 readChat / history 也 mock 成合理形状：测试要验的是"走哪条路"，
 * 不是"回退链自己崩不崩"（那是另一组用例的事）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api.ts', () => ({
  sessionState: vi.fn(),
  logTail: vi.fn(),
  readChat: vi.fn(),
  history: vi.fn(),
  turnOutlineOf: vi.fn(async () => ({ turns: null })),
}))
vi.mock('../session/history-cache.ts', () => ({ saveCachedHistory: vi.fn(async () => undefined) }))
vi.mock('../session/outline-cache.ts', () => ({ getCachedOutline: () => undefined, setCachedOutline: vi.fn() }))

const { history, logTail, readChat, sessionState } = await import('../api.ts')
const { loadChatPage, resetEntrySupportForTest } = await import('./chat-page.ts')

const stateMock = vi.mocked(sessionState)
const tailMock = vi.mocked(logTail)
const chatMock = vi.mocked(readChat)
const historyMock = vi.mocked(history)

/** 造 n 行"行"（形状只要够 foldChatPage 用）。 */
const rows = (n: number) => Array.from({ length: n }, (_, index) => ({ id: `r${index}`, kind: 'assistant' as const, seq: index + 1 }))

/** 一份能跳过投影补读分支的原子快照。 */
const entry = (n: number) => ({
  sessionId: 's-1',
  rows: rows(n),
  maxSeq: n,
  hasMore: true,
  queue: [],
  queueRevision: 0,
  turn: { running: false },
  goal: null,
  asOf: 1,
  projections: { values: { turnOutline: { turns: [] } } },
})

beforeEach(() => {
  vi.clearAllMocks()
  resetEntrySupportForTest()
  tailMock.mockResolvedValue({ rows: rows(120), maxSeq: 120, hasMore: true } as never)
  chatMock.mockResolvedValue({ rows: rows(120), maxSeq: 120, hasMore: true } as never)
  historyMock.mockResolvedValue({ events: [], hasMore: false } as never)
})

describe('首屏取数：sessionState 优先', () => {
  it('宿主支持时只用一次请求：拿到行与目标，且不再打 logTail', async () => {
    stateMock.mockResolvedValue(entry(120) as never)
    const page = await loadChatPage('s-1')
    expect(stateMock).toHaveBeenCalledTimes(1)
    expect(tailMock).not.toHaveBeenCalled()
    expect(page.rows.length).toBe(120)
    expect(page.entrySnapshot).toBe(true)
    // null 也是有效值：确认"没有目标"，目标条据此不画。
    expect(page.goal).toBeNull()
  })

  it('老宿主只回一页：回退 logTail，并记住下次不再试', async () => {
    stateMock.mockResolvedValue(entry(25) as never)
    const first = await loadChatPage('s-1')
    expect(tailMock).toHaveBeenCalledTimes(1)
    expect(first.rows.length).toBe(120)

    // 第二次：支持度已定为 no，直接走 logTail，不再试探。
    await loadChatPage('s-1')
    expect(stateMock).toHaveBeenCalledTimes(1)
    expect(tailMock).toHaveBeenCalledTimes(2)
  })

  it('通道报错：静默回退，首屏不失败', async () => {
    stateMock.mockRejectedValue(new Error('unavailable'))
    const page = await loadChatPage('s-1')
    expect(tailMock).toHaveBeenCalledTimes(1)
    expect(page.rows.length).toBe(120)
  })
})
