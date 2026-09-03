/**
 * ChatWindowService (v3 folded-view window cache): cold tail install, window
 * hits that never touch the fetcher, live event/projection feeding, older
 * page prepend, bounds (LRU + row cap), and the mux-frame router.
 */
import { describe, expect, it, vi } from 'vitest'
import { ChatWindowService, WINDOW_LIMIT, WINDOW_ROW_LIMIT } from './chat-window.ts'
import type { ChatHistoryFetcher } from './chat-window.ts'
import type { SessionProjectionsBlock } from '@deepseek-ai/dsh-host-apiproxy/api/sessions'
import type { WireEvent } from './mobile/messages.ts'

/** One history entry in the fetcher's post-envelope shape. */
function entry(type: string, data: unknown, seq: number, view?: unknown): { event: WireEvent; view?: unknown } {
  const e = { event: { type, seq, time: seq * 1_000, data } }
  return view === undefined ? e : { ...e, view }
}

/** A user→assistant turn: one of each message kind plus a tool call. */
function turnEvents(offset = 0): Array<{ event: WireEvent; view?: unknown }> {
  const base = offset * 100
  return [
    entry('user/message', { id: `u-${base}`, role: 'user', content: [{ type: 'text', text: '改一下' }] }, base),
    entry('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'text-delta', index: 0, text: '正在' } }, base + 1),
    entry('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'text-delta', index: 0, text: '处理' } }, base + 2),
    entry('tool/call', { turn: 0, step: 0, callId: 'c1', name: 'bash', arguments: '{"cmd":"ls"}' }, base + 3),
    entry('assistant/message', {
      turn: 0,
      step: 0,
      message: { id: `a-${base}`, role: 'assistant', content: [{ type: 'text', text: '已完成' }] },
    }, base + 4),
  ]
}

/** A fetcher recording every call and serving fixed pages. */
function fakeFetcher(pages: Array<{ beforeSeq?: number; hasMore: boolean; projections?: SessionProjectionsBlock }> = []) {
  const calls: Array<{ sessionId: string; beforeSeq: number | undefined; maxMessages: number }> = []
  const fetcher: ChatHistoryFetcher = async (sessionId, beforeSeq, maxMessages) => {
    calls.push({ sessionId, beforeSeq, maxMessages })
    const page = pages.shift() ?? { hasMore: false }
    return {
      events: turnEvents(),
      hasMore: page.hasMore,
      ...(page.projections === undefined ? {} : { projections: page.projections }),
    }
  }
  return { fetcher, calls }
}

/** The tail texts of the folded rows (assistant/user concatenation check). */
function rowTexts(rows: ReadonlyArray<{ kind: string; text: string }>): string[] {
  return rows.map(row => (row.kind === 'assistant' ? row.text : row.text))
}

/** A projection baseline with loose values (the key map is a compile-time
 *  registry; tests use deployment-specific keys like permissions). */
function projectionBlock(values: Record<string, unknown>): SessionProjectionsBlock {
  return { asOfSeq: 4, values: values as never }
}

describe('ChatWindowService', () => {
  it('installs a window from one cold tail read and folds the page into rows', async () => {
    const { fetcher, calls } = fakeFetcher([{ hasMore: true, projections: projectionBlock({ permissions: { currentValue: 'readonly' } }) }])
    const service = new ChatWindowService(fetcher)

    const page = await service.tail('s-1', 25)
    expect(page.rows.length).toBe(2)
    // Chunks aggregate into the final message text.
    expect(rowTexts(page.rows)).toEqual(['改一下', '已完成'])
    expect(page.rows.map(row => row.seq)).toEqual([0, 4])
    // The page event watermark: the tail event seq within the fold.
    expect(page.maxSeq).toBe(4)
    expect(page.hasMore).toBe(true)
    expect(page.projections).toEqual({ asOfSeq: 4, values: { permissions: { currentValue: 'readonly' } } })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({ sessionId: 's-1', beforeSeq: undefined, maxMessages: 25 })
  })

  it('serves a window hit from memory — zero fetcher calls on repeat tails', async () => {
    const { fetcher, calls } = fakeFetcher()
    const service = new ChatWindowService(fetcher)
    await service.tail('s-1', 25)
    const again = await service.tail('s-1', 25)
    const third = await service.tail('s-1', 1)
    expect(calls).toHaveLength(1)
    expect(again.rows.length).toBe(2)
    // maxRows slices the tail rows for the page.
    expect(third.rows.length).toBe(1)
    expect(third.rows[0]?.text).toBe('已完成')
  })

  it('advances the window on live events and tracks the newest todo snapshot', async () => {
    const { fetcher } = fakeFetcher()
    const service = new ChatWindowService(fetcher)
    await service.tail('s-1', 25)

    service.handleEvent('s-1', entry('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'text-delta', index: 0, text: '追加' } }, 10).event)
    const page = await service.tail('s-1', 25)
    expect(page.rows.at(-1)?.text).toBe('已完成追加')
    expect(page.maxSeq).toBe(10)

    // A todo/write seeds the plan snapshot with its event seq.
    service.handleEvent('s-1', entry('todo/write', { todos: [{ content: '任务一', status: 'in_progress' }] }, 11).event)
    const withTodo = await service.tail('s-1', 25)
    expect(withTodo.todo).toEqual({ seq: 11, items: [{ content: '任务一', status: 'in_progress' }] })
  })

  it('ignores live events for sessions without a resident window', async () => {
    const { fetcher, calls } = fakeFetcher()
    const service = new ChatWindowService(fetcher)
    service.handleEvent('s-other', entry('user/message', { id: 'x' }, 5).event)
    expect(calls).toHaveLength(0)
    expect(service.size).toBe(0)
  })

  it('reads one older page from the log and prepends it into the live window', async () => {
    const { fetcher, calls } = fakeFetcher([{ hasMore: true }, { hasMore: false }])
    const service = new ChatWindowService(fetcher)
    await service.tail('s-1', 25)

    const older = await service.before('s-1', 0, 25)
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual({ sessionId: 's-1', beforeSeq: 0, maxMessages: 25 })
    expect(older.hasMore).toBe(false)
    // The window now spans two pages; the tail still serves the newest slice.
    const page = await service.tail('s-1', 25)
    expect(page.rows.length).toBe(4)
    expect(page.maxSeq).toBe(4)
    // No fetcher call for the hit after the page read.
    expect(calls).toHaveLength(2)
  })

  it('merges projection frames under the higher-seq-wins rule', async () => {
    const { fetcher } = fakeFetcher([{ hasMore: false, projections: projectionBlock({ permissions: { currentValue: 'readonly' } }) }])
    const service = new ChatWindowService(fetcher)
    await service.tail('s-1', 25)

    service.handleProjection('s-1', 'contextPressure', { pct: 42 }, 12)
    const page = await service.tail('s-1', 25)
    expect(page.projections?.values).toEqual({
      permissions: { currentValue: 'readonly' },
      contextPressure: { pct: 42 },
    })
    expect(page.projections?.asOfSeq).toBe(12)

    // A stale frame (older seq) never overwrites the baseline.
    service.handleProjection('s-1', 'contextPressure', { pct: 0 }, 5)
    const afterStale = await service.tail('s-1', 25)
    expect((afterStale.projections?.values as Record<string, unknown>).contextPressure).toEqual({ pct: 42 })
  })

  it('routes host mux frames: session/event (with view) and session/projection', async () => {
    const { fetcher } = fakeFetcher([{ hasMore: false, projections: { asOfSeq: 4, values: {} } }])
    const service = new ChatWindowService(fetcher)
    await service.tail('s-1', 25)

    service.onFrame({ payload: { type: 'session/event', sessionId: 's-1', event: entry('tool/call', { turn: 0, step: 0, callId: 'c2', name: 'write', arguments: '{}' }, 20).event, view: { for: 'call', view: { card: 'diff', title: 'Write', diffs: [] } } } })
    const page = await service.tail('s-1', 25)
    const tool = page.rows.at(-1)?.tools?.find(call => call.callId === 'c2')
    expect(tool?.view?.card).toBe('diff')
    expect(page.maxSeq).toBe(20)

    service.onFrame({ payload: { type: 'session/projection', sessionId: 's-1', key: 'permissions', value: { currentValue: 'workspace-write' }, seq: 21 } })
    expect(((await service.tail('s-1', 25)).projections?.values as Record<string, unknown>).permissions)
      .toEqual({ currentValue: 'workspace-write' })

    // Non-session frames are ignored.
    service.onFrame({ payload: { type: 'session/queue', sessionId: 's-1', items: [] } })
    service.onFrame({ payload: { type: 'approval/requested' } })
    service.onFrame({ payload: undefined })
    expect(service.size).toBe(1)
  })

  it('evicts the least-recently-accessed window past the limit', async () => {
    const { fetcher } = fakeFetcher()
    const service = new ChatWindowService(fetcher)
    for (let index = 0; index < WINDOW_LIMIT; index++) {
      await service.tail(`s-${index}`, 25)
    }
    expect(service.size).toBe(WINDOW_LIMIT)
    // Touch s-0 (oldest) then add one more: s-1 must go, s-0 stays.
    await service.tail('s-0', 25)
    await service.tail('s-new', 25)
    expect(service.size).toBe(WINDOW_LIMIT)
    expect((await service.tail('s-0', 25)).rows.length).toBeGreaterThan(0)
    // s-1 was evicted: its window got reinstalled by a fresh fetch — the size
    // is still bounded, and a hit on s-1 works (reinstalls).
    await service.tail('s-1', 25)
    expect(service.size).toBe(WINDOW_LIMIT)
  })

  it('head-trims a window past the row cap without losing the event watermark', async () => {
    const { fetcher } = fakeFetcher()
    const service = new ChatWindowService(fetcher)
    // Build a window, then feed WINDOW_ROW_LIMIT+10 distinct live messages.
    await service.tail('s-1', 1)
    for (let index = 0; index < WINDOW_ROW_LIMIT + 10; index++) {
      service.handleEvent('s-1', entry('assistant/message', {
        id: `m-${index}`,
        role: 'assistant',
        content: [{ type: 'text', text: `m${index}` }],
      }, 100 + index).event)
    }
    const page = await service.tail('s-1', 500)
    expect(page.rows.length).toBeLessThanOrEqual(WINDOW_ROW_LIMIT)
    // The watermark survives the head trim: the newest live event is the floor.
    expect(page.maxSeq).toBe(100 + WINDOW_ROW_LIMIT + 9)
    // The newest message is present; the oldest trimmed one is gone.
    expect(page.rows.at(-1)?.text).toBe(`m${WINDOW_ROW_LIMIT + 9}`)
    expect(page.rows.some(row => row.text === 'm0')).toBe(false)
  })

  it('clear() drops every window (test/rotation seam)', async () => {
    const { fetcher, calls } = fakeFetcher()
    const service = new ChatWindowService(fetcher)
    await service.tail('s-1', 25)
    service.clear()
    await service.tail('s-1', 25)
    expect(calls).toHaveLength(2)
    expect(calls[1]?.beforeSeq).toBeUndefined()
  })

  it('a cold tail that throws propagates (the phone falls back itself)', async () => {
    const fetcher: ChatHistoryFetcher = vi.fn(async () => { throw new Error('log read failed') })
    const service = new ChatWindowService(fetcher)
    await expect(service.tail('s-1', 25)).rejects.toThrow('log read failed')
    expect(service.size).toBe(0)
  })
})
