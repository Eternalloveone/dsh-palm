// @vitest-environment jsdom
/**
 * Client settings-surface migration pins: the pairing surface must read and
 * write its `dsh-palm` settings section through whichever client settings
 * service the running shell provides — legacy `ctx.settingsScope` (0.1.5) or
 * the modern `ctx.remote.settings` namespace (0.1.6+) — and must degrade
 * without throwing when neither exists. The static `inject` list is pinned
 * too: naming either service there parks the plugin on the other line, which
 * is how the pairing surface stopped activating on 0.1.7.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRemoteSettingsAdapter, type SettingsScopeLike, type SettingsScopeSnapshot } from '../src/client/settings-scope.ts'
import { apply, inject } from '../src/client/index.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

/** Walk a scripted answer list, then repeat the last answer. */
function scripted<T>(answers: T[]): () => T {
  let index = 0
  return () => {
    const answer = answers[Math.min(index, answers.length - 1)]
    index += 1
    return answer as T
  }
}

/** Flush the pending Remote read and its listener fan-out. */
async function tick(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

/** One redacted namespace row as `settings.describe()` answers it. */
interface Row {
  ns: string
  value?: unknown
  revision?: number
}

type DescribeAnswer = { ok: boolean; value?: { namespaces: Row[] }; error?: { message: string } }
type MutateAnswer = { ok: boolean; value?: Row; error?: { message: string } }

/** Scripted modern `remote.settings` double: recorded calls, queued answers. */
function modernDouble(describes: DescribeAnswer[], mutates: MutateAnswer[] = []) {
  const nextDescribe = scripted(describes)
  const nextMutate = scripted(mutates.length === 0
    ? [{ ok: true, value: { ns: 'dsh-palm', value: {}, revision: 1 } }]
    : mutates)
  const calls = {
    describe: 0,
    mutate: [] as Array<{ ns: string; ops: unknown; revision: number | undefined }>,
    released: 0,
  }
  const documentEvents = new Set<(ns: unknown, revision: unknown) => void>()
  const api = {
    describe: async (): Promise<DescribeAnswer> => {
      calls.describe += 1
      return nextDescribe()
    },
    mutate: async (ns: string, ops: unknown, revision: number | undefined): Promise<MutateAnswer> => {
      calls.mutate.push({ ns, ops, revision })
      return nextMutate()
    },
  }
  const remote = {
    $on: (event: string, listener: (ns: unknown, revision: unknown) => void): (() => void) => {
      if (event !== 'settings/document-updated') throw new Error(`unexpected event ${event}`)
      documentEvents.add(listener)
      return () => {
        documentEvents.delete(listener)
        calls.released += 1
      }
    },
  }
  return {
    api,
    remote,
    calls,
    /** Deliver one forwarded document update to every subscriber. */
    emitDocumentUpdate(ns: string, revision: number): void {
      for (const listener of [...documentEvents]) listener(ns, revision)
    },
  }
}

/** One `dsh-palm` settings section as the section interface declares it. */
type Section = { enabled?: boolean; publicBaseUrl?: string }

/** Legacy (0.1.5) binder double: one handle plus an observer-driven snapshot. */
function legacyDouble(initial: SettingsScopeSnapshot<Section>) {
  const listeners = new Set<() => void>()
  const calls: Array<{ key: string; value?: unknown }> = []
  const namespaces: string[] = []
  let snapshot = initial
  const handle: SettingsScopeLike<Section> = {
    getSnapshot: () => snapshot,
    subscribe: (callback) => {
      listeners.add(callback)
      return () => { listeners.delete(callback) }
    },
    set: async (key, value) => { calls.push({ key, value }) },
    unset: async (key) => { calls.push({ key }) },
  }
  return {
    calls,
    namespaces,
    binder: {
      bind: <T,>(spec: { namespace: string }): SettingsScopeLike<T> => {
        namespaces.push(spec.namespace)
        return handle as unknown as SettingsScopeLike<T>
      },
    },
    /** Publish one new snapshot to the binder's subscribers. */
    publish(next: SettingsScopeSnapshot<Section>): void {
      snapshot = next
      for (const callback of [...listeners]) callback()
    },
  }
}

/** Client context double: a store lookup plus the optional service properties. */
function fakeContext(options: {
  services?: Record<string, unknown>
  properties?: Record<string, unknown>
  on?: (event: string, listener: (...args: unknown[]) => void) => (() => void) | void
} = {}) {
  // The caller's store object is kept by reference so a test can mount a
  // service later, the way a shell does after this plugin's apply.
  const services = options.services ?? {}
  services.connection ??= { isLoopback: true }
  return {
    get: (name: string): unknown => services[name],
    ...options.properties,
    ...options.on === undefined ? {} : { on: options.on },
  }
}

/**
 * Build the adapter and read it once: `apply()` primes the handle through
 * `syncEntry`/`syncRuntime`, which is also what starts the first Remote read.
 */
function primedAdapter<T>(ctx: unknown) {
  const adapter = createRemoteSettingsAdapter<T>(ctx, 'dsh-palm')
  adapter.scope.getSnapshot()
  return adapter
}

describe('client settings adapter (version-agnostic seam)', () => {
  it('pins the static inject list to nothing more than the shell always provides', () => {
    // `settingsScope` (0.1.5) and `remote.settings` (0.1.6+) are resolved at
    // runtime: a static entry for either parks the plugin on the other line.
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote'])
  })

  it('reads and writes the legacy binder when it is the only service', async () => {
    const legacy = legacyDouble({ status: 'ready', value: { enabled: false, publicBaseUrl: 'https://old' } })
    const ctx = fakeContext({ services: { settingsScope: legacy.binder } })
    const adapter = createRemoteSettingsAdapter<{ enabled?: boolean; publicBaseUrl?: string }>(ctx, 'dsh-palm')

    expect(adapter.backend()).toBe('settingsScope')
    expect(legacy.namespaces).toEqual(['dsh-palm'])
    expect(adapter.scope.getSnapshot()).toEqual({ status: 'ready', value: { enabled: false, publicBaseUrl: 'https://old' } })

    await adapter.scope.set('publicBaseUrl', 'https://new')
    await adapter.scope.unset('publicBaseUrl')
    expect(legacy.calls).toEqual([{ key: 'publicBaseUrl', value: 'https://new' }, { key: 'publicBaseUrl' }])

    const observed: string[] = []
    adapter.scope.subscribe(() => { observed.push('changed') })
    legacy.publish({ status: 'ready', value: { enabled: true } })
    expect(observed).toEqual(['changed'])
    expect(adapter.scope.getSnapshot()).toEqual({ status: 'ready', value: { enabled: true } })
  })

  it('also resolves the legacy binder from a plain context property', () => {
    // A shell (or a test double) may hang the legacy service straight off the
    // context instead of the store lookup.
    const legacy = legacyDouble({ status: 'unavailable' })
    const adapter = createRemoteSettingsAdapter(ctxWithoutGet(legacy.binder), 'dsh-palm')
    expect(adapter.backend()).toBe('settingsScope')
    expect(adapter.scope.getSnapshot()).toEqual({ status: 'unavailable' })
  })

  it('reads the modern namespace and folds its answered section', async () => {
    const modern = modernDouble([{
      ok: true,
      value: { namespaces: [{ ns: 'dsh-palm', value: { enabled: false, publicBaseUrl: 'https://tunnel' }, revision: 7 }] },
    }])
    const ctx = fakeContext({ services: { 'remote.settings': modern.api, remote: modern.remote } })
    const adapter = primedAdapter<{ enabled?: boolean; publicBaseUrl?: string }>(ctx)

    // Degrade-first: the entry must not wait on the first Remote read.
    expect(adapter.backend()).toBe('remote.settings')
    expect(adapter.scope.getSnapshot()).toEqual({ status: 'unavailable' })

    await tick()
    expect(modern.calls.describe).toBe(1)
    expect(adapter.scope.getSnapshot()).toEqual({
      status: 'ready',
      value: { enabled: false, publicBaseUrl: 'https://tunnel' },
    })
  })

  it('writes through mutate with the read revision and folds the write answer', async () => {
    const modern = modernDouble(
      [{ ok: true, value: { namespaces: [{ ns: 'dsh-palm', value: { publicBaseUrl: 'https://old' }, revision: 7 }] } }],
      [{ ok: true, value: { ns: 'dsh-palm', value: { publicBaseUrl: 'https://new' }, revision: 8 } }],
    )
    const ctx = fakeContext({ services: { 'remote.settings': modern.api, remote: modern.remote } })
    const adapter = primedAdapter<{ publicBaseUrl?: string }>(ctx)
    await tick()

    await adapter.scope.set('publicBaseUrl', 'https://new')
    expect(modern.calls.mutate).toEqual([{
      ns: 'dsh-palm',
      ops: [{ op: 'set', path: ['publicBaseUrl'], value: 'https://new' }],
      revision: 7,
    }])
    expect(adapter.scope.getSnapshot()).toEqual({ status: 'ready', value: { publicBaseUrl: 'https://new' } })

    await adapter.scope.unset('publicBaseUrl')
    expect(modern.calls.mutate[1]).toMatchObject({
      ns: 'dsh-palm',
      ops: [{ op: 'unset', path: ['publicBaseUrl'] }],
    })
  })

  it('re-reads the revision and retries once when a write is refused', async () => {
    const modern = modernDouble(
      [
        { ok: true, value: { namespaces: [{ ns: 'dsh-palm', value: { publicBaseUrl: 'https://old' }, revision: 7 }] } },
        { ok: true, value: { namespaces: [{ ns: 'dsh-palm', value: { publicBaseUrl: 'https://other' }, revision: 9 }] } },
      ],
      [
        { ok: false, error: { message: 'settings/conflict' } },
        { ok: true, value: { ns: 'dsh-palm', value: { publicBaseUrl: 'https://new' }, revision: 10 } },
      ],
    )
    const ctx = fakeContext({ services: { 'remote.settings': modern.api, remote: modern.remote } })
    const adapter = primedAdapter<{ publicBaseUrl?: string }>(ctx)
    await tick()

    await expect(adapter.scope.set('publicBaseUrl', 'https://new')).resolves.toBeUndefined()
    expect(modern.calls.mutate.map(call => call.revision)).toEqual([7, 9])
    expect(adapter.scope.getSnapshot()).toEqual({ status: 'ready', value: { publicBaseUrl: 'https://new' } })
  })

  it('never rejects a write when the transport fails, and keeps the held section', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const modern = modernDouble(
      [{ ok: true, value: { namespaces: [{ ns: 'dsh-palm', value: { publicBaseUrl: 'https://held' }, revision: 3 }] } }],
      [],
    )
    modern.api.mutate = async () => { throw new Error('socket closed') }
    const ctx = fakeContext({ services: { 'remote.settings': modern.api, remote: modern.remote } })
    const adapter = primedAdapter<{ publicBaseUrl?: string }>(ctx)
    await tick()

    await expect(adapter.scope.set('publicBaseUrl', 'https://new')).resolves.toBeUndefined()
    expect(adapter.scope.getSnapshot()).toEqual({ status: 'ready', value: { publicBaseUrl: 'https://held' } })
    expect(warn).toHaveBeenCalled()
  })

  it('refreshes on the forwarded document event for its own namespace only', async () => {
    const modern = modernDouble([
      { ok: true, value: { namespaces: [{ ns: 'dsh-palm', value: { enabled: false }, revision: 1 }] } },
      { ok: true, value: { namespaces: [{ ns: 'dsh-palm', value: { enabled: true }, revision: 2 }] } },
    ])
    const ctx = fakeContext({ services: { 'remote.settings': modern.api, remote: modern.remote } })
    const adapter = primedAdapter<{ enabled?: boolean }>(ctx)
    await tick()
    expect(adapter.scope.getSnapshot().value).toEqual({ enabled: false })

    const observed: number[] = []
    adapter.scope.subscribe(() => { observed.push(modern.calls.describe) })
    modern.emitDocumentUpdate('some-other-namespace', 5)
    await tick()
    expect(modern.calls.describe).toBe(1)
    expect(observed).toEqual([])

    modern.emitDocumentUpdate('dsh-palm', 2)
    await tick()
    expect(modern.calls.describe).toBe(2)
    expect(observed).toEqual([2])
    expect(adapter.scope.getSnapshot().value).toEqual({ enabled: true })
  })

  it('upgrades to the modern namespace when the service arrives after the first access', async () => {
    const modern = modernDouble([{
      ok: true,
      value: { namespaces: [{ ns: 'dsh-palm', value: { enabled: false }, revision: 4 }] },
    }])
    const services: Record<string, unknown> = { remote: modern.remote }
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
    const ctx = fakeContext({
      services,
      on: (event, listener) => {
        const group = listeners.get(event) ?? []
        group.push(listener)
        listeners.set(event, group)
        return () => {}
      },
    })
    const adapter = createRemoteSettingsAdapter<{ enabled?: boolean }>(ctx, 'dsh-palm')

    // Neither service yet: the handle degrades instead of parking the plugin.
    expect(adapter.backend()).toBe('none')
    expect(adapter.scope.getSnapshot()).toEqual({ status: 'unavailable' })

    const observed: string[] = []
    adapter.scope.subscribe(() => { observed.push('changed') })

    // The shell mounts the modern namespace: the adapter upgrades promptly and
    // republishes, so the sidebar entry re-syncs without a page reload.
    services['remote.settings'] = modern.api
    for (const listener of listeners.get('internal/service') ?? []) listener('remote.settings', modern.api)
    expect(observed).toEqual(['changed'])
    expect(adapter.backend()).toBe('remote.settings')

    await tick()
    expect(adapter.scope.getSnapshot()).toEqual({ status: 'ready', value: { enabled: false } })

    // An unrelated service must not trigger a re-resolve.
    for (const listener of listeners.get('internal/service') ?? []) listener('unrelated', undefined)
    expect(adapter.backend()).toBe('remote.settings')
  })

  it('releases the forwarded-event subscription on dispose', async () => {
    const modern = modernDouble([{
      ok: true,
      value: { namespaces: [{ ns: 'dsh-palm', value: { enabled: true }, revision: 1 }] },
    }])
    const ctx = fakeContext({ services: { 'remote.settings': modern.api, remote: modern.remote } })
    const adapter = primedAdapter<{ enabled?: boolean }>(ctx)
    await tick()

    adapter.dispose()
    expect(modern.calls.released).toBe(1)

    const before = modern.calls.describe
    modern.emitDocumentUpdate('dsh-palm', 9)
    await tick()
    expect(modern.calls.describe).toBe(before)
  })

  it('degrades without throwing when neither settings service exists', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const adapter = createRemoteSettingsAdapter<{ enabled?: boolean; publicBaseUrl?: string }>(fakeContext(), 'dsh-palm')

    expect(adapter.backend()).toBe('none')
    expect(adapter.scope.getSnapshot()).toEqual({ status: 'unavailable' })
    await expect(adapter.scope.set('publicBaseUrl', 'https://new')).resolves.toBeUndefined()
    await expect(adapter.scope.unset('publicBaseUrl')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(2)
    adapter.dispose()
  })
})

describe('apply on the modern settings shell', () => {
  /** Recording client context: slots, locale, and the modern settings API. */
  function applyContext(modern: ReturnType<typeof modernDouble>) {
    const entries: Array<{ inject: () => Record<string, unknown> }> = []
    const disposed: string[] = []
    const services: Record<string, unknown> = {
      connection: { isLoopback: true },
      'remote.settings': modern.api,
      remote: modern.remote,
    }
    const ctx = {
      effect: (factory: () => unknown) => factory(),
      locale: { register: () => () => {}, bind: () => (key: string) => key },
      slots: {
        inject: (_key: string, factory?: () => unknown) => { factory?.(); return () => {} },
        register: (options: { inject: () => Record<string, unknown> }) => {
          entries.push(options)
          return () => { disposed.push('entry') }
        },
      },
      get: (name: string) => services[name],
    }
    return { ctx, entries, disposed }
  }

  it('registers the sidebar entry immediately and persists the public URL through mutate', async () => {
    const modern = modernDouble(
      [{ ok: true, value: { namespaces: [{ ns: 'dsh-palm', value: { enabled: true }, revision: 5 }] } }],
      [{ ok: true, value: { ns: 'dsh-palm', value: { publicBaseUrl: 'https://new' }, revision: 6 } }],
    )
    const { ctx, entries } = applyContext(modern)
    expect(() => apply(ctx as never)).not.toThrow()
    expect(entries).toHaveLength(1)

    await tick()
    const props = entries[0]!.inject()
    await (props.onSavePublicUrl as (url: string) => Promise<void>)('https://new')
    // The revision read by the document mirror fences the write, so a stale
    // editor is refused by the Host instead of silently overwriting it.
    expect(modern.calls.mutate).toEqual([{
      ns: 'dsh-palm',
      ops: [{ op: 'set', path: ['publicBaseUrl'], value: 'https://new' }],
      revision: 5,
    }])
    expect(entries).toHaveLength(1)
  })

  it('writes unconditionally when the URL is saved before the first read lands', async () => {
    // The 0.1.5 binder had no revision fence at all, so an early write going
    // out unrevisioned is the faithful behavior; the retry below still
    // recovers from a refusal.
    const modern = modernDouble(
      [{ ok: true, value: { namespaces: [{ ns: 'dsh-palm', value: { enabled: true }, revision: 5 }] } }],
      [{ ok: true, value: { ns: 'dsh-palm', value: { publicBaseUrl: 'https://new' }, revision: 6 } }],
    )
    const { ctx, entries } = applyContext(modern)
    apply(ctx as never)

    const props = entries[0]!.inject()
    await (props.onClearPublicUrl as () => Promise<void>)()
    expect(modern.calls.mutate).toEqual([{
      ns: 'dsh-palm',
      ops: [{ op: 'unset', path: ['publicBaseUrl'] }],
      revision: undefined,
    }])
  })

  it('follows the enabled setting published by the modern document', async () => {
    const modern = modernDouble([
      { ok: true, value: { namespaces: [{ ns: 'dsh-palm', value: { enabled: false }, revision: 1 }] } },
      { ok: true, value: { namespaces: [{ ns: 'dsh-palm', value: { enabled: true }, revision: 2 }] } },
    ])
    const { ctx, entries, disposed } = applyContext(modern)
    apply(ctx as never)
    expect(entries).toHaveLength(1)

    await tick()
    expect(disposed).toEqual(['entry'])

    modern.emitDocumentUpdate('dsh-palm', 2)
    await tick()
    expect(entries).toHaveLength(2)
  })

  it('degrades on a shell with no settings service at all', () => {
    const entries: unknown[] = []
    const ctx = {
      effect: (factory: () => unknown) => factory(),
      locale: { register: () => () => {}, bind: () => (key: string) => key },
      slots: {
        inject: (_key: string, factory?: () => unknown) => { factory?.(); return () => {} },
        register: (options: unknown) => { entries.push(options); return () => {} },
      },
      get: (name: string) => (name === 'connection' ? { isLoopback: true } : undefined),
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(() => apply(ctx as never)).not.toThrow()
    // `unavailable` counts as enabled, so the pairing entry still appears.
    expect(entries).toHaveLength(1)
    expect(warn).not.toHaveBeenCalled()
  })
})

/** Context double exposing only the legacy property (no store lookup). */
function ctxWithoutGet(settingsScope: unknown): unknown {
  return { settingsScope }
}
