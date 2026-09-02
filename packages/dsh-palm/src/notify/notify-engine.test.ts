import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NotifyEngine, type NotifyEngineHost, type NotifyEvent } from './notify-engine.ts'
import { NotifyStore } from './notify-store.ts'

/** Let the engine's async mux watch consume queued frames. */
async function flush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
  await new Promise(resolve => setTimeout(resolve, 0))
}

/** A fake host mux stream the test feeds frames into. */
function fakeHost(overrides: Partial<NotifyEngineHost> = {}): {
  host: NotifyEngineHost
  push(frame: unknown): void
  end(): void
} {
  const queue: unknown[] = []
  const waiters: Array<(value: unknown) => void> = []
  const host: NotifyEngineHost = {
    events: {
      mux: async function* (_request, signal) {
        for (;;) {
          if (signal.aborted) return
          if (queue.length > 0) {
            yield queue.shift()
            continue
          }
          const frame = await new Promise<unknown>(resolve => { waiters.push(resolve) })
          if (signal.aborted) return
          yield frame
        }
      },
    },
    sessions: {
      list: async () => ({ result: { ok: true, value: { items: [] } } }),
    },
    workspace: {
      list: async () => ({ result: { ok: true, value: { items: [] } } }),
    },
    ...overrides,
  }
  return {
    host,
    push: (frame: unknown) => {
      // The real host mux stream wraps every frame in the RPC envelope
      // ({ rpcId, payload }); the fake mirrors that shape so the engine's
      // unwrap path is exercised by every test.
      const wrapped = { rpcId: 'test-rpc', payload: frame }
      if (waiters.length > 0) {
        const resolve = waiters.shift()
        resolve?.(wrapped)
      } else {
        queue.push(wrapped)
      }
    },
    end: () => {
      for (const resolve of waiters.splice(0)) resolve(undefined)
    },
  }
}

/** A scratch store with a tunable threshold/cooldown. */
function store(thresholdMs = 30_000, cooldownMs = 120_000): NotifyStore {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-palm-notify-'))
  const file = join(dir, 'notify.json')
  const store = new NotifyStore(file)
  store.setConfig({ turnThresholdMs: thresholdMs, turnCooldownMs: cooldownMs })
  return store
}

/** Collect engine events until the test stops the engine. */
function collect(engine: NotifyEngine): NotifyEvent[] {
  const events: NotifyEvent[] = []
  engine.subscribe(event => { events.push(event) })
  return events
}

const jobsFrame = (sessionId: string, jobs: unknown[]) => ({ type: 'session/jobs', sessionId, jobs })
const turnStart = (sessionId: string, turn = 1) => ({
  type: 'session/event',
  sessionId,
  event: { type: 'turn/start', turn },
})
const turnEnd = (sessionId: string, turn = 1, reason = { kind: 'completed' }) => ({
  type: 'session/event',
  sessionId,
  event: { type: 'turn/end', turn, reason },
})

describe('NotifyEngine jobs', () => {
  it('emits task-done on a running→completed transition', async () => {
    const { host, push } = fakeHost()
    const engine = new NotifyEngine(host, store())
    engine.start()
    const events = collect(engine)
    push(jobsFrame('s-1', [{ id: 'bash-1', status: 'running', label: 'pnpm test' }]))
    await flush()
    push(jobsFrame('s-1', [{ id: 'bash-1', status: 'completed', label: 'pnpm test' }]))
    await flush()
    expect(events).toHaveLength(1)
    expect(events[0]?.kind).toBe('task-done')
    expect(events[0]?.title).toBe('任务完成')
    expect(events[0]?.body).toContain('pnpm test')
    expect(events[0]?.sessionId).toBe('s-1')
    engine.stop()
  })

  it('emits task-failed with the detail on a running→failed transition', async () => {
    const { host, push } = fakeHost()
    const engine = new NotifyEngine(host, store())
    engine.start()
    const events = collect(engine)
    push(jobsFrame('s-1', [{ id: 'bash-1', status: 'running', label: 'build' }]))
    await flush()
    push(jobsFrame('s-1', [{ id: 'bash-1', status: 'failed', label: 'build', detail: 'exit code: 2' }]))
    await flush()
    expect(events).toHaveLength(1)
    expect(events[0]?.kind).toBe('task-failed')
    expect(events[0]?.body).toContain('exit code: 2')
    engine.stop()
  })

  it('does not emit for a job that was never seen running (baseline frame)', async () => {
    const { host, push } = fakeHost()
    const engine = new NotifyEngine(host, store())
    engine.start()
    const events = collect(engine)
    push(jobsFrame('s-1', [{ id: 'bash-1', status: 'completed', label: 'pnpm test' }]))
    await flush()
    expect(events).toHaveLength(0)
    engine.stop()
  })

  it('does not emit for killed jobs (user-initiated)', async () => {
    const { host, push } = fakeHost()
    const engine = new NotifyEngine(host, store())
    engine.start()
    const events = collect(engine)
    push(jobsFrame('s-1', [{ id: 'bash-1', status: 'running', label: 'build' }]))
    await flush()
    push(jobsFrame('s-1', [{ id: 'bash-1', status: 'killed', label: 'build' }]))
    await flush()
    expect(events).toHaveLength(0)
    engine.stop()
  })

  it('emits once per job terminal transition (dedupe)', async () => {
    const { host, push } = fakeHost()
    const engine = new NotifyEngine(host, store())
    engine.start()
    const events = collect(engine)
    push(jobsFrame('s-1', [{ id: 'bash-1', status: 'running', label: 'build' }]))
    await flush()
    push(jobsFrame('s-1', [{ id: 'bash-1', status: 'completed', label: 'build' }]))
    await flush()
    // A later frame still lists the completed job: no second notification.
    push(jobsFrame('s-1', [{ id: 'bash-1', status: 'completed', label: 'build' }]))
    await flush()
    expect(events).toHaveLength(1)
    engine.stop()
  })

  it('uses the job id as the label fallback when the label is empty', async () => {
    const { host, push } = fakeHost()
    const engine = new NotifyEngine(host, store())
    engine.start()
    const events = collect(engine)
    push(jobsFrame('s-1', [{ id: 'bash-1', status: 'running', label: '' }]))
    await flush()
    push(jobsFrame('s-1', [{ id: 'bash-1', status: 'completed', label: '' }]))
    await flush()
    expect(events[0]?.body).toContain('bash-1')
    engine.stop()
  })
})

describe('NotifyEngine turns', () => {
  it('emits turn-done for a turn longer than a tiny threshold', async () => {
    const { host, push } = fakeHost()
    const engine = new NotifyEngine(host, store(1))
    engine.start()
    const events = collect(engine)
    push(turnStart('s-1'))
    await flush()
    push(turnEnd('s-1'))
    await flush()
    expect(events).toHaveLength(1)
    expect(events[0]?.kind).toBe('turn-done')
    expect(events[0]?.title).toBe('回复完成')
    engine.stop()
  })

  it('does not emit for a turn shorter than the threshold', async () => {
    const { host, push } = fakeHost()
    const engine = new NotifyEngine(host, store(60_000))
    engine.start()
    const events = collect(engine)
    push(turnStart('s-1'))
    await flush()
    push(turnEnd('s-1'))
    await flush()
    expect(events).toHaveLength(0)
    engine.stop()
  })

  it('does not emit for non-completed turn reasons', async () => {
    const { host, push } = fakeHost()
    const engine = new NotifyEngine(host, store(1))
    engine.start()
    const events = collect(engine)
    push(turnStart('s-1'))
    await flush()
    push(turnEnd('s-1', 1, { kind: 'aborted' }))
    await flush()
    push(turnStart('s-1', 2))
    await flush()
    push(turnEnd('s-1', 2, { kind: 'error' }))
    await flush()
    expect(events).toHaveLength(0)
    engine.stop()
  })

  it('does not emit for a turn/end without a matching turn/start', async () => {
    const { host, push } = fakeHost()
    const engine = new NotifyEngine(host, store(1))
    engine.start()
    const events = collect(engine)
    push(turnEnd('s-1'))
    await flush()
    expect(events).toHaveLength(0)
    engine.stop()
  })

  it('cooldown suppresses a second turn-done of the same session', async () => {
    const { host, push } = fakeHost()
    const engine = new NotifyEngine(host, store(1, 120_000))
    engine.start()
    const events = collect(engine)
    push(turnStart('s-1'))
    await flush()
    push(turnEnd('s-1'))
    await flush()
    push(turnStart('s-1', 2))
    await flush()
    push(turnEnd('s-1', 2))
    await flush()
    expect(events).toHaveLength(1)
    engine.stop()
  })

  it('cooldown is per session (two sessions notify independently)', async () => {
    const { host, push } = fakeHost()
    const engine = new NotifyEngine(host, store(1, 120_000))
    engine.start()
    const events = collect(engine)
    push(turnStart('s-1'))
    await flush()
    push(turnEnd('s-1'))
    await flush()
    push(turnStart('s-2'))
    await flush()
    push(turnEnd('s-2'))
    await flush()
    expect(events).toHaveLength(2)
    engine.stop()
  })
})

describe('NotifyEngine index', () => {
  it('attaches the workspace id and session title from the index', async () => {
    const { host, push } = fakeHost({
      sessions: {
        list: async () => ({
          result: {
            ok: true,
            value: {
              items: [{ sessionId: 's-1', projections: { values: { title: '我的任务' } } }],
            },
          },
        }),
      },
      workspace: {
        list: async () => ({
          result: {
            ok: true,
            value: { items: [{ workspaceId: 'w-1', sessionIds: ['s-1'] }] },
          },
        }),
      },
    })
    const engine = new NotifyEngine(host, store(1))
    engine.start()
    const events = collect(engine)
    // Let the index refresh settle before the turn fires.
    await flush()
    push(turnStart('s-1'))
    await flush()
    push(turnEnd('s-1'))
    await flush()
    expect(events[0]?.workspaceId).toBe('w-1')
    expect(events[0]?.body).toContain('我的任务')
    engine.stop()
  })

  it('fires with bare ids when the index is unavailable', async () => {
    const { host, push } = fakeHost({
      sessions: { list: async () => { throw new Error('host down') } },
      workspace: { list: async () => { throw new Error('host down') } },
    })
    const engine = new NotifyEngine(host, store(1))
    engine.start()
    const events = collect(engine)
    push(turnStart('s-1'))
    await flush()
    push(turnEnd('s-1'))
    await flush()
    expect(events[0]?.workspaceId).toBeUndefined()
    expect(events[0]?.body).toBe('回复已完成')
    engine.stop()
  })
})

describe('NotifyEngine lifecycle', () => {
  it('unsubscribes a listener', async () => {
    const { host, push } = fakeHost()
    const engine = new NotifyEngine(host, store(1))
    engine.start()
    const events: NotifyEvent[] = []
    const unsubscribe = engine.subscribe(event => { events.push(event) })
    unsubscribe()
    push(turnStart('s-1'))
    await flush()
    push(turnEnd('s-1'))
    await flush()
    expect(events).toHaveLength(0)
    engine.stop()
  })

  it('a throwing listener does not break other listeners', async () => {
    const { host, push } = fakeHost()
    const engine = new NotifyEngine(host, store(1))
    engine.start()
    const events: NotifyEvent[] = []
    engine.subscribe(() => { throw new Error('listener boom') })
    engine.subscribe(event => { events.push(event) })
    push(turnStart('s-1'))
    await flush()
    push(turnEnd('s-1'))
    await flush()
    expect(events).toHaveLength(1)
    engine.stop()
  })

  it('start is idempotent and stop releases the watch', async () => {
    const { host, push } = fakeHost()
    const engine = new NotifyEngine(host, store(1))
    engine.start()
    engine.start()
    const events = collect(engine)
    push(turnStart('s-1'))
    await flush()
    push(turnEnd('s-1'))
    await flush()
    expect(events).toHaveLength(1)
    engine.stop()
    engine.stop()
  })
})
