/**
 * MuxBroadcast 的源接线。
 *
 * 0.1.5 把旧的聚合 `events.mux` 拆成 `session.control` + 应答式 waterfall，
 * 适配期一度把 `session/event` 整个丢掉——于是宿主侧的消费者（chat-window、
 * preview-cache、notify）永远收不到实时事件：窗口装一次就再也没活水，在进程
 * 生命周期内永久冻结（手机端表现为"丢消息/不跟桌面同步"）。
 *
 * 这组测试锁住修复后的接线：宿主总线 `session/event` 在 setup 时**一次性**
 * 注册（覆盖所有会话，不留"订阅开始"空窗），并原样转发成带 sessionId 的 mux 帧。
 */
import { describe, expect, it } from 'vitest'
import { MuxBroadcast, setupMuxSources } from './api-proxy-mux.ts'
import type { MuxFrame } from './api-proxy-types.ts'

/** A fake host Context recording every registered listener and its options. */
function fakeCtx() {
  const listeners = new Map<string, (first: unknown, second: unknown) => void>()
  const options: Array<{ name: string; options: unknown }> = []
  const ctx = {
    on: (name: string, listener: (first: unknown, second: unknown) => void, opts?: unknown) => {
      listeners.set(name, listener)
      options.push({ name, options: opts })
      return () => { listeners.delete(name) }
    },
  }
  return {
    ctx: ctx as never,
    options,
    registered: (name: string) => listeners.has(name),
    emit: (name: string, first?: unknown, second?: unknown) => { listeners.get(name)?.(first, second) },
  }
}

/** A control stream that never yields: these tests drive the event bus only. */
function idleSession() {
  return { control: () => (async function* () { /* stays open until aborted */ })() } as never
}

/** One control baseline frame, for the control-side regression check. */
function baselineSession() {
  const frame = {
    type: 'baseline',
    value: {
      queues: { 's-1': [] },
      jobs: { 's-1': [] },
      projections: { 's-1': { asOfSeq: 4, values: { title: '标题' } } },
    },
  }
  return { control: () => (async function* () { yield frame })() } as never
}

/** Subscribe and collect frames until the returned stop() runs. */
function collector(broadcast: MuxBroadcast, accept?: (frame: MuxFrame) => boolean) {
  const frames: MuxFrame[] = []
  const signal = new AbortController()
  const pump = (async () => {
    for await (const frame of broadcast.subscribe(signal.signal, accept)) frames.push(frame.payload)
  })()
  return {
    frames,
    async settle() { await new Promise(resolve => setTimeout(resolve, 0)) },
    async stop() { signal.abort(); await pump },
  }
}

describe('setupMuxSources', () => {
  it('forwards host session/event frames to every subscriber, tagged with the session', async () => {
    const { ctx, emit, registered, options } = fakeCtx()
    const broadcast = new MuxBroadcast()
    const sink = collector(broadcast)
    const dispose = setupMuxSources(ctx, idleSession(), broadcast, new AbortController().signal)

    expect(registered('session/event')).toBe(true)
    // Global scope: the bus publishes from the session's own fiber, not this plugin's.
    expect(options[0]).toEqual({ name: 'session/event', options: { global: true } })

    const event = { type: 'assistant/message', seq: 7, time: 1, data: {} }
    emit('session/event', { id: 's-1' }, event)
    await sink.settle()
    expect(sink.frames).toEqual([{ type: 'session/event', sessionId: 's-1', event }])

    // Malformed bus payloads never reach the wire.
    emit('session/event', {}, event)
    emit('session/event', { id: 's-1' }, null)
    await sink.settle()
    expect(sink.frames).toHaveLength(1)

    dispose()
    emit('session/event', { id: 's-1' }, event)
    await sink.settle()
    expect(sink.frames).toHaveLength(1)
    await sink.stop()
  })

  it('keeps the control wiring it had before (queue/jobs/projection frames)', async () => {
    const { ctx } = fakeCtx()
    const broadcast = new MuxBroadcast()
    const sink = collector(broadcast)
    setupMuxSources(ctx, baselineSession(), broadcast, new AbortController().signal)

    await sink.settle()
    expect(sink.frames).toEqual([
      { type: 'session/queue', sessionId: 's-1', items: [] },
      { type: 'session/jobs', sessionId: 's-1', jobs: [] },
      { type: 'session/projection', sessionId: 's-1', key: 'title', value: '标题', seq: 4 },
    ])
    await sink.stop()
  })

  it('mirrors the host session-list events as mux frames', async () => {
    const { ctx, emit, registered } = fakeCtx()
    const broadcast = new MuxBroadcast()
    const sink = collector(broadcast)
    const dispose = setupMuxSources(ctx, idleSession(), broadcast, new AbortController().signal)

    // The five events the desktop client consumes (session-controller
    // client/index.ts:102-110) — the phone's roster rides the same ones.
    for (const name of ['api-session/added', 'api-session/removed', 'api-session/status', 'api-session/activity', 'api-session/error']) {
      expect(registered(name)).toBe(true)
    }

    const summary = { sessionId: 's-1', updatedAt: 5, running: false, blank: true, cwd: 'D:\\work' }
    emit('api-session/added', summary)
    emit('api-session/status', 's-1', true)
    emit('api-session/activity', 's-1', 9)
    emit('api-session/error', 's-1', 'boom')
    emit('api-session/removed', 's-1')
    await sink.settle()
    expect(sink.frames).toEqual([
      { type: 'session/added', summary },
      { type: 'session/status', sessionId: 's-1', running: true },
      { type: 'session/activity', sessionId: 's-1', updatedAt: 9 },
      { type: 'session/error', sessionId: 's-1', message: 'boom' },
      { type: 'session/removed', sessionId: 's-1' },
    ])

    // Malformed bus payloads never reach the wire.
    emit('api-session/added', null)
    emit('api-session/status', '', true)
    emit('api-session/status', 's-1', 'yes')
    emit('api-session/activity', 's-1', Number.NaN)
    emit('api-session/error', 's-1', 7)
    emit('api-session/removed', undefined)
    await sink.settle()
    expect(sink.frames).toHaveLength(5)

    dispose()
    emit('api-session/status', 's-1', true)
    await sink.settle()
    expect(sink.frames).toHaveLength(5)
    await sink.stop()
  })

  it('delivers only the frames a subscriber filter accepts', async () => {
    const broadcast = new MuxBroadcast()
    const everything = collector(broadcast)
    // 手机 SSE 的过滤形态：会话帧按会话筛，控制帧全放行。
    const filtered = collector(broadcast, frame => frame.type !== 'session/event' || frame.sessionId === 's-1')

    broadcast.emit({ type: 'session/event', sessionId: 's-1', event: { type: 'turn/start', seq: 1 } as never })
    broadcast.emit({ type: 'session/event', sessionId: 's-2', event: { type: 'turn/start', seq: 2 } as never })
    broadcast.emit({ type: 'session/jobs', sessionId: 's-2', jobs: [] })
    await everything.settle()
    await filtered.settle()

    expect(everything.frames).toHaveLength(3)
    expect(filtered.frames.map(frame => frame.type)).toEqual(['session/event', 'session/jobs'])
    await everything.stop()
    await filtered.stop()
  })

  it('degrades to control-only when the host bus is unavailable', () => {
    const ctx = { on: () => { throw new Error('no such event') } } as never
    const broadcast = new MuxBroadcast()
    expect(() => setupMuxSources(ctx, idleSession(), broadcast, new AbortController().signal)).not.toThrow()
  })
})
