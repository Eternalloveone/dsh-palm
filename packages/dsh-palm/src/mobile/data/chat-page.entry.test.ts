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
vi.mock('../session/history-cache.ts', () => ({
  saveCachedHistory: vi.fn(async () => undefined),
  // 切回同一场时会先看一眼本地那份（chat-sync-ledger）；这里给"没有缓存"。
  loadCachedHistory: vi.fn(async () => undefined),
}))
vi.mock('../session/outline-cache.ts', () => ({ getCachedOutline: () => undefined, setCachedOutline: vi.fn() }))

const { history, logTail, readChat, sessionState } = await import('../api.ts')
const { loadChatPage, resetEntrySupportForTest } = await import('./chat-page.ts')
const { resetChatSyncLedger, noteChatSynced, canSkipEntryRead } = await import('../session/chat-sync-ledger.ts')
const { loadCachedHistory } = await import('../session/history-cache.ts')

const loadCachedHistoryMock = vi.mocked(loadCachedHistory)

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
  // 切会话账本是模块级：同一场第二次进会走"本地那份"（见 chat-sync-ledger），
  // 不清就会让下一条用例读到上一条的同步记录，看起来像"宿主请求没发出去"。
  resetChatSyncLedger()
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

  it('老宿主只回一页：回退 logTail，连续两次才认定不再试', async () => {
    stateMock.mockResolvedValue(entry(25) as never)
    const first = await loadChatPage('s-1')
    expect(tailMock).toHaveBeenCalledTimes(1)
    expect(first.rows.length).toBe(120)

    // 第二次（换一个会话）仍是固定 25 行：这才坐实「这个宿主忽略 maxRows」。
    await loadChatPage('s-2')
    expect(stateMock).toHaveBeenCalledTimes(2)
    expect(tailMock).toHaveBeenCalledTimes(2)

    // 第三次：支持度已定为 no，直接走 logTail，不再试探。
    await loadChatPage('s-3')
    expect(stateMock).toHaveBeenCalledTimes(2)
    expect(tailMock).toHaveBeenCalledTimes(3)
  })

  /**
   * 回归门（2026-11-14「切来切去都卡」）：会话本身就不足 40 行时，行数当然凑不满 40，
   * 但那**不是**老宿主的证据。原来按「行数 < 40」判，切到一个短会话就把支持度钉成 no，
   * 之后每一次切换都改走 logTail（再整份拉 session.history），跟会话大小无关地一直慢。
   */
  it('会话本身就短：直接用快照，且不许因此把支持度判成 no', async () => {
    stateMock.mockResolvedValue(entry(7) as never)
    const page = await loadChatPage('s-1')
    expect(stateMock).toHaveBeenCalledTimes(1)
    expect(tailMock).not.toHaveBeenCalled()
    expect(page.rows.length).toBe(7)
    expect(page.entrySnapshot).toBe(true)

    // 后面切到正常会话：仍然走快照，没有被打上「老宿主」的烙印。
    stateMock.mockResolvedValue(entry(40) as never)
    await loadChatPage('s-2')
    expect(stateMock).toHaveBeenCalledTimes(2)
    expect(tailMock).not.toHaveBeenCalled()
  })

  it('会话比 40 行少但不止 25 行：同样直接用快照', async () => {
    stateMock.mockResolvedValue(entry(30) as never)
    const page = await loadChatPage('s-1')
    expect(tailMock).not.toHaveBeenCalled()
    expect(page.rows.length).toBe(30)
    expect(page.entrySnapshot).toBe(true)
  })

  it('通道报错：静默回退，首屏不失败', async () => {
    stateMock.mockRejectedValue(new Error('unavailable'))
    const page = await loadChatPage('s-1')
    expect(tailMock).toHaveBeenCalledTimes(1)
    expect(page.rows.length).toBe(120)
  })

  /**
   * 水位自愈（2026-11-16 真机）：账本说"刚同步过"、缓存里那份停在水位 100，
   * 而宿主已经 120 —— 这时吃缓存就是自愈读自己。`bypassEntryCache` 必须让这次
   * 读取走到宿主，顺手把账本作废掉。
   */
  it('bypassEntryCache：账本与缓存都是旧的也不许直通', async () => {
    noteChatSynced('s-stale')
    loadCachedHistoryMock.mockResolvedValueOnce({ rows: rows(10), maxSeq: 100, hasMore: true })
    stateMock.mockResolvedValue(entry(120) as never)

    const page = await loadChatPage(
      's-stale', undefined, undefined, undefined, undefined, undefined,
      { bypassEntryCache: true },
    )

    expect(loadCachedHistoryMock).not.toHaveBeenCalled()
    expect(stateMock).toHaveBeenCalledTimes(1)
    expect(page.maxSeq).toBe(120)
    // 这次读完账本按新那份重新记（本地已经是当前状态），下一次切换照旧可以直通。
    expect(canSkipEntryRead('s-stale')).toBe(true)
  })

  it('不传 bypass：账本有效时仍然直通本地那份（切换会话的加速路径不受影响）', async () => {
    noteChatSynced('s-fast')
    const cached = { rows: rows(10), maxSeq: 100, hasMore: true }
    loadCachedHistoryMock.mockResolvedValueOnce(cached)

    const page = await loadChatPage('s-fast')

    expect(stateMock).not.toHaveBeenCalled()
    expect(page.maxSeq).toBe(100)
  })
})
