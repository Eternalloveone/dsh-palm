/**
 * 助手流翻译：订阅宿主 `agent/assistant-stream` 总线，把流式帧变成持久形状的
 * `assistant/chunk` 事件（分数 seq）投进 mux 广播。
 *
 * 这组测试锁住：翻译形状（分数 seq 落在持久游标与下一条持久事件之间且单调）、
 * 只翻译被观察的会话、游标跟着活会话 seq 走、放弃语义补删除事件、以及生命周期
 * （dispose / 取消观察后不再翻译）。
 */
import { describe, expect, it } from 'vitest'
import { MuxBroadcast } from './api-proxy-mux.ts'
import { SessionObserverRegistry } from './api-proxy-observe.ts'
import { setupAssistantStream } from './api-proxy-stream.ts'
import type { MuxFrame } from './api-proxy-types.ts'

/** 宿主总线替身：捕获 `agent/assistant-stream` 监听器。 */
function fakeCtx() {
  const listeners = new Map<string, (payload: unknown) => void>()
  const options: Array<{ name: string; options: unknown }> = []
  const ctx = {
    on: (name: string, listener: (payload: unknown) => void, opts?: unknown) => {
      listeners.set(name, listener)
      options.push({ name, options: opts })
      return () => { listeners.delete(name) }
    },
  }
  return {
    ctx: ctx as never,
    options,
    registered: (name: string) => listeners.has(name),
    emit: (payload: unknown) => { listeners.get('agent/assistant-stream')?.(payload) },
  }
}

/** 一条总线载荷：`agent.session.seq` 是"下一条"日志偏移。 */
function payload(sessionId: string, nextSeq: number, frame: unknown): unknown {
  return { agent: { session: { id: sessionId, seq: nextSeq } }, frame }
}

function start(attemptId = 'a-1', turn = 2, step = 3): unknown {
  return { type: 'start', attemptId, revision: 1, turn, step }
}

function chunk(index: number, text: string, attemptId = 'a-1'): unknown {
  return { type: 'chunk', attemptId, revision: 2 + index, index, time: 1000 + index, chunk: { type: 'text-delta', text } }
}

function end(outcome: unknown, index = 2, attemptId = 'a-1'): unknown {
  return { type: 'end', attemptId, revision: 10 + index, index, outcome }
}

/** 收集广播帧；广播是同步推入队列的，读之前要 await settle()。 */
function collector(broadcast: MuxBroadcast) {
  const frames: MuxFrame[] = []
  const controller = new AbortController()
  const pump = (async () => {
    for await (const frame of broadcast.subscribe(controller.signal)) frames.push(frame.payload)
  })()
  return {
    frames,
    events: () => frames
      .filter((frame): frame is Extract<MuxFrame, { type: 'session/event' }> => frame.type === 'session/event')
      .map(frame => frame.event as unknown as { type: string; seq: number; time: number; data: Record<string, unknown> }),
    async settle() { await new Promise(resolve => setTimeout(resolve, 0)) },
    async stop() { controller.abort(); await pump },
  }
}

/** 一套接好线的装置。 */
function setup() {
  const bus = fakeCtx()
  const broadcast = new MuxBroadcast()
  const sink = collector(broadcast)
  const observers = new SessionObserverRegistry()
  const lifetime = new AbortController()
  const dispose = setupAssistantStream({ ctx: bus.ctx, broadcast, observers, signal: lifetime.signal })
  return { bus, observers, sink, lifetime, dispose }
}

/** 事件里透传的 chunk 文本。 */
function chunkTexts(events: Array<{ data: Record<string, unknown> }>): string[] {
  return events.map(event => (event.data as { chunk: { text: string } }).chunk.text)
}

describe('setupAssistantStream', () => {
  it('subscribes the host bus globally and translates chunks with fractional seqs', async () => {
    const { bus, observers, sink, dispose } = setup()
    expect(bus.registered('agent/assistant-stream')).toBe(true)
    expect(bus.options[0]).toEqual({ name: 'agent/assistant-stream', options: { global: true } })

    observers.observe('dev-1', 's-1')
    bus.emit(payload('s-1', 6, start()))
    bus.emit(payload('s-1', 6, chunk(0, '你')))
    bus.emit(payload('s-1', 6, chunk(1, '好')))

    await sink.settle()
    const events = sink.events()
    expect(events.map(event => event.type)).toEqual(['assistant/chunk', 'assistant/chunk'])
    // (turn, step) 来自 start 帧，chunk 原样透传。
    expect(events.map(event => [(event.data as { turn: number }).turn, (event.data as { step: number }).step]))
      .toEqual([[2, 3], [2, 3]])
    expect(chunkTexts(events)).toEqual(['你', '好'])
    expect(events.map(event => event.time)).toEqual([1000, 1001])
    // 分数 seq：落在持久游标 5（nextSeq 6 - 1）与下一条持久事件 6 之间，且单调递增。
    expect(events[0]?.seq).toBe(5.5)
    expect(events[1]?.seq).toBe(5 + 2 / 3)
    expect(events.every(event => event.seq > 5 && event.seq < 6)).toBe(true)
    dispose()
    await sink.stop()
  })

  it('only translates sessions the phone has open', async () => {
    const { bus, observers, sink, dispose } = setup()
    bus.emit(payload('s-other', 3, start()))
    bus.emit(payload('s-other', 3, chunk(0, '别人的')))
    await sink.settle()
    expect(sink.frames).toHaveLength(0)

    observers.observe('dev-1', 's-other')
    bus.emit(payload('s-other', 3, start()))
    bus.emit(payload('s-other', 3, chunk(0, '我的')))
    await sink.settle()
    expect(chunkTexts(sink.events())).toEqual(['我的'])
    dispose()
    await sink.stop()
  })

  it('follows the live session cursor so seqs stay inside the current gap', async () => {
    const { bus, observers, sink, dispose } = setup()
    observers.observe('dev-1', 's-1')
    bus.emit(payload('s-1', 6, start()))
    bus.emit(payload('s-1', 6, chunk(0, '前半')))
    // 一条持久事件落库：nextSeq 前移，锚点跟着走。
    bus.emit(payload('s-1', 7, chunk(1, '后半')))
    await sink.settle()
    const events = sink.events()
    expect(events.map(event => event.seq)).toEqual([5.5, 6 + 2 / 3])
    expect(events[1]?.seq).toBeLessThan(7)
    dispose()
    await sink.stop()
  })

  it('deletes the pending row when the attempt is abandoned', async () => {
    const { bus, observers, sink, dispose } = setup()
    observers.observe('dev-1', 's-1')
    bus.emit(payload('s-1', 6, start()))
    bus.emit(payload('s-1', 6, chunk(0, '重试前的半截')))
    bus.emit(payload('s-1', 6, chunk(1, '文本')))
    bus.emit(payload('s-1', 6, end({ kind: 'abandoned' })))
    await sink.settle()

    const events = sink.events()
    expect(events.map(event => event.type)).toEqual(['assistant/chunk', 'assistant/chunk', 'message/delete'])
    const deletion = events[2]
    const lastChunk = events[1]
    // 删除事件必须严格高于最后一个 chunk（fold 的水位闸门），且仍在下一条持久事件前。
    expect(deletion?.seq).toBeGreaterThan(lastChunk?.seq ?? 0)
    expect(deletion?.seq).toBeLessThan(6)
    // 它指向的正是那条待定行（按 seq 定位）。
    expect(deletion?.data).toEqual({ seq: lastChunk?.seq })
    dispose()
    await sink.stop()
  })

  it('emits nothing extra when the attempt commits (the durable event settles it)', async () => {
    const { bus, observers, sink, dispose } = setup()
    observers.observe('dev-1', 's-1')
    bus.emit(payload('s-1', 6, start()))
    bus.emit(payload('s-1', 6, chunk(0, '完成')))
    bus.emit(payload('s-1', 6, end({ kind: 'committed', eventType: 'assistant/message', seq: 6 })))
    await sink.settle()
    expect(sink.events().map(event => event.type)).toEqual(['assistant/chunk'])
    dispose()
    await sink.stop()
  })

  it('ignores chunks whose attempt never started, and drops state when unobserved', async () => {
    const { bus, observers, sink, dispose } = setup()
    observers.observe('dev-1', 's-1')
    // 孤儿 chunk：没有 start 帧。
    bus.emit(payload('s-1', 6, chunk(0, '孤儿')))
    await sink.settle()
    expect(sink.frames).toHaveLength(0)

    bus.emit(payload('s-1', 6, start()))
    bus.emit(payload('s-1', 6, chunk(0, '正常')))
    await sink.settle()
    expect(sink.events()).toHaveLength(1)

    // 离开会话再回来：半截的尝试状态已丢弃，没有新的 start 就不会继续翻译。
    observers.observe('dev-1', undefined)
    observers.observe('dev-1', 's-1')
    bus.emit(payload('s-1', 6, chunk(1, '不该出现')))
    await sink.settle()
    expect(sink.events()).toHaveLength(1)
    dispose()
    await sink.stop()
  })

  it('stops translating after dispose', async () => {
    const { bus, observers, sink, dispose } = setup()
    observers.observe('dev-1', 's-1')
    bus.emit(payload('s-1', 6, start()))
    dispose()
    bus.emit(payload('s-1', 6, chunk(0, '已停止')))
    await sink.settle()
    expect(sink.frames).toHaveLength(0)
    await sink.stop()
  })

  it('degrades to no streaming when the host bus is unavailable', () => {
    const ctx = { on: () => { throw new Error('no such event') } } as never
    const broadcast = new MuxBroadcast()
    const observers = new SessionObserverRegistry()
    expect(() => setupAssistantStream({ ctx, broadcast, observers, signal: new AbortController().signal })).not.toThrow()
  })
})
