/**
 * Always-on global error capture for the mobile surface.
 *
 * Deliberately NOT behind the perf switch (`dsh.palm.perf`): the gap this closes
 * is that a white screen or a runtime throw on the phone is invisible — to the
 * user and to whoever they would report it to — and opt-in instrumentation
 * cannot close it. So this runs on every page: two listeners and a bounded
 * array, no network, no storage, no timers.
 *
 * What is kept: the failure kind, a whitespace-collapsed and truncated message,
 * a basename-only location, up to three `file:line:col` stack frames and a repeat
 * count. What is deliberately NOT kept: full stacks (frames can carry argument
 * text), origins, and anything that leaves the device on its own — entries move
 * only when the user sends a perf capture or presses 复制错误 in settings.
 *
 * @module dsh-palm/mobile/errors
 */

/** Newest-first ring of DISTINCT failures; the oldest distinct one drops first. */
export const ERROR_RING_CAP = 20
/** Message ceiling, applied after whitespace collapsing. */
export const ERROR_MESSAGE_MAX = 240
/** Stack frames kept per failure. */
export const ERROR_FRAMES_MAX = 3

export type ErrorKind = 'error' | 'rejection' | 'resource'

export interface ErrorRecord {
  kind: ErrorKind
  message: string
  /** `file.ext:line:col` of the throw site, when the browser reported one. */
  source?: string
  /** Reduced frames — basename:line:col only, no origins, no function names. */
  frames?: string[]
  /** performance.now() at the FIRST occurrence of this failure. */
  at: number
  /** How many times this exact failure has been seen (1 on first sight). */
  count: number
}

const records: ErrorRecord[] = []
let totalCount = 0
let installed = false

/**
 * Sink listeners. Kept as a plain set and never persisted: this is a receiver
 * hook, not storage, networking or a timer — the module's "no network / no
 * storage / no timers" promise is about what CAPTURE triggers, and the reporter
 * that subscribes here owns all of that. A listener must never be able to break
 * capture (see the try/catch in `notifyErrorListeners`).
 */
const listeners = new Set<(record: ErrorRecord) => void>()

/**
 * Subscribe to every recorded failure, including repeat-folds (each fold carries
 * the entry with its latest count, so a reporter sees the escalation, not just
 * the first sight). Returns an unsubscribe that is a no-op after the first call.
 * A throwing listener is swallowed — capture must stay reliable regardless.
 */
export function onErrorRecord(listener: (record: ErrorRecord) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function notifyErrorListeners(record: ErrorRecord): void {
  for (const listener of listeners) {
    try {
      listener(record)
    } catch {
      // A broken listener must not take capture down with it.
    }
  }
}

/** Collapse whitespace and cap the length: one line, never a wall of text. */
function collapse(text: string, max = ERROR_MESSAGE_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

/** `at fn (https://host/a/b/mobile.js:12:34)` → `mobile.js:12:34`. */
function frameOf(line: string): string | undefined {
  const match = /([^\s()/\\]+):(\d+):(\d+)/.exec(line)
  return match === null ? undefined : `${match[1]}:${match[2]}:${match[3]}`
}

function framesFrom(stack: unknown): string[] | undefined {
  if (typeof stack !== 'string') return undefined
  const frames: string[] = []
  // Frame 0 is the message line itself, not a location.
  for (const line of stack.split('\n').slice(1)) {
    const frame = frameOf(line)
    if (frame !== undefined && !frames.includes(frame)) frames.push(frame)
    if (frames.length >= ERROR_FRAMES_MAX) break
  }
  return frames.length === 0 ? undefined : frames
}

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

/**
 * Record one failure. A repeat of an identical failure (same kind, message and
 * source) folds into the existing entry's count and moves it back to the front of
 * the ring: a failure that just happened again is more interesting than one that
 * has been quiet since boot.
 */
export function recordError(input: { kind: ErrorKind; message: string; source?: string; stack?: unknown }): void {
  const message = collapse(input.message === '' ? 'unknown error' : input.message)
  const source = input.source === undefined || input.source === ''
    ? undefined
    : collapse(input.source, 120)
  totalCount += 1
  const seen = records.find(entry =>
    entry.kind === input.kind && entry.message === message && entry.source === source)
  if (seen !== undefined) {
    seen.count += 1
    records.splice(records.indexOf(seen), 1)
    records.unshift(seen)
    notifyErrorListeners(seen)
    return
  }
  const record: ErrorRecord = { kind: input.kind, message, at: now(), count: 1 }
  if (source !== undefined) record.source = source
  const frames = framesFrom(input.stack)
  if (frames !== undefined) record.frames = frames
  records.unshift(record)
  if (records.length > ERROR_RING_CAP) records.length = ERROR_RING_CAP
  notifyErrorListeners(record)
}

/** The ring, newest first. A copy — callers cannot mutate what a capture holds. */
export function errorSnapshot(): ErrorRecord[] {
  return records.map(entry => ({ ...entry, ...(entry.frames === undefined ? {} : { frames: [...entry.frames] }) }))
}

/**
 * The aggregate that rides a perf capture. `total` counts every failure seen,
 * including repeats that folded into one entry, so it answers "how broken is this
 * page" while `recent` answers "what broke".
 */
export function errorStats(): { total: number; kinds: Partial<Record<ErrorKind, number>>; recent: ErrorRecord[] } {
  const kinds: Partial<Record<ErrorKind, number>> = {}
  for (const record of records) kinds[record.kind] = (kinds[record.kind] ?? 0) + record.count
  return { total: totalCount, kinds, recent: errorSnapshot() }
}

/** Drop everything (a fresh measurement window — and the tests). */
export function errorClear(): void {
  records.length = 0
  totalCount = 0
}

/** Anything can be a rejection reason; describe it without ever throwing. */
function describe(reason: unknown): { message: string; stack?: unknown } {
  if (reason instanceof Error) {
    return { message: reason.message === '' ? reason.name : reason.message, stack: reason.stack }
  }
  if (typeof reason === 'string') return { message: reason }
  try {
    const encoded: unknown = JSON.stringify(reason)
    return { message: typeof encoded === 'string' ? encoded : String(reason) }
  } catch {
    // Circular or otherwise unserializable.
    return { message: Object.prototype.toString.call(reason) }
  }
}

/**
 * Attach the global listeners (idempotent, safe on any platform).
 *
 * Capture phase on purpose: `error` does not bubble, so a capture-phase listener
 * on window is also what sees a failed `<img>`/`<script>` load — the other half of
 * "the page looks broken and nothing says why".
 */
export function installErrorCapture(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (event: ErrorEvent) => {
    const target: unknown = event.target
    const tagName = (target as { tagName?: unknown } | null | undefined)?.tagName
    if (target !== null && target !== undefined && tagName !== undefined && typeof tagName === 'string') {
      const element = target as HTMLElement & { src?: string; href?: string }
      const url = (element.src ?? element.href ?? '').split(/[?#]/)[0] ?? ''
      const tail = url.split('/').pop() ?? ''
      recordError({
        kind: 'resource',
        message: `${tagName.toLowerCase()} 加载失败`,
        source: tail === '' ? undefined : tail,
      })
      return
    }
    const error = event.error as { stack?: unknown } | null | undefined
    // `event.filename` is a FULL URL; `source` must stay basename-only — that is
    // this module's privacy promise ("a basename-only location", see the header)
    // and exactly what the host intake accepts (it rejects any path separator).
    // Letting the URL through would both leak the origin into a report and be
    // refused on arrival. frameOf() keeps the tail:
    // "https://host:3080/m/mobile.js:12:34" → "mobile.js:12:34".
    const where = event.filename === undefined || event.filename === ''
      ? undefined
      : frameOf(`${event.filename}:${event.lineno ?? 0}:${event.colno ?? 0}`)
    recordError({
      kind: 'error',
      message: event.message ?? '',
      source: where,
      stack: error?.stack,
    })
  }, true)
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const described = describe(event.reason)
    recordError({ kind: 'rejection', message: described.message, stack: described.stack })
  })
}
