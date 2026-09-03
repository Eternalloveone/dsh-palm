/**
 * PreviewCacheService (v3.1): the tail state machine, lazy-read caching,
 * batch serving, LRU bounds, and mux-frame routing.
 */
import { describe, expect, it, vi } from 'vitest'
import { PREVIEW_CACHE_LIMIT, PreviewCacheService } from './preview-cache.ts'
import type { PreviewHistoryFetcher } from './preview-cache.ts'
import type { WireEvent } from './mobile/messages.ts'

function entry(type: string, data: unknown, time: number): WireEvent {
  return { type, seq: time, time, data }
}

/** A fetcher serving one fixed tail message (e.g. an assistant "已完成"). */
function fetcherWith(events: readonly WireEvent[], calls: string[] = []): PreviewHistoryFetcher {
  return async (sessionId) => {
    calls.push(sessionId)
    return { events: events.map(event => ({ event })) }
  }
}

const tailAssistant = [
  entry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '改一下' }] }, 1),
  entry('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'text-delta', index: 0, text: '正在' } }, 2),
  entry('assistant/message', {
    turn: 0,
    step: 0,
    message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: '已完成修改' }] },
  }, 3),
]

describe('PreviewCacheService', () => {
  it('serves the newest non-empty message summary from one lazy tail read', async () => {
    const calls: string[] = []
    const service = new PreviewCacheService(fetcherWith(tailAssistant, calls))
    const items = await service.previews(['s-1'])
    expect(items).toEqual([{ sessionId: 's-1', summary: '已完成修改', updatedAt: 3 }])
    expect(calls).toEqual(['s-1'])
    // A repeat visit is pure memory: no second read.
    await service.previews(['s-1'])
    expect(calls).toEqual(['s-1'])
  })

  it('batches many sessions in one call, dedupes, and caps the batch', async () => {
    const calls: string[] = []
    const service = new PreviewCacheService(fetcherWith(tailAssistant, calls))
    // Duplicate ids collapse into one read (a row preview needs one answer).
    const items = await service.previews(['s-1', 's-1', 's-2', 's-3'])
    expect(items.map(item => item.sessionId)).toEqual(['s-1', 's-2', 's-3'])
    expect(calls).toEqual(['s-1', 's-2', 's-3'])
    // Order preserved on the second (all-memory) visit.
    const again = await service.previews(['s-3', 's-1'])
    expect(again.map(item => item.sessionId)).toEqual(['s-3', 's-1'])
    expect(calls).toHaveLength(3)
  })

  it('returns an empty summary for a session whose lazy read fails — never an error', async () => {
    const fetcher: PreviewHistoryFetcher = vi.fn(async () => { throw new Error('log read failed') })
    const service = new PreviewCacheService(fetcher)
    await expect(service.previews(['s-dead'])).resolves.toEqual([{ sessionId: 's-dead', summary: '', updatedAt: 0 }])
  })

  it('keeps the summary live through the mux event feed after the lazy read', async () => {
    const service = new PreviewCacheService(fetcherWith(tailAssistant))
    await service.previews(['s-1'])
    // The assistant answers again; the newest message wins.
    service.handleEvent('s-1', entry('assistant/chunk', { turn: 1, step: 0, chunk: { type: 'text-delta', index: 0, text: '第二' } }, 4))
    service.handleEvent('s-1', entry('assistant/message', {
      turn: 1,
      step: 0,
      message: { id: 'a-2', role: 'assistant', content: [{ type: 'text', text: '第二轮回答' }] },
    }, 5))
    const items = await service.previews(['s-1'])
    expect(items[0]?.summary).toBe('第二轮回答')
    expect(items[0]?.updatedAt).toBe(5)
  })

  it('follows streaming chunks into the summary without waiting for the final message', async () => {
    const service = new PreviewCacheService(fetcherWith(tailAssistant))
    await service.previews(['s-1'])
    // Live turn: user asks, then chunks stream (final message not yet sent).
    service.handleEvent('s-1', entry('user/message', { id: 'u-2', role: 'user', content: [{ type: 'text', text: '继续' }] }, 6))
    service.handleEvent('s-1', entry('assistant/chunk', { turn: 2, step: 0, chunk: { type: 'text-delta', index: 0, text: '正在思考' } }, 7))
    service.handleEvent('s-1', entry('assistant/chunk', { turn: 2, step: 0, chunk: { type: 'text-delta', index: 0, text: '…完成' } }, 8))
    const items = await service.previews(['s-1'])
    expect(items[0]?.summary).toBe('正在思考…完成')
    expect(items[0]?.updatedAt).toBe(8)
  })

  it('tracks reasoning-only turns (reasoning is content) and code fences', async () => {
    const service = new PreviewCacheService(fetcherWith([]))
    await service.previews(['s-1']) // empty tail → no summary, no state
    service.handleEvent('s-1', entry('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'reasoning-delta', index: 0, text: '分析中' } }, 1))
    const reasoning = await service.previews(['s-1'])
    expect(reasoning[0]?.summary).toBe('分析中')
    // A fenced code answer collapses to the "[代码] lang" badge.
    service.handleEvent('s-1', entry('assistant/message', {
      turn: 0,
      step: 0,
      message: { id: 'a-3', role: 'assistant', content: [{ type: 'text', text: '```ts\nconst x = 1\n```' }] },
    }, 2))
    const fenced = await service.previews(['s-1'])
    expect(fenced[0]?.summary).toBe('[代码] ts')
  })

  it('updates on command cards (result text) and ignores unrelated events', async () => {
    const service = new PreviewCacheService(fetcherWith(tailAssistant))
    await service.previews(['s-1'])
    service.handleEvent('s-1', entry('todo/write', { todos: [] }, 9))
    service.handleEvent('s-1', entry('turn/start', { turn: 3 }, 10))
    service.handleEvent('s-1', entry('command/run', { commandId: 'c1', name: 'compact', args: '' }, 11))
    // Running cards preview nothing; the settled result does.
    let items = await service.previews(['s-1'])
    expect(items[0]?.summary).toBe('已完成修改')
    service.handleEvent('s-1', entry('command/done', { commandId: 'c1', kind: 'success', text: '压缩完成' }, 12))
    items = await service.previews(['s-1'])
    expect(items[0]?.summary).toBe('压缩完成')
  })

  it('routes host mux frames through onFrame (session/event only)', async () => {
    const service = new PreviewCacheService(fetcherWith(tailAssistant))
    await service.previews(['s-1'])
    service.onFrame({ payload: { type: 'session/event', sessionId: 's-1', event: entry('user/message', { id: 'u-9', role: 'user', content: [{ type: 'text', text: '新提问' }] }, 20) } })
    service.onFrame({ payload: { type: 'session/projection', sessionId: 's-1', key: 'title', value: 'x', seq: 21 } })
    service.onFrame({ payload: { type: 'approval/requested' } })
    const items = await service.previews(['s-1'])
    expect(items[0]?.summary).toBe('新提问')
    expect(service.size).toBe(1)
  })

  it('evicts the least-recently-accessed entry past the cap', async () => {
    const service = new PreviewCacheService(fetcherWith(tailAssistant))
    for (let index = 0; index < PREVIEW_CACHE_LIMIT; index++) {
      await service.previews([`s-${index}`])
    }
    expect(service.size).toBe(PREVIEW_CACHE_LIMIT)
    // Touch s-0 (oldest), add one more: s-1 goes, s-0 survives as memory hit.
    await service.previews(['s-0'])
    await service.previews(['s-new'])
    expect(service.size).toBe(PREVIEW_CACHE_LIMIT)
    const items = await service.previews(['s-1'])
    expect(items[0]?.summary).toBe('已完成修改')
    expect(service.size).toBe(PREVIEW_CACHE_LIMIT)
  })

  it('does not track sessions without a resident entry (lazy read establishes it)', async () => {
    const service = new PreviewCacheService(fetcherWith(tailAssistant))
    // Events for an untracked session are ignored — no entry is minted.
    service.handleEvent('s-cold', entry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: 'x' }] }, 1))
    expect(service.size).toBe(0)
    // The lazy read establishes the entry (and the historical tail wins).
    const items = await service.previews(['s-cold'])
    expect(items[0]?.summary).toBe('已完成修改')
    service.handleEvent('s-cold', entry('user/message', { id: 'u-2', role: 'user', content: [{ type: 'text', text: '新' }] }, 30))
    expect((await service.previews(['s-cold']))[0]?.summary).toBe('新')
  })
})
