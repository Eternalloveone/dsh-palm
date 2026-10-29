/**
 * The approval/question bridges must retire an answered panel over the mux.
 *
 * `approval/resolved` and `question/resolved` were declared frame types with no
 * emitter anywhere in the host: `respond` resolved its in-memory promise and
 * stopped there. The phone's pending tracker only drops a pending item when that
 * frame arrives, so an answered panel stayed "pending" for the plugin's lifetime
 * and the polling fallback handed it back — the panel returned after the session
 * was re-entered.
 *
 * Second contract, same bridge: the phone sends its answer inside a
 * client-response envelope (`{sessionId, outcome}` for approvals,
 * `{sessionId, answer}` for questions), while the host waterfalls take the
 * PAYLOAD — a bare `ApprovalOutcome` and `{answers}`. Resolving with the envelope
 * made DSH normalize every approval to `unavailable` and made the ask-user tool
 * throw on `answers.map`: an answer that looked submitted never reached the agent.
 */
import { describe, expect, it, vi } from 'vitest'
import { makeApiProxyAdapter, toCatalogEntry } from './api-proxy-adapter.ts'
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

/** The desktop chain, still unanswered: a panel that is open and waiting. */
const waitingDesktop = (): Promise<unknown> => new Promise<never>(() => { /* never settles */ })

/**
 * Fire one blocking host request. `next` is the DESKTOP chain the bridge hands
 * downstream; the default stands for a desktop panel that is open and waiting,
 * which is the realistic downstream now that the phone and the desktop answer
 * one request in a race — a phone answer is then the only thing that settles it.
 */
function fireRequest(
  ctx: ReturnType<typeof makeCtx>,
  event: string,
  request: unknown,
  next: () => Promise<unknown> = waitingDesktop,
): Promise<unknown> {
  const answered = ctx.fire(event, request, next) as Promise<unknown>
  answered.catch(() => { /* asserted per test */ })
  return answered
}

/**
 * The other side of the race: one desktop panel, with the downstream waterfall
 * it owns. `next` records the signal the bridge handed downstream — that signal
 * is the whole withdrawal mechanism (the gateway cancels its pending event, and
 * broadcasts a `cancel` frame to the desktop client, when it aborts).
 */
function desktopPanel(request: { signal?: AbortSignal; [key: string]: unknown }) {
  const seen: { signal: AbortSignal | undefined } = { signal: undefined }
  const settled = Promise.withResolvers<unknown>()
  settled.promise.catch(() => { /* asserted per test */ })
  return {
    seen,
    next: (): Promise<unknown> => {
      seen.signal = request.signal
      return settled.promise
    },
    answer: (value: unknown): void => { settled.resolve(value) },
    giveUp: (error: unknown): void => { settled.reject(error) },
  }
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
    // The waterfall takes the OUTCOME ITSELF, not the phone's envelope: DSH
    // normalizes any return value outside the vocabulary to `unavailable` (fail
    // closed), so resolving with `{sessionId, approvalId, outcome}` refused every
    // approval the phone granted.
    await expect(answered).resolves.toBe('allowed-once')
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

  it('still hands an offline-time approval to the desktop and keeps nothing behind', async () => {
    const { ctx, adapter, frames, controller } = harness()
    adapter.setPhoneConnected(false)
    const answered = fireRequest(ctx, 'approval/request', approvalRequest, () => Promise.resolve('host-default'))
    await expect(answered).resolves.toBe('host-default')
    // 请求照样广播（手机稍后连上仍看得到），桌面答完随即结清，快照里不留残影。
    await until(() => { expect(frames).toHaveLength(2) })
    expect(frames[0]!.payload.type).toBe('approval/requested')
    expect(adapter.pendingFrames()).toHaveLength(0)
    controller.abort()
  })

  it('does not hang when the desktop has no client and no phone stream is live', async () => {
    const { ctx, adapter, controller } = harness()
    adapter.setPhoneConnected(false)
    const panel = desktopPanel(approvalRequest)
    const answered = fireRequest(ctx, 'approval/request', approvalRequest, panel.next)
    await until(() => { expect(panel.seen.signal).toBeDefined() })
    panel.giveUp(new Error('NO_PROVIDER'))
    // 一个手机流都没有、桌面又没人能看这条会话：没人可能作答，把桌面那条失败原样
    // 交回去，而不是像此前那样无条件挂着（悬停 1m55s 后被中断）。
    await expect(answered).rejects.toThrow('NO_PROVIDER')
    expect(adapter.pendingFrames()).toHaveLength(0)
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
      // What the phone actually sends: the answer rides INSIDE the client-response
      // envelope, whose sessionId the host checks for ownership.
      result: { ok: true, value: { sessionId: 's-1', answer: { answers: [{ id: 'q1', selected: ['A'] }] } } },
    } as never)

    await until(() => { expect(frames).toHaveLength(2) })
    // The tracker keys a question batch by the ask's own rpcId.
    expect(frames[1]!.payload).toMatchObject({
      type: 'question/resolved',
      sessionId: 's-1',
      questionRpcId: frames[0]!.rpcId,
      outcome: 'answered',
    })
    // DSH's ask-user tool reads `.answers` straight off the waterfall result, so
    // the bridge must hand over the payload rather than the envelope.
    await expect(answered).resolves.toEqual({ answers: [{ id: 'q1', selected: ['A'] }] })
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

  it('keeps a question pending for a phone that connects later, and lets it answer', async () => {
    const { ctx, adapter, frames, controller } = harness()
    // 提问发生时手机没有活着的流（App 在后台 / 锁屏 / 正在重连）——"面板消失"的现场。
    adapter.setPhoneConnected(false)
    const answered = fireRequest(ctx, 'user-questions/request', questionRequest)
    await until(() => { expect(frames).toHaveLength(1) })
    expect(frames[0]!.payload.type).toBe('question/requested')

    // 桌面一直没人答。手机这时才连上：开场快照把仍在等它的那条请求补给它。
    const snapshot = adapter.pendingFrames()
    expect(snapshot.map(frame => frame.payload.type)).toEqual(['question/requested'])
    expect(snapshot[0]!.rpcId).toBe(frames[0]!.rpcId)

    // 它用快照里的 rpcId 作答，走的是与在线时完全相同的那条路。
    await adapter.respond({
      type: 'client-response',
      rpcId: snapshot[0]!.rpcId,
      result: { ok: true, value: { sessionId: 's-1', answer: { answers: [{ id: 'q1', selected: ['B'] }] } } },
    } as never)

    await until(() => { expect(adapter.pendingFrames()).toHaveLength(0) })
    await expect(answered).resolves.toEqual({ answers: [{ id: 'q1', selected: ['B'] }] })
    controller.abort()
  })
})

describe('answer shape handed to the host waterfall', () => {
  it('never grants an approval whose outcome is missing', async () => {
    const { ctx, adapter, frames, controller } = harness()
    const answered = fireRequest(ctx, 'approval/request', approvalRequest)
    await until(() => { expect(frames).toHaveLength(1) })

    await adapter.respond({
      type: 'client-response',
      rpcId: frames[0]!.rpcId,
      result: { ok: true, value: { sessionId: 's-1', approvalId: frames[0]!.payload.approvalId } },
    } as never)

    // Fail closed: an unreadable outcome is not a grant.
    await expect(answered).resolves.toBe('unavailable')
    controller.abort()
  })

  it('refuses an answerless question batch instead of faking an empty one', async () => {
    const { ctx, adapter, frames, controller } = harness()
    const answered = fireRequest(ctx, 'user-questions/request', questionRequest)
    await until(() => { expect(frames).toHaveLength(1) })

    await adapter.respond({
      type: 'client-response',
      rpcId: frames[0]!.rpcId,
      result: { ok: true, value: { sessionId: 's-1' } },
    } as never)

    await until(() => { expect(frames).toHaveLength(2) })
    // The panel still retires — the phone is told its answer was accepted — but the
    // agent learns the answers could not be read instead of receiving an empty batch
    // that reads as "the user chose nothing".
    expect(frames[1]!.payload).toMatchObject({ type: 'question/resolved', outcome: 'answered' })
    await expect(answered).rejects.toThrow('answers')
    controller.abort()
  })
})

/**
 * The bridge used to hijack the request whenever a phone was connected: the
 * desktop chain was never consulted, so the desktop panel never appeared at all
 * (and a phone sitting on another session left the turn hanging). Both ends now
 * get the request and the first answer wins; the loser's panel is withdrawn.
 */
describe('dual-answer race between the phone and the desktop', () => {
  const questionAnswer = (selected: string): { answers: Array<{ id: string; selected: string[] }> } =>
    ({ answers: [{ id: 'q1', selected: [selected] }] })

  it('takes the desktop answer and retires the phone panel', async () => {
    const { ctx, adapter, frames, controller } = harness()
    const request = { agent: { id: 's-1' }, questions: [{ id: 'q1', question: '选哪个' }] }
    const desktop = desktopPanel(request)
    const answered = fireRequest(ctx, 'user-questions/request', request, desktop.next)
    await until(() => { expect(frames).toHaveLength(1) })
    expect(frames[0]!.payload.type).toBe('question/requested')

    desktop.answer(questionAnswer('桌面选的'))

    // The phone is told the batch is over, so its panel and the host-side pending
    // tracker (the polling fallback) drop it instead of handing it back later.
    await until(() => { expect(frames).toHaveLength(2) })
    expect(frames[1]!.payload).toMatchObject({
      type: 'question/resolved',
      sessionId: 's-1',
      questionRpcId: frames[0]!.rpcId,
      outcome: 'answered',
    })
    await expect(answered).resolves.toEqual(questionAnswer('桌面选的'))
    // A phone answer racing in after the desktop won is a no-op, not a second answer.
    await expect(adapter.respond({
      type: 'client-response',
      rpcId: frames[0]!.rpcId,
      result: { ok: true, value: { sessionId: 's-1', answer: questionAnswer('手机选的') } },
    } as never)).resolves.toEqual({ accepted: false, reason: 'not-pending' })
    controller.abort()
  })

  it('cancels the desktop pending once the phone answers first', async () => {
    const { ctx, adapter, frames, controller } = harness()
    const request = { agent: { id: 's-1' }, questions: [{ id: 'q1', question: '选哪个' }] }
    const desktop = desktopPanel(request)
    const answered = fireRequest(ctx, 'user-questions/request', request, desktop.next)
    await until(() => { expect(frames).toHaveLength(1) })
    // Both panels are up: the desktop chain holds an unanswered request.
    expect(desktop.seen.signal?.aborted).toBe(false)

    await adapter.respond({
      type: 'client-response',
      rpcId: frames[0]!.rpcId,
      result: { ok: true, value: { sessionId: 's-1', answer: questionAnswer('手机选的') } },
    } as never)
    await expect(answered).resolves.toEqual(questionAnswer('手机选的'))

    // Aborting the signal the bridge handed downstream is what makes the gateway
    // cancel the desktop's pending event and push a `cancel` frame to that client:
    // without it the desktop panel would sit there waiting for a request that is
    // already answered.
    await until(() => { expect(desktop.seen.signal?.aborted).toBe(true) })
    controller.abort()
  })

  it('keeps the turn signal reaching the desktop chain', async () => {
    const { ctx, controller } = harness()
    const turn = new AbortController()
    const request = { agent: { id: 's-1' }, questions: [{ id: 'q1', question: '选哪个' }], signal: turn.signal }
    const desktop = desktopPanel(request)
    fireRequest(ctx, 'user-questions/request', request, desktop.next)

    // The downstream signal is the composite (turn + bridge gate), never the raw
    // turn signal: replacing it must not break the host's own cancellation.
    expect(desktop.seen.signal).toBeInstanceOf(AbortSignal)
    expect(desktop.seen.signal).not.toBe(turn.signal)
    turn.abort()
    await until(() => { expect(desktop.seen.signal?.aborted).toBe(true) })
    controller.abort()
  })

  it('keeps waiting for the phone when the desktop has nothing to answer with', async () => {
    const { ctx, adapter, frames, controller } = harness()
    const request = { agent: { id: 's-1' }, questions: [{ id: 'q1', question: '选哪个' }] }
    const desktop = desktopPanel(request)
    const answered = fireRequest(ctx, 'user-questions/request', request, desktop.next)
    await until(() => { expect(frames).toHaveLength(1) })

    // No desktop client is looking at this session, so its chain delegates and the
    // host rejects with "no answerer". That is not the race's verdict: the phone's
    // panel is still up and must be able to answer.
    desktop.giveUp(new Error('no user-questions answerer accepted the request'))

    await adapter.respond({
      type: 'client-response',
      rpcId: frames[0]!.rpcId,
      result: { ok: true, value: { sessionId: 's-1', answer: questionAnswer('手机选的') } },
    } as never)
    await expect(answered).resolves.toEqual(questionAnswer('手机选的'))
    controller.abort()
  })

  it('runs the same race for approvals', async () => {
    const { ctx, adapter, frames, controller } = harness()
    const request = { agent: { id: 's-1' }, toolName: 'bash', reason: '写入文件' }
    const desktop = desktopPanel(request)
    const answered = fireRequest(ctx, 'approval/request', request, desktop.next)
    await until(() => { expect(frames).toHaveLength(1) })
    expect(frames[0]!.payload.type).toBe('approval/requested')

    desktop.answer('allowed-once')

    await until(() => { expect(frames).toHaveLength(2) })
    expect(frames[1]!.payload).toMatchObject({
      type: 'approval/resolved',
      sessionId: 's-1',
      approvalId: frames[0]!.payload.approvalId,
      outcome: 'allowed-once',
    })
    await expect(answered).resolves.toBe('allowed-once')

    // And the other order: the phone answers, the desktop's pending is cancelled.
    const second = { agent: { id: 's-1' }, toolName: 'bash' }
    const secondDesktop = desktopPanel(second)
    const secondAnswered = fireRequest(ctx, 'approval/request', second, secondDesktop.next)
    await until(() => { expect(frames).toHaveLength(3) })
    await adapter.respond({
      type: 'client-response',
      rpcId: frames[2]!.rpcId,
      result: { ok: true, value: { sessionId: 's-1', approvalId: frames[2]!.payload.approvalId, outcome: 'rejected' } },
    } as never)
    await expect(secondAnswered).resolves.toBe('rejected')
    await until(() => { expect(secondDesktop.seen.signal?.aborted).toBe(true) })
    controller.abort()
  })

  it('forwards session.list limit only when it is a positive integer', async () => {
    // 手机端「谁在跑」的探针只带最近 200 条的 limit。适配层不转发时，宿主会把整张
    // 会话表枚举一遍（冷启动实测 24.7 秒），请求在手机上根本等不到答复。
    const { ctx, adapter } = harness()
    const list = vi.fn(async (query: unknown) => ({ items: [], query }))
    ;(ctx.get('sessionController') as { list?: unknown }).list = list

    await adapter.sessions.list({ rpcId: 'list-1', payload: { cursor: 'c-1', limit: 200 } } as never)
    expect(list.mock.calls[0]?.[0]).toEqual({ cursor: 'c-1', limit: 200 })

    await adapter.sessions.list({ rpcId: 'list-2', payload: { cursor: 'c-2' } } as never)
    expect(list.mock.calls[1]?.[0]).toEqual({ cursor: 'c-2' })

    // 非正整数一律不转发，免得下游收到 0 / NaN 后自己猜。
    await adapter.sessions.list({ rpcId: 'list-3', payload: { limit: 0 } } as never)
    expect(list.mock.calls[2]?.[0]).toEqual({ cursor: undefined })
  })
})

describe('子代理目录：0.2.x 的 listChildren 裸条目 → 手机侧目录行', () => {
  it('keeps a continuable child续聊语义 and its label', () => {
    const entry = toCatalogEntry({ id: 'c1', mode: 'continuable', label: '整理记忆' })
    expect(entry).toMatchObject({
      kind: 'child',
      id: 'c1',
      mode: 'continuable',
      label: '整理记忆',
      // 运行态由 mobile-api 按子会话边界补，这里只占位。
      activity: 'inactive',
      hasChildren: false,
    })
  })

  it('treats one-shot / external / unknown as one-shot', () => {
    for (const mode of ['one-shot', 'external', 'unknown', undefined]) {
      const entry = toCatalogEntry({ id: 'c2', ...(mode === undefined ? {} : { mode }) })
      expect(entry).toMatchObject({ kind: 'child', mode: 'one-shot' })
    }
  })

  it('drops an empty label instead of projecting an empty title', () => {
    const entry = toCatalogEntry({ id: 'c3', mode: 'one-shot', label: '' })
    expect(entry.kind === 'child' && 'label' in entry).toBe(false)
  })
})
