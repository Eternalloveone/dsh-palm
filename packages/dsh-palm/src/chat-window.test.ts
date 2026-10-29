/**
 * ChatWindowService (v3 folded-view window cache): cold tail install, window
 * hits that never touch the fetcher, live event/projection feeding, older
 * page prepend, bounds (LRU + row cap), and the mux-frame router.
 */
import { describe, expect, it, vi } from 'vitest'
import { ChatWindowService, TURN_ANCHOR_PEEK_MESSAGES, withLogTurnBoundaries, WINDOW_LIMIT, WINDOW_REVALIDATE_MS, WINDOW_ROW_LIMIT } from './chat-window.ts'
import type { ChatHistoryFetcher, ChatHistoryPage } from './chat-window.ts'
import { EventFolder } from './mobile/messages.ts'
import type { SessionProjectionsBlock } from './api-proxy-types'
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
    // A real log always opens a turn with its own turn/start. The window service
    // peeks behind the page for exactly this event when a page cut removed it, so
    // a fixture without it would make every cold install read twice.
    entry('turn/start', { turn: 0 }, base - 1),
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
function fakeFetcher(pages: Array<{
  beforeSeq?: number
  hasMore: boolean
  projections?: SessionProjectionsBlock
  /** Override the served events (default: a plain turn). */
  events?: Array<{ event: WireEvent; view?: unknown }>
}> = []) {
  const calls: Array<{ sessionId: string; beforeSeq: number | undefined; maxMessages: number }> = []
  /** The `fresh` flag of every call, recorded separately so `calls` keeps its
   *  exact-equality shape for the older assertions. */
  const freshFlags: boolean[] = []
  const fetcher: ChatHistoryFetcher = async (sessionId, beforeSeq, maxMessages, fresh) => {
    calls.push({ sessionId, beforeSeq, maxMessages })
    freshFlags.push(fresh === true)
    const page = pages.shift() ?? { hasMore: false }
    return {
      events: page.events ?? turnEvents(),
      hasMore: page.hasMore,
      ...(page.projections === undefined ? {} : { projections: page.projections }),
    }
  }
  return { fetcher, calls, freshFlags }
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
  it('gives a finished turn its elapsed time when its turn/start sits outside the window', async () => {
    // A page is cut at a message boundary, so the turn/start of the turn that
    // owns the first message usually falls just outside it. turn/end carries
    // only the turn number, so without that anchor the fold cannot compute a
    // duration and the process head settles on a bare 已完成 — a finished turn
    // that reports no elapsed time. The install reads one page further back for
    // the anchor and prepends it.
    const { fetcher, calls } = fakeFetcher([
      {
        hasMore: true,
        events: [
          entry('user/message', { id: 'u-9', role: 'user', content: [{ type: 'text', text: '改一下' }] }, 10),
          entry('assistant/message', {
            turn: 4,
            step: 0,
            message: { id: 'a-9', role: 'assistant', content: [{ type: 'text', text: '已完成' }] },
          }, 11),
          entry('turn/end', { turn: 4, reason: { kind: 'completed' } }, 12),
        ],
      },
      // The peek behind the window: the anchor this turn never carried.
      { beforeSeq: 10, hasMore: true, events: [entry('turn/start', { turn: 4 }, 9)] },
    ])
    const service = new ChatWindowService(fetcher)

    const page = await service.tail('s-1', 10)
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual({ sessionId: 's-1', beforeSeq: 10, maxMessages: TURN_ANCHOR_PEEK_MESSAGES })

    const assistant = page.rows.find(row => row.kind === 'assistant')
    // turn/end at 12000ms, the recovered turn/start at 9000ms.
    expect(assistant?.turnStartAt).toBe(9_000)
    expect(assistant?.durationMs).toBe(3_000)
    // The anchor is a clock only: it must not add a row of its own.
    expect(page.rows.length).toBe(2)
  })

  it('anchors a turn that is still running, so its time survives the end frame', async () => {
    // The real sequence behind "会话结束后，过程框还是没有已用时": the window is
    // installed while the turn is still running, the window is then cached, and
    // the turn/end arrives later. If the anchor was skipped at install time (on
    // the grounds that a running turn needs no clock), it is out of reach by the
    // time the end lands and the finished turn never reports its elapsed time.
    const { fetcher, calls } = fakeFetcher([
      {
        hasMore: true,
        events: [
          // No turn/end: this turn has not finished yet.
          entry('assistant/message', {
            turn: 4,
            step: 0,
            message: { id: 'a-9', role: 'assistant', content: [{ type: 'text', text: '处理中' }] },
          }, 11),
        ],
      },
      { beforeSeq: 11, hasMore: true, events: [entry('turn/start', { turn: 4 }, 9)] },
    ])
    const service = new ChatWindowService(fetcher)

    const page = await service.tail('s-1', 10)
    // 第一次补读是「把页首对齐到回合开头」（用页自己的 maxRows）：这一页只有一条
    // assistant/message，切点落在一轮中间，补读到 turn/start 才算一整轮。补齐之后
    // 回合锚点已经在页里，边界 peek 不必再读一次 —— 少读一次，也少一个「半截回合」。
    expect(calls).toHaveLength(2)
    expect(calls[1]?.beforeSeq).toBe(11)
    expect(calls[1]?.maxMessages).toBe(10)
    const assistant = page.rows.find(row => row.kind === 'assistant')
    // A running turn has no stamped clock yet: it ticks from the live clock.
    expect(assistant?.turnStartAt).toBeUndefined()
    expect(assistant?.durationMs).toBeUndefined()

    // The turn now ends. The anchor recovered at install time is what lets the
    // fold compute the duration — without it this row keeps a blank clock.
    service.handleEvent('s-1', entry('turn/end', { turn: 4, reason: { kind: 'completed' } }, 12).event)
    const settled = await service.tail('s-1', 10)
    const finished = settled.rows.find(row => row.kind === 'assistant')
    expect(finished?.turnStartAt).toBe(9_000)
    expect(finished?.durationMs).toBe(3_000)
  })

  it('reads one page further back when the cut lands inside a turn', async () => {
    // 页是按条数切的：切点落在一轮中间时，折出来的第一行只是「半截回合」——只有后半段
    // 步骤。手机上那张卡会少画前面几步，而搜索索引按这一页建文档，就会收到一段屏幕上
    // 不存在的正文（真机：命中 seq=1165，落地的卡只画到 1136，一个高亮都没有、点十次
    // 有一次是空的）。页首要对齐到回合开头：往前补读到 turn/start 为止。
    const { fetcher, calls } = fakeFetcher([
      {
        hasMore: true,
        events: [
          entry('assistant/message', {
            turn: 3,
            step: 2,
            message: { id: 'a-late', role: 'assistant', content: [{ type: 'text', text: '第二段的正文' }] },
          }, 21),
        ],
      },
      {
        beforeSeq: 21,
        hasMore: true,
        events: [
          entry('turn/start', { turn: 3 }, 18),
          entry('user/message', { id: 'u-3', role: 'user', content: [{ type: 'text', text: '继续' }] }, 19),
          entry('assistant/message', {
            turn: 3,
            step: 1,
            message: { id: 'a-early', role: 'assistant', content: [{ type: 'text', text: '第一段的正文' }] },
          }, 20),
        ],
      },
    ])
    const service = new ChatWindowService(fetcher)
    const page = await service.tail('s-1', 10)
    expect(calls).toHaveLength(2)
    expect(calls[1]?.beforeSeq).toBe(21)
    expect(calls[1]?.maxMessages).toBe(10)
    // 补齐之后页首是一整轮：这一页的「第一行」不再是某轮的后半截。
    expect(page.rows[0]?.kind).toBe('user')
    const texts = page.rows.map(row => row.text).join('\n')
    expect(texts).toContain('第一段的正文')
    expect(texts).toContain('第二段的正文')
  })

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
    // 第二页必须是**另一页**：同一条消息只属于一个位置（旧夹具两页回同样的
    // 事件，那是"把同一页读两遍"，不是翻页）。seq 必须为正：0 是"已应用"的水位线。
    const { fetcher, calls } = fakeFetcher([{ hasMore: true, events: turnEvents(2) }, { hasMore: false, events: turnEvents(1) }])
    const service = new ChatWindowService(fetcher)
    await service.tail('s-1', 25)

    const older = await service.before('s-1', 0, 25)
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual({ sessionId: 's-1', beforeSeq: 0, maxMessages: 25 })
    expect(older.hasMore).toBe(false)
    // The window now spans two pages; the tail still serves the newest slice.
    const page = await service.tail('s-1', 25)
    expect(page.rows.length).toBe(4)
    expect(page.maxSeq).toBe(204)
    // No fetcher call for the hit after the page read.
    expect(calls).toHaveLength(2)
  })

  it('never shows the same answer twice when an older page repeats the cut message', async () => {
    // 宿主按消息切页，跨切口的那条消息两页都有。窗口里那份已被 turn/end 改写过
    //（时间戳＝收工时刻、带用时），拼进来那份还是切口前的原样（没有用时）。不去重
    // 就会同一条回答出现两次、其中一次没有秒表——实测某会话 118 行里 37 个 id 各两份。
    const shared = entry('assistant/message', {
      turn: 0,
      step: 0,
      message: { id: 'a-shared', role: 'assistant', content: [{ type: 'text', text: '同一句回答' }] },
    }, 2)
    const { fetcher } = fakeFetcher([
      { hasMore: true, events: [entry('turn/start', { turn: 0 }, 0), shared, entry('turn/end', { turn: 0, reason: { kind: 'completed' } }, 5)] },
      // 切口之前那一页：同一条 assistant 消息（同一个 id），但没有它的 turn/end。
      { hasMore: false, events: [entry('user/message', { id: 'u-0', role: 'user', content: [{ type: 'text', text: '问一句' }] }, 1), shared] },
    ])
    const service = new ChatWindowService(fetcher as never)
    await service.tail('s-1', 25)
    await service.before('s-1', 1, 25)
    const page = await service.tail('s-1', 25)

    const ids = page.rows.map(row => row.id)
    expect(new Set(ids).size).toBe(ids.length)
    // 留下来的必须是已被 turn/end 改写过的那份：它带用时。
    const answer = page.rows.find(row => row.id === 'a-shared')
    expect(answer?.durationMs).toBeGreaterThan(0)
  })

  it('gives rows from an older page the turn end they were cut off from', async () => {
    // 用户往上翻页时，宿主按消息切出来的那一页里没有这一轮的 turn/end。那些行于是停在
    // 每一步自己的时间戳上、也没有用时——同一轮里后一半行有、前一半没有（实测 turn 370：
    // 49 行里 24 行有）。收工时刻折叠时记下了，补页时按它补齐。
    const early = entry('assistant/message', {
      turn: 0,
      step: 0,
      message: { id: 'a-early', role: 'assistant', content: [{ type: 'text', text: '早先那步' }] },
    }, 2)
    const late = entry('assistant/message', {
      turn: 0,
      step: 1,
      message: { id: 'a-late', role: 'assistant', content: [{ type: 'text', text: '后来那步' }] },
    }, 6)
    const { fetcher } = fakeFetcher([
      // 尾页：包含 turn/start 与 turn/end，只有"后来那步"。
      { hasMore: true, events: [entry('turn/start', { turn: 0 }, 0), late, entry('turn/end', { turn: 0, reason: { kind: 'completed' } }, 8)] },
      // 早先那一页：只有"早先那步"，它的 turn/end 在切口之后。
      { hasMore: false, events: [early] },
    ])
    const service = new ChatWindowService(fetcher as never)
    await service.tail('s-1', 25)
    await service.before('s-1', 2, 25)
    const page = await service.tail('s-1', 25)

    const prefixed = page.rows.find(row => row.id === 'a-early')
    expect(prefixed?.durationMs).toBeGreaterThan(0)
    expect(prefixed?.time).toBe(8_000)
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

  it('seeds the window todo through the projection fold: an in_progress leftover after turn/end reads completed', async () => {
    const { fetcher } = fakeFetcher([{
      hasMore: false,
      events: [
        entry('todo/write', { todos: [{ content: '文档批次', status: 'in_progress' }, { content: '其余', status: 'completed' }] }, 11),
        entry('assistant/message', { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: '提交完成' }] }, 12),
        entry('turn/end', { turn: 0, reason: { kind: 'completed' } }, 13),
      ],
    }])
    const service = new ChatWindowService(fetcher)
    const page = await service.tail('s-1', 25)
    expect(page.todo).toEqual({
      seq: 11,
      items: [
        { content: '文档批次', status: 'completed' },
        { content: '其余', status: 'completed' },
      ],
    })
  })

  it('seeds no todo when the window opened with a later turn/start and no new write (no stale resurrection)', async () => {
    const { fetcher } = fakeFetcher([{
      hasMore: false,
      events: [
        entry('todo/write', { todos: [{ content: '上一轮', status: 'in_progress' }] }, 11),
        entry('turn/end', { turn: 0, reason: { kind: 'completed' } }, 12),
        entry('turn/start', {}, 13),
      ],
    }])
    const service = new ChatWindowService(fetcher)
    const page = await service.tail('s-1', 25)
    expect(page.todo).toBeUndefined()
  })

  it('live turn/end normalizes the window todo (in_progress → completed)', async () => {
    const { fetcher } = fakeFetcher()
    const service = new ChatWindowService(fetcher)
    await service.tail('s-1', 25)

    service.handleEvent('s-1', entry('todo/write', { todos: [{ content: '任务一', status: 'in_progress' }] }, 11).event)
    expect((await service.tail('s-1', 25)).todo).toEqual({ seq: 11, items: [{ content: '任务一', status: 'in_progress' }] })

    service.handleEvent('s-1', entry('turn/end', { turn: 0, reason: { kind: 'completed' } }, 12).event)
    expect((await service.tail('s-1', 25)).todo).toEqual({ seq: 11, items: [{ content: '任务一', status: 'completed' }] })
  })

  it('live turn/start clears the window todo (host projection mirror)', async () => {
    const { fetcher } = fakeFetcher()
    const service = new ChatWindowService(fetcher)
    await service.tail('s-1', 25)

    service.handleEvent('s-1', entry('todo/write', { todos: [{ content: '任务一', status: 'completed' }] }, 11).event)
    expect((await service.tail('s-1', 25)).todo).toEqual({ seq: 11, items: [{ content: '任务一', status: 'completed' }] })

    service.handleEvent('s-1', entry('turn/start', {}, 12).event)
    expect((await service.tail('s-1', 25)).todo).toBeUndefined()
  })

  // ── Read-time revalidation (the push feed is the fast path, not the truth) ──

  it('reads the log fresh on a cold install (the install page cannot be cursor-capped)', async () => {
    const { fetcher, freshFlags } = fakeFetcher([{ hasMore: false }])
    const service = new ChatWindowService(fetcher)
    await service.tail('s-1', 25)
    expect(freshFlags).toEqual([true])
  })

  it('catches a silent window up from the log once past the revalidation window', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_700_000_000_000)
      // Cold install leaves the window holding seqs 0..4. The feed then dies —
      // nothing ever calls handleEvent again — while the log grows to 100..104.
      const { fetcher, calls, freshFlags } = fakeFetcher([
        { hasMore: false },
        { hasMore: false, events: turnEvents(1) },
      ])
      const service = new ChatWindowService(fetcher)
      const cold = await service.tail('s-1', 25)
      expect(cold.rows.map(row => row.seq)).toEqual([0, 4])

      // Inside the window a read is still served from memory: zero log reads.
      vi.setSystemTime(1_700_000_000_000 + WINDOW_REVALIDATE_MS - 1)
      await service.tail('s-1', 25)
      expect(calls).toHaveLength(1)

      // Past it the read heals itself: the hole (5..99 is missing from the
      // fresh page) rebuilds the window from that page rather than folding it.
      vi.setSystemTime(1_700_000_000_000 + WINDOW_REVALIDATE_MS)
      const healed = await service.tail('s-1', 25)
      expect(calls).toHaveLength(2)
      expect(freshFlags).toEqual([true, true])
      expect(healed.rows.map(row => row.seq)).toEqual([100, 104])
      expect(healed.maxSeq).toBe(104)
    } finally {
      vi.useRealTimers()
    }
  })

  it('folds a continuing fresh page instead of rebuilding it (older rows survive)', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_700_000_000_000)
      const { fetcher } = fakeFetcher([
        { hasMore: false },
        {
          hasMore: false,
          events: [
            entry('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'text-delta', index: 0, text: '继续' } }, 5),
            entry('assistant/message', {
              turn: 0,
              step: 0,
              message: { id: 'a-2', role: 'assistant', content: [{ type: 'text', text: '新一段' }] },
            }, 6),
          ],
        },
      ])
      const service = new ChatWindowService(fetcher)
      await service.tail('s-1', 25)

      vi.setSystemTime(1_700_000_000_000 + WINDOW_REVALIDATE_MS)
      const page = await service.tail('s-1', 25)
      // The window continues (5 sits directly above the watermark) — the fold
      // path, not the rebuild path: the older user row is still there, so the
      // page carries three rows rather than the fresh page's two.
      expect(page.rows.map(row => row.seq)).toEqual([0, 5, 6])
      expect(page.maxSeq).toBe(6)
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves a good window intact when the revalidation read fails', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_700_000_000_000)
      let failing = false
      const fetcher: ChatHistoryFetcher = async () => {
        if (failing) throw new Error('log read failed')
        return { events: turnEvents(), hasMore: false }
      }
      const service = new ChatWindowService(fetcher)
      await service.tail('s-1', 25)

      failing = true
      vi.setSystemTime(1_700_000_000_000 + WINDOW_REVALIDATE_MS)
      const page = await service.tail('s-1', 25)
      expect(page.rows.map(row => row.seq)).toEqual([0, 4])
      expect(page.maxSeq).toBe(4)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('withLogTurnBoundaries: 把日志尾部的轮次边界并进历史页', () => {
  /** A message-paged history page: messages only, no turn boundaries. */
  const pageWithoutBoundaries = (): ChatHistoryPage => ({
    events: [
      { event: { type: 'assistant/message', seq: 30, time: 30_000, data: { turn: 7, step: 0, message: { id: 'a-7', role: 'assistant', content: [{ type: 'text', text: '完成' }] } } } },
    ],
    hasMore: true,
  })

  it('merges the turn/start and turn/end the message page cannot carry', async () => {
    // session.history 按消息分页，turn/end 不是消息，于是页里没有它——而时长
    // 只能由 turn/end 减锚点算出。边界从日志尾部取回来补上，这一轮才有用时。
    const inner = vi.fn(async () => pageWithoutBoundaries())
    const readTail = vi.fn(async () => ({
      lines: [
        { event: { type: 'turn/start', seq: 10, time: 10_000, data: { turn: 7 } } },
        { event: { type: 'turn/end', seq: 31, time: 31_000, data: { turn: 7, reason: { kind: 'completed' } } } },
        { event: { type: 'assistant/chunk', seq: 20, time: 20_000, data: { turn: 7, step: 0, chunk: { type: 'text-delta', index: 0, text: 'x' } } } },
      ],
    }))
    const fetcher = withLogTurnBoundaries(inner as never, readTail as never)
    const page = await fetcher('s-1', undefined, 40, true)
    // Only boundaries ride along; the chunk stays behind with the page's own rows.
    expect(page.events.map(entry => entry.event.type).sort()).toEqual(['assistant/message', 'turn/end', 'turn/start'])
    const folder = new EventFolder()
    folder.fold(page.events.map(entry => entry.event))
    expect(folder.snapshot().find(row => row.kind === 'assistant')?.durationMs).toBe(21_000)
  })

  it('does not duplicate a boundary the page already has', async () => {
    const inner = vi.fn(async () => ({
      events: [
        { event: { type: 'turn/start', seq: 10, time: 10_000, data: { turn: 7 } } },
        ...pageWithoutBoundaries().events,
      ],
      hasMore: true,
    }))
    const readTail = vi.fn(async () => ({
      lines: [{ event: { type: 'turn/start', seq: 10, time: 10_000, data: { turn: 7 } } }],
    }))
    const fetcher = withLogTurnBoundaries(inner as never, readTail as never)
    const page = await fetcher('s-1', undefined, 40, true)
    expect(page.events.filter(entry => entry.event.type === 'turn/start')).toHaveLength(1)
  })

  it('never costs the page when the tail read fails', async () => {
    const inner = vi.fn(async () => pageWithoutBoundaries())
    const fetcher = withLogTurnBoundaries(inner as never, (async () => { throw new Error('nope') }) as never)
    await expect(fetcher('s-1', undefined, 40, true)).resolves.toEqual(pageWithoutBoundaries())
  })

  it('leaves older pages untouched (they extend history upwards)', async () => {
    const inner = vi.fn(async () => pageWithoutBoundaries())
    const readTail = vi.fn(async () => ({ lines: [] }))
    const fetcher = withLogTurnBoundaries(inner as never, readTail as never)
    await fetcher('s-1', 30, 40, false)
    expect(readTail).not.toHaveBeenCalled()
  })
})

describe('withLogTurnBoundaries: 合并后的顺序（决定"这一轮有没有锚点"）', () => {
  it('sorts the merged boundaries by seq so an OPEN turn still reports its start', async () => {
    // 回归：把边界直接拼到页面前面，lastOpenTurnStartTime 从数组尾部往前扫，
    // 会先撞上排在 turn/start 之后的 turn/end，于是把一个**正开着**的回合判成
    // 没有锚点。手机上的表现就是"一进会话，用时从 0 开始数"。
    const inner = vi.fn(async () => ({
      events: [
        { event: { type: 'turn/end', seq: 18, time: 18_000, data: { turn: 6, reason: { kind: 'completed' } } } },
        { event: { type: 'assistant/chunk', seq: 21, time: 21_000, data: { turn: 7, step: 0, chunk: { type: 'text-delta', index: 0, text: 'x' } } } },
        { event: { type: 'assistant/chunk', seq: 22, time: 22_000, data: { turn: 7, step: 0, chunk: { type: 'text-delta', index: 0, text: 'y' } } } },
      ],
      hasMore: true,
    }))
    // 补进来的边界比页面里的新——这才是真实情形：页面按消息切，切口之后的边界
    // 只有日志尾部有。直接拼到前面就成了 [20, 18, 21, 22]，从尾部往前扫会先撞上
    // 18 那条 turn/end，于是正开着的一轮被判成"已收工"，锚点丢了、秒表从 0 数。
    const fetchTail = vi.fn(async () => ({
      lines: [
        { event: { type: 'turn/start', seq: 20, time: 20_000, data: { turn: 7 } } },
      ],
    }))
    const fetcher = withLogTurnBoundaries(inner as never, fetchTail as never)
    const page = await fetcher('s-1', undefined, 40, true)
    // 顺序必须是 seq 升序：位置判据依赖它。
    const seqs = page.events.map(entry => entry.event.seq)
    expect(seqs).toEqual([...seqs].sort((a, b) => (a as number) - (b as number)))
    // 最后一条边界是 turn/start(seq 20) ⇒ 这一轮开着，锚点就是它。
    const service = new ChatWindowService((async () => page) as never)
    expect((await service.tail('s-2', 40)).turnStartAt).toBe(20_000)
  })

  it('reports the newest event time so a silent turn can be told from a live one', async () => {
    // 手机上「边界开着但日志早就静了」这条判据全靠它：漏掉的 turn/end 不会重放，
    // 页面上没有这个时间就只能一直画「运行中」。
    const { fetcher } = fakeFetcher([
      {
        hasMore: true,
        events: [
          entry('turn/start', { turn: 4 }, 9),
          entry('assistant/message', {
            turn: 4,
            step: 0,
            message: { id: 'a-9', role: 'assistant', content: [{ type: 'text', text: '处理中' }] },
          }, 11),
        ],
      },
    ])
    const service = new ChatWindowService(fetcher)
    expect((await service.tail('s-1', 10)).lastEventAt).toBe(11_000)
    // 之后的帧把时间往前推（而不是停在安装那一刻）。
    service.handleEvent('s-1', entry('assistant/message', {
      turn: 4,
      step: 1,
      message: { id: 'a-10', role: 'assistant', content: [{ type: 'text', text: '还在跑' }] },
    }, 20).event)
    expect((await service.tail('s-1', 10)).lastEventAt).toBe(20_000)
  })
})
