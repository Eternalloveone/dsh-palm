/**
 * The approval/question bridges must retire an answered panel over the mux.
 *
 * `approval/resolved` and `question/resolved` were declared frame types with no
 * emitter anywhere in the host: `respond` resolved its in-memory promise and
 * stopped there. The phone's pending tracker only drops a pending item when that
 * frame arrives, so an answered panel stayed "pending" for the plugin's lifetime
 * and the polling fallback handed it back — the panel returned after the session
 * was re-entered.
 */
import { describe, expect, it, vi } from 'vitest'
import { makeApiProxyAdapter } from './api-proxy-adapter.ts'
import { SessionObserverRegistry } from './api-proxy-observe.ts'

/** Poll a condition until it holds (no timer dependency on vitest helpers). */
async function until(check: () => void, timeoutMs = 2000): Promise<void> {
  const started = Date.now()
  for (;;) {
    try {
      check()
      return
    } catch (error) {
      if (Date.now() - started > timeoutMs) throw error
      await new Promise(resolve => setTimeout(resolve, 5))
    }
  }
}

/** Minimal cordis ctx: records listeners so the test can fire host events. */
function makeCtx() {
  const listeners = new Map<string, Array<(...args: unknown[]) => unknown>>()
  // The adapter only reads the host controllers lazily; an empty stub is enough
  // for the panel bridges, which never touch them.
  const controllers: Record<string, unknown> = {}
  return {
    get: (name: string) => {
      controllers[name] ??= {}
      return controllers[name]
    },
    on: (event: string, handler: (...args: unknown[]) => unknown) => {
      const list = listeners.get(event) ?? []
      listeners.set(event, list)
      list.push(handler)
      return () => {
        const index = list.indexOf(handler)
        if (index >= 0) list.splice(index, 1)
      }
    },
    fire: (event: string, ...args: unknown[]): unknown => {
      const handler = listeners.get(event)?.[0]
      if (handler === undefined) throw new Error(`no listener registered for ${event}`)
      return handler(...args)
    },
  }
}

interface SeenFrame {
  rpcId: string
  payload: { type: string; approvalId?: string; [key: string]: unknown }
}

/** Build the adapter over a fake ctx and open a mux reader on it. */
function harness() {
  const ctx = makeCtx()
  const adapter = makeApiProxyAdapter(ctx as never, new SessionObserverRegistry(), { register: vi.fn(), note: vi.fn() } as never)
  adapter.setPhoneConnected(true)
  const controller = new AbortController()
  const frames: SeenFrame[] = []
  const pump = (async () => {
    for await (const frame of adapter.events.mux({ rpcId: 'r1', payload: {} } as never, controller.signal)) {
      frames.push(frame as never)
    }
  })()
  pump.catch(() => { /* aborted at teardown */ })
  return { ctx, adapter, frames, controller }
}

/** Fire one blocking host request; the waterfall promise is returned (and its
 *  rejection marked handled, since each test asserts it explicitly). */
function fireRequest(ctx: ReturnType<typeof makeCtx>, event: string, request: unknown): Promise<unknown> {
  const answered = ctx.fire(event, request, () => Promise.resolve('host-default')) as Promise<unknown>
  answered.catch(() => { /* asserted per test */ })
  return answered
}

const approvalRequest = { agent: { id: 's-1' }, toolName: 'bash', reason: '写入文件' }
const questionRequest = { agent: { id: 's-1' }, questions: [{ id: 'q1', question: '选哪个' }] }

describe('approval bridge over the mux', () => {
  it('broadcasts approval/resolved once the phone answers', async () => {
    const { ctx, adapter, frames, controller } = harness()
    const answered = fireRequest(ctx, 'approval/request', approvalRequest)
    await until(() => { expect(frames).toHaveLength(1) })
    expect(frames[0]!.payload.type).toBe('approval/requested')

    await adapter.respond({
      type: 'client-response',
      rpcId: frames[0]!.rpcId,
      result: { ok: true, value: { sessionId: 's-1', approvalId: frames[0]!.payload.approvalId, outcome: 'allowed-once' } },
    } as never)

    await until(() => { expect(frames).toHaveLength(2) })
    expect(frames[1]!.payload).toMatchObject({
      type: 'approval/resolved',
      sessionId: 's-1',
      approvalId: frames[0]!.payload.approvalId,
      outcome: 'allowed-once',
    })
    // Unchanged: the blocked waterfall resolves with the phone's own answer.
    await expect(answered).resolves.toMatchObject({ outcome: 'allowed-once' })
    controller.abort()
  })

  it('labels a refused answer unavailable instead of pretending it was allowed', async () => {
    const { ctx, adapter, frames, controller } = harness()
    const answered = fireRequest(ctx, 'approval/request', approvalRequest)
    await until(() => { expect(frames).toHaveLength(1) })

    await adapter.respond({
      type: 'client-response',
      rpcId: frames[0]!.rpcId,
      result: { ok: false, error: { code: 'bad-request', message: '坏了' } },
    } as never)

    await until(() => { expect(frames).toHaveLength(2) })
    expect(frames[1]!.payload).toMatchObject({ type: 'approval/resolved', outcome: 'unavailable' })
    await expect(answered).rejects.toThrow('坏了')
    controller.abort()
  })

  it('leaves the waterfall to the host while no phone is connected', async () => {
    const { ctx, adapter, frames, controller } = harness()
    adapter.setPhoneConnected(false)
    await expect(fireRequest(ctx, 'approval/request', approvalRequest)).resolves.toBe('host-default')
    // Nothing was forwarded to the phone, so nothing is broadcast.
    expect(frames).toHaveLength(0)
    controller.abort()
  })
})

describe('question bridge over the mux', () => {
  it('broadcasts question/resolved once the phone answers the batch', async () => {
    const { ctx, adapter, frames, controller } = harness()
    const answered = fireRequest(ctx, 'user-questions/request', questionRequest)
    await until(() => { expect(frames).toHaveLength(1) })
    expect(frames[0]!.payload.type).toBe('question/requested')

    await adapter.respond({
      type: 'client-response',
      rpcId: frames[0]!.rpcId,
      result: { ok: true, value: { sessionId: 's-1', answers: [{ id: 'q1', selected: ['A'] }] } },
    } as never)

    await until(() => { expect(frames).toHaveLength(2) })
    // The tracker keys a question batch by the ask's own rpcId.
    expect(frames[1]!.payload).toMatchObject({
      type: 'question/resolved',
      sessionId: 's-1',
      questionRpcId: frames[0]!.rpcId,
      outcome: 'answered',
    })
    await expect(answered).resolves.toMatchObject({ sessionId: 's-1' })
    controller.abort()
  })

  it('labels a refused batch cancelled', async () => {
    const { ctx, adapter, frames, controller } = harness()
    fireRequest(ctx, 'user-questions/request', questionRequest)
    await until(() => { expect(frames).toHaveLength(1) })

    await adapter.respond({
      type: 'client-response',
      rpcId: frames[0]!.rpcId,
      result: { ok: false, error: { code: 'bad-request', message: '坏了' } },
    } as never)

    await until(() => { expect(frames).toHaveLength(2) })
    expect(frames[1]!.payload).toMatchObject({ type: 'question/resolved', outcome: 'cancelled' })
    controller.abort()
  })
})
