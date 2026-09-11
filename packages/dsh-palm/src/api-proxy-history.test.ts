/**
 * HistoryAdapter 的游标契约。
 *
 * `session.page` 的 `throughSeq` 是**上界**（宿主 `paginate` 用
 * `min(throughSeq + 1, …)` 收尾），且按定义只在 follow 打开帧那一瞬间有效
 * （session-controller types.ts:442）。旧实现把首个打开帧的游标按会话永久缓存，
 * 于是首次读之后的每一次分页都被钉死在那根旧游标上——手机端的轮询兜底、
 * 会话列表预览、冷装窗全部看不到新事件，只有重启 dsh 才恢复。这组测试锁住
 * 取代它的刷新契约（TTL 复用 + `fresh` 强制重取），防止回归。
 */
import { describe, expect, it, vi } from 'vitest'
import { HistoryAdapter, META_CACHE_LIMIT, META_TTL_MS, historyCacheSize, historyCachedCursor } from './api-proxy-history.ts'

/** One follow opening frame (the adapter only consumes `cursor`/`projections`). */
function snapshot(cursor: number, values: Record<string, unknown> = {}): unknown {
  return {
    type: 'snapshot',
    header: {},
    cursor,
    records: [],
    hasMore: false,
    projections: { asOfSeq: cursor, values },
  }
}

/** A fake SessionController: each follow open yields the next cursor; page records the cut. */
function fakeSession(frames: Array<{ cursor: number; values?: Record<string, unknown> }>) {
  const follows: number[] = []
  const cuts: number[] = []
  let opened = 0
  const session = {
    follow: () => {
      const frame = frames[Math.min(opened, frames.length - 1)] ?? { cursor: -1 }
      opened += 1
      follows.push(frame.cursor)
      return (async function* () { yield snapshot(frame.cursor, frame.values ?? {}) })()
    },
    page: async (request: { throughSeq: number }) => {
      cuts.push(request.throughSeq)
      return { records: [], hasMore: false }
    },
  }
  return { session: session as never, follows, cuts }
}

describe('HistoryAdapter cursor refresh', () => {
  it('opens one follow for the first read and reuses its cursor inside the TTL', async () => {
    const { session, follows, cuts } = fakeSession([{ cursor: 5 }])
    const adapter = new HistoryAdapter(session)

    await adapter.page({ sessionId: 's-1', maxMessages: 25 })
    await adapter.page({ sessionId: 's-1', maxMessages: 25 })

    expect(follows).toEqual([5])
    expect(cuts).toEqual([5, 5])
  })

  it('re-opens the follow once the TTL expires, so pages end at the current log', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_700_000_000_000)
      const { session, follows, cuts } = fakeSession([{ cursor: 5 }, { cursor: 9 }])
      const adapter = new HistoryAdapter(session)

      await adapter.page({ sessionId: 's-1', maxMessages: 25 })
      vi.setSystemTime(1_700_000_000_000 + META_TTL_MS)
      await adapter.page({ sessionId: 's-1', maxMessages: 25 })

      expect(follows).toEqual([5, 9])
      // The regression: the old implementation kept cutting at 5 forever.
      expect(cuts).toEqual([5, 9])
    } finally {
      vi.useRealTimers()
    }
  })

  it('honours fresh: cold installs and self-heal reads bypass the TTL', async () => {
    const { session, follows, cuts } = fakeSession([{ cursor: 5 }, { cursor: 9 }])
    const adapter = new HistoryAdapter(session)

    await adapter.page({ sessionId: 's-1', maxMessages: 25 })
    await adapter.page({ sessionId: 's-1', maxMessages: 25, fresh: true })

    expect(follows).toEqual([5, 9])
    expect(cuts).toEqual([5, 9])
  })

  it('shares one in-flight follow across concurrent fresh reads', async () => {
    const { session, follows } = fakeSession([{ cursor: 7 }])
    const adapter = new HistoryAdapter(session)

    await Promise.all([
      adapter.page({ sessionId: 's-1', maxMessages: 25, fresh: true }),
      adapter.page({ sessionId: 's-1', maxMessages: 25, fresh: true }),
    ])

    expect(follows).toEqual([7])
  })

  it('serves the projections that came with the refreshed cursor', async () => {
    const { session } = fakeSession([
      { cursor: 5, values: { permissions: { currentValue: 'readonly' } } },
      { cursor: 9, values: { permissions: { currentValue: 'workspace-write' } } },
    ])
    const adapter = new HistoryAdapter(session)

    const first = await adapter.page({ sessionId: 's-1', maxMessages: 25 })
    expect(first.projections).toEqual({ asOfSeq: 5, values: { permissions: { currentValue: 'readonly' } } })

    const second = await adapter.page({ sessionId: 's-1', maxMessages: 25, fresh: true })
    expect(second.projections).toEqual({ asOfSeq: 9, values: { permissions: { currentValue: 'workspace-write' } } })
  })

  it('keeps per-session cursors independent and clears them on request', async () => {
    const { session, follows } = fakeSession([{ cursor: 3 }, { cursor: 8 }])
    const adapter = new HistoryAdapter(session)

    await adapter.page({ sessionId: 's-a', maxMessages: 25 })
    await adapter.page({ sessionId: 's-b', maxMessages: 25 })
    expect(historyCachedCursor(adapter, 's-a')).toBe(3)
    expect(historyCachedCursor(adapter, 's-b')).toBe(8)
    expect(follows).toEqual([3, 8])

    adapter.clear('s-a')
    expect(historyCachedCursor(adapter, 's-a')).toBeUndefined()
    expect(historyCacheSize(adapter)).toBe(1)

    adapter.clearAll()
    expect(historyCacheSize(adapter)).toBe(0)
  })

  it('bounds the cursor cache by evicting the least recently refreshed session', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_700_000_000_000)
      const { session } = fakeSession([{ cursor: 1 }])
      const adapter = new HistoryAdapter(session)

      for (let index = 0; index < META_CACHE_LIMIT + 1; index++) {
        vi.setSystemTime(1_700_000_000_000 + index)
        await adapter.page({ sessionId: `s-${index}`, maxMessages: 1 })
      }

      expect(historyCacheSize(adapter)).toBe(META_CACHE_LIMIT)
      expect(historyCachedCursor(adapter, 's-0')).toBeUndefined()
      expect(historyCachedCursor(adapter, `s-${META_CACHE_LIMIT}`)).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
