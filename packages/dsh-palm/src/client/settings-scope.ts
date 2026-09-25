/**
 * Client settings-namespace seam: one structural handle over the two
 * incompatible client settings services a DSH upgrade split apart.
 *
 * DSH 0.1.5 exposes `ctx.settingsScope` — a binder whose per-namespace handle
 * answers synchronously (`getSnapshot` / `subscribe` / `set` / `unset`). DSH
 * 0.1.6+ replaced it with `ctx.remote.settings`, an async Remote namespace
 * (`describe()` / `mutate()` plus the forwarded `settings/document-updated`
 * event); no `settingsScope` remains anywhere in the shell.
 *
 * Neither name may appear in this plugin's static `inject`: a service that a
 * shell does not provide parks the plugin forever, so the pairing surface
 * would never activate on the other line. Both names are resolved at runtime
 * through the non-strict `ctx.get(name, false)` — which answers `undefined`
 * instead of parking (cordis `ReflectService.get`) — and the resolved backend
 * is presented through the 0.1.5-shaped {@link SettingsScopeLike} seam, so the
 * pairing surface keeps exactly one code path and one read/write semantic.
 *
 * Nothing below imports a DSH type: every face is narrowed structurally, so
 * this module compiles against the 0.1.5 SDK while running against either
 * shell.
 */

/** Snapshot of one settings namespace, shaped as the 0.1.5 binder answers it. */
export interface SettingsScopeSnapshot<T> {
  /**
   * `loading` while a first answer is pending, `ready` once a value is held,
   * `unavailable` when no settings surface can answer at all.
   */
  status: 'loading' | 'ready' | 'unavailable'
  /** The namespace section; present only while `ready`. */
  value?: T
}

/**
 * Minimal settings-namespace face. The full binder lives in
 * `@deepseek-ai/dsh-client-ui-settings`; the pairing surface needs bind /
 * getSnapshot / subscribe / set / unset, typed structurally against the
 * section shape it saves.
 */
export interface SettingsScopeLike<T> {
  getSnapshot(): SettingsScopeSnapshot<T>
  subscribe(callback: () => void): () => void
  set(key: keyof T & string, value: string | boolean): Promise<void>
  unset(key: keyof T & string): Promise<void>
}

/** The 0.1.5 client service: bind one namespace to its synchronous handle. */
export interface SettingsScopeBinderLike {
  bind<T>(spec: { namespace: string }): SettingsScopeLike<T>
}

/**
 * A namespace handle that also owns backend subscriptions. The modern backend
 * listens on the forwarded-event carrier, so it needs a teardown the 0.1.5
 * face has no place for; {@link RemoteSettingsAdapter.dispose} drives it.
 */
export interface DisposableSettingsScope<T> extends SettingsScopeLike<T> {
  /** Release the backend subscriptions this handle opened. */
  dispose(): void
}

/** Which client settings service a namespace handle is reading and writing. */
export type SettingsBackend = 'remote.settings' | 'settingsScope' | 'none'

/** One resolved backend: the handle plus the service name it came from. */
interface ResolvedScope<T> {
  readonly backend: SettingsBackend
  readonly scope: SettingsScopeLike<T>
  /** Release whatever the backend subscribed to; idempotent. */
  readonly release: () => void
}

/**
 * The adapter handed to the pairing surface: one stable handle (resolved
 * lazily, upgraded when a service arrives late) plus the backend it currently
 * uses.
 */
export interface RemoteSettingsAdapter<T> {
  /** The stable handle; safe to keep across a backend upgrade. */
  readonly scope: SettingsScopeLike<T>
  /** The backend in use right now; `none` means neither service is present. */
  readonly backend: () => SettingsBackend
  /** Release the forwarded-event subscription, if one was opened. */
  readonly dispose: () => void
}

// --- Modern face (0.1.6+). Every member is JSON over the Remote boundary. ---

/** `RemoteResult<T>`: the envelope every generated Remote method answers with. */
interface RemoteResultLike<T> {
  readonly ok?: boolean
  readonly value?: T
  readonly error?: { readonly message?: string }
}

/** One row of a `settings.describe()` answer (redacted namespace view). */
interface SettingsNamespaceViewLike {
  readonly ns?: string
  /** Redacted resolved value: schema defaults → composition base → user layer. */
  readonly value?: unknown
  /** Monotonic revision of the raw user section this view was read at. */
  readonly revision?: number
}

/** The full `settings.describe()` answer. */
interface SettingsDescribeValueLike {
  readonly namespaces?: readonly SettingsNamespaceViewLike[]
}

/**
 * One path-addressed edit. `set` writes at the path (creating intermediate
 * objects), `unset` removes it; the pairing surface only writes top-level keys.
 */
interface SettingsPathOpLike {
  readonly op: 'set' | 'unset'
  readonly path: readonly string[]
  readonly value?: unknown
}

/** The generated `ctx.remote.settings` namespace, narrowed to what is used. */
interface RemoteSettingsLike {
  describe(): Promise<RemoteResultLike<SettingsDescribeValueLike>>
  mutate(
    namespace: string,
    ops: readonly SettingsPathOpLike[],
    expectedRevision: number | undefined,
  ): Promise<RemoteResultLike<SettingsNamespaceViewLike>>
}

/** The forwarded-event face of the `remote` service (`ctx.remote.$on`). */
interface RemoteEventsLike {
  $on?: (event: string, listener: (...args: unknown[]) => void) => (() => void) | void
}

/**
 * Structural view of the client context this adapter reads. Every member is
 * optional: the shell provides `get` / `on`, and a plain test double may hang
 * the legacy binder straight off the context instead.
 */
interface AdapterContext {
  get?: (name: string, strict?: boolean) => unknown
  on?: (event: string, listener: (...args: unknown[]) => void) => (() => void) | void
  /** Legacy (0.1.5) service, reachable as a plain context property. */
  settingsScope?: SettingsScopeBinderLike
  /** Modern (0.1.6+) services, reachable as plain context properties. */
  remote?: (RemoteEventsLike & { settings?: RemoteSettingsLike }) | undefined
}

/** Services whose arrival can upgrade a namespace handle resolved as `none`. */
const WATCHED_SERVICES = new Set(['remote.settings', 'settingsScope'])

/** Report a degraded settings write without breaking the pairing surface. */
function warn(message: string): void {
  try {
    console.warn(`dsh-palm: ${message}`)
  } catch {
    // A shell without console must not fail a settings write.
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Read one service through the non-strict store lookup (never parks). */
function readService(ctx: AdapterContext, name: string): unknown {
  if (typeof ctx.get !== 'function') return undefined
  try {
    return ctx.get(name, false)
  } catch {
    return undefined
  }
}

/** Read one context member, tolerating a shell that does not expose it. */
function readProperty(ctx: AdapterContext, name: 'settingsScope' | 'remote'): unknown {
  try {
    return ctx[name]
  } catch {
    return undefined
  }
}

function isBinder(value: unknown): value is SettingsScopeBinderLike {
  return typeof (value as SettingsScopeBinderLike | undefined)?.bind === 'function'
}

function isRemoteSettings(value: unknown): value is RemoteSettingsLike {
  const candidate = value as RemoteSettingsLike | undefined
  return typeof candidate?.describe === 'function' && typeof candidate?.mutate === 'function'
}

function isRemoteEvents(value: unknown): value is RemoteEventsLike {
  return typeof (value as RemoteEventsLike | undefined)?.$on === 'function'
}

/**
 * One modern namespace handle: an async Remote namespace projected onto the
 * synchronous 0.1.5 face.
 *
 * The Remote reads are async while `getSnapshot()` must answer synchronously,
 * so the handle holds the last answered section and revision and refreshes
 * them on the forwarded `settings/document-updated` event, on a refused write
 * (a stale revision is re-read before the one retry), and on the first read.
 * The initial status is `unavailable` rather than `loading` on purpose: the
 * only consumer effect of an unanswered snapshot is that the sidebar entry
 * stays hidden, and the pairing surface must never disappear because a first
 * Remote read is slow. A landed answer upgrades the handle to `ready`.
 * @param api - the generated `remote.settings` namespace.
 * @param namespace - the settings namespace this handle owns.
 * @param events - the `remote` service, for the document-update subscription.
 * @returns the handle, shaped as the 0.1.5 binder answers.
 */
export function createRemoteSettingsScope<T>(
  api: RemoteSettingsLike,
  namespace: string,
  events?: RemoteEventsLike,
): DisposableSettingsScope<T> {
  let status: SettingsScopeSnapshot<T>['status'] = 'unavailable'
  let value: T | undefined
  let revision: number | undefined
  /**
   * Bumped by every write: a `describe()` that went out before a write
   * committed must not publish its stale section over the write's answer.
   */
  let generation = 0
  const listeners = new Set<() => void>()

  const emit = (): void => {
    for (const listener of [...listeners]) listener()
  }

  /** Publish a held section; the caller decides whether it is an upgrade. */
  const hold = (section: T, nextRevision: number | undefined): void => {
    value = section
    if (typeof nextRevision === 'number') revision = nextRevision
    status = 'ready'
    emit()
  }

  /** Fold one namespace row (from `describe` or a write answer) into the handle. */
  const holdRow = (row: SettingsNamespaceViewLike | undefined): void => {
    if (row === undefined) return
    if (row.ns !== undefined && row.ns !== namespace) return
    hold((row.value ?? {}) as T, row.revision)
  }

  /** Re-read the document; a failure keeps the held section serving. */
  const refresh = async (): Promise<void> => {
    const at = generation
    try {
      const response = await api.describe()
      if (at !== generation) return
      if (response?.ok !== true) {
        if (value === undefined) status = 'unavailable'
        return
      }
      const row = (response.value?.namespaces ?? []).find(candidate => candidate?.ns === namespace)
      if (row === undefined) {
        // The namespace is not registered (yet): the section is empty, which
        // still answers `ready` so the entry follows the plugin's default.
        hold({} as T, undefined)
        return
      }
      holdRow(row)
    } catch {
      if (value === undefined) status = 'unavailable'
    }
  }

  /**
   * Apply one write, retrying once against a re-read revision. A refusal or a
   * transport failure resolves rather than rejects: the pairing surface shows
   * the address it already minted and must not be torn down by a settings
   * write the shell could not take.
   */
  const write = async (ops: SettingsPathOpLike[]): Promise<void> => {
    generation += 1
    try {
      let response = await api.mutate(namespace, ops, revision)
      if (response?.ok !== true) {
        await refresh()
        response = await api.mutate(namespace, ops, revision)
      }
      if (response?.ok !== true) {
        warn(`settings write refused (${response?.error?.message ?? 'unknown cause'})`)
        return
      }
      holdRow(response.value)
    } catch (error) {
      warn(`settings write failed: ${messageOf(error)}`)
    }
  }

  // The forwarded event carries `(ns, revision)` for the namespace whose raw
  // user section changed, so another namespace's edit is ignored.
  let unsubscribeEvents: () => void = () => {}
  if (isRemoteEvents(events)) {
    try {
      const off = events.$on?.('settings/document-updated', (...args: unknown[]) => {
        const updated = args[0]
        if (updated !== undefined && updated !== namespace) return
        const nextRevision = args[1]
        if (typeof nextRevision === 'number') revision = nextRevision
        void refresh()
      })
      if (typeof off === 'function') unsubscribeEvents = off
    } catch {
      // No forwarded-event carrier: writes still refresh through their answers.
    }
  }

  void refresh()

  return {
    getSnapshot(): SettingsScopeSnapshot<T> {
      return status === 'ready' ? { status, value } : { status }
    },
    subscribe(callback: () => void): () => void {
      listeners.add(callback)
      return () => { listeners.delete(callback) }
    },
    set(key: keyof T & string, next: string | boolean): Promise<void> {
      return write([{ op: 'set', path: [key], value: next }])
    },
    unset(key: keyof T & string): Promise<void> {
      return write([{ op: 'unset', path: [key] }])
    },
    dispose(): void {
      unsubscribeEvents()
      unsubscribeEvents = () => {}
    },
  }
}

/**
 * The stable handle the pairing surface keeps. It resolves the shell's backend
 * on first use, upgrades when a service arrives after this plugin's `apply`,
 * and answers the degraded snapshot (`unavailable`, writes swallowed) while
 * neither service exists — the shell may mount the settings namespace later
 * than the pairing surface, since the two no longer share an `inject` edge.
 */
class DelegatingSettingsScope<T> implements SettingsScopeLike<T> {
  private inner: SettingsScopeLike<T> | undefined
  private innerBackend: SettingsBackend = 'none'
  private innerDispose: (() => void) | undefined
  private readonly listeners = new Set<() => void>()

  /** @param resolve - re-reads the shell's services for one backend. */
  constructor(private readonly resolve: () => ResolvedScope<T> | undefined) {}

  /** @returns the backend in use now; resolves the shell's services if unset. */
  backend(): SettingsBackend {
    this.ensure()
    return this.innerBackend
  }

  /**
   * Re-read the shell's services after one arrived. Only an unresolved handle
   * upgrades: a shell that provides one line's service never provides the
   * other's, and a resolved backend is never swapped under its subscribers.
   */
  invalidate(): void {
    if (this.inner !== undefined) return
    this.ensure()
  }

  /** @returns the resolved backend, binding it on first use. */
  private ensure(): SettingsScopeLike<T> | undefined {
    if (this.inner !== undefined) return this.inner
    const resolved = this.resolve()
    if (resolved === undefined) return undefined
    this.inner = resolved.scope
    this.innerBackend = resolved.backend
    const unsubscribe = resolved.scope.subscribe(() => { this.notify() })
    this.innerDispose = () => {
      unsubscribe()
      resolved.release()
    }
    // The pairing surface may have read the degraded snapshot before this
    // upgrade landed; republish so the entry and the runtime sync re-run.
    this.notify()
    return this.inner
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }

  getSnapshot(): SettingsScopeSnapshot<T> {
    return this.ensure()?.getSnapshot() ?? { status: 'unavailable' }
  }

  subscribe(callback: () => void): () => void {
    this.listeners.add(callback)
    return () => { this.listeners.delete(callback) }
  }

  /** @returns settlement of the write, or of the degrade when unresolved. */
  async set(key: keyof T & string, value: string | boolean): Promise<void> {
    const scope = this.ensure()
    if (scope === undefined) {
      warn(`settings service unavailable; "${key}" was not saved`)
      return
    }
    await scope.set(key, value)
  }

  /** @returns settlement of the clear, or of the degrade when unresolved. */
  async unset(key: keyof T & string): Promise<void> {
    const scope = this.ensure()
    if (scope === undefined) {
      warn(`settings service unavailable; "${key}" was not cleared`)
      return
    }
    await scope.unset(key)
  }

  /** Release the resolved backend's subscriptions. */
  dispose(): void {
    this.innerDispose?.()
    this.innerDispose = undefined
  }
}

/**
 * Resolve one line's settings service, preferring the modern namespace. Both
 * names are read non-strictly, and the legacy binder is also reachable as a
 * plain context property so a shell (or a test double) that hangs it there
 * keeps working.
 * @param ctx - the client context, structurally narrowed.
 * @param namespace - the settings namespace to bind.
 * @returns the backend and its handle, or `undefined` when neither exists.
 */
function resolveScope<T>(ctx: AdapterContext, namespace: string): ResolvedScope<T> | undefined {
  const remote = readService(ctx, 'remote') ?? readProperty(ctx, 'remote')
  const modern = readService(ctx, 'remote.settings') ?? (remote as { settings?: unknown } | undefined)?.settings
  if (isRemoteSettings(modern)) {
    const scope = createRemoteSettingsScope<T>(modern, namespace, isRemoteEvents(remote) ? remote : undefined)
    return { backend: 'remote.settings', scope, release: () => { scope.dispose() } }
  }

  const legacy = readService(ctx, 'settingsScope') ?? readProperty(ctx, 'settingsScope')
  if (isBinder(legacy)) {
    try {
      return { backend: 'settingsScope', scope: legacy.bind<T>({ namespace }), release: () => {} }
    } catch {
      // A binder that refuses this namespace falls through to the degrade.
    }
  }

  return undefined
}

/**
 * Build the version-agnostic settings handle for one namespace.
 * @param ctx - the client context (typed structurally, never by package).
 * @param namespace - the settings namespace the caller owns.
 * @returns the stable handle, its live backend, and a dispose hook.
 */
export function createRemoteSettingsAdapter<T>(ctx: unknown, namespace: string): RemoteSettingsAdapter<T> {
  const host: AdapterContext = (ctx ?? {}) as AdapterContext
  const delegate = new DelegatingSettingsScope<T>(() => resolveScope<T>(host, namespace))

  // Prompt upgrade for a service the shell provides after this plugin's
  // `apply`: the pairing surface no longer shares an `inject` edge with the
  // settings namespace, so it cannot rely on activation order.
  if (typeof host.on === 'function') {
    try {
      host.on('internal/service', (name: unknown) => {
        if (typeof name !== 'string' || !WATCHED_SERVICES.has(name)) return
        delegate.invalidate()
      })
    } catch {
      // Without the notification the handle still upgrades on its next access.
    }
  }

  return {
    scope: delegate,
    backend: () => delegate.backend(),
    dispose: () => { delegate.dispose() },
  }
}
