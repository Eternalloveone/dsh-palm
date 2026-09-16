/**
 * Opt-in end-to-end performance instrumentation for the mobile surface.
 *
 * Everything here is a no-op unless the user enables it (`localStorage
 * dsh.palm.perf = "1"`, or `?perf=1` in the URL). When disabled no observers
 * are registered and each call costs a single localStorage read. When enabled
 * the module:
 *
 *  - stamps the hot path with lightweight marks (receive → decode → state →
 *    commit, see the anchor call sites) into a bounded ring buffer;
 *  - samples frame cadence with requestAnimationFrame and reports long
 *    frames, plus the browser's own Long Tasks (>50ms) — each entry flagged
 *    when it BEGAN inside a hidden window, because that is process suspension
 *    rather than jank, which is the difference between "the app stuttered" and
 *    "the phone froze us" (the 12.5s toCommit outlier is exactly that case);
 *  - counts SSE anomalies the transport layer already knows about
 *    (seq gaps, poll refills — counters fed by mux / ChatView);
 *  - carries the always-on error ring (mobile/errors.ts) and the storage
 *    picture (mobile/storage.ts) inside every capture, so one report answers
 *    "how slow was it" and "did it break" together;
 *  - exposes window.__dshPalmPerf = { toJSON, stats, clear, refresh } so a phone
 *    or a Playwright/CDP run can export one session's measurements.
 *
 * Timings are deliberately NOT asserted in vitest (timing tests flake under
 * load). The structural guarantees (no-op when off, bounded buffer, export
 * shape) are covered by perf.test.ts instead.
 * @module dsh-palm/mobile/perf
 */

import { errorClear, errorStats, type ErrorKind, type ErrorRecord } from './errors.ts'
import { storageInfo, type StorageInfo } from './storage.ts'

/** Storage key that arms the instrumentation. */
export const PERF_KEY = 'dsh.palm.perf'

/** Bounded ring capacity for event marks (older entries drop off). */
export const PERF_RING_CAP = 2048

interface PerfStamp {
  /** performance.now() at the mark (ms). */
  t: number
  /** Stage name: recv | decode | state | commit | other. */
  stage: string
  /** Event seq when the mark belongs to a session/event (else undefined). */
  seq?: number
  /** Frame type (session/event, session/jobs, …). */
  frame?: string
  /** Free-form detail (e.g. turn/step for tool steps). */
  detail?: string
}

/** One SSE anomaly the transport noticed. */
export interface PerfAnomaly {
  kind: 'seq-gap' | 'poll-refill' | 'poll-backoff' | 'stream-error'
  at: number
  detail?: string
}

const stamps: PerfStamp[] = []
const anomalies: PerfAnomaly[] = []
/** Per-seq receive time, so decode/state/commit spans can be derived. */
const recvBySeq = new Map<number, number>()

/** Cached switch state; null = not yet evaluated (see {@link armed}). */
let armedCache: boolean | null = null

function computeArmed(): boolean {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(PERF_KEY) === '1') return true
  } catch { /* storage unavailable */ }
  if (typeof location !== 'undefined' && /\bperf=1\b/.test(location.search)) return true
  return false
}

function armed(): boolean {
  // Cache the switch so the hot path is a single null-check + return instead
  // of a localStorage read + regex on every frame. Call perfRefresh() after
  // toggling the flag (or use the window hook's refresh).
  if (armedCache === null) armedCache = computeArmed()
  return armedCache
}

/** Re-evaluate the perf switch (call after toggling localStorage / URL). */
export function perfRefresh(): void {
  armedCache = null
}

function pushStamp(stamp: PerfStamp): void {
  if (stamps.length >= PERF_RING_CAP) stamps.shift()
  stamps.push(stamp)
  if (stamp.stage === 'recv' && stamp.seq !== undefined) {
    if (recvBySeq.size >= 512) recvBySeq.clear()
    recvBySeq.set(stamp.seq, stamp.t)
  }
}

/** True when the perf switch is on. */
export function perfEnabled(): boolean {
  return armed()
}

/** Mark one stage boundary. Call sites use performance.now() deltas. */
export function perfMark(stage: string, options: { seq?: number; frame?: string; detail?: string } = {}): void {
  if (!armed()) return
  pushStamp({ t: performance.now(), stage, seq: options.seq, frame: options.frame, detail: options.detail })
}

/** Record a transport anomaly (gap / refill / backoff / error). */
export function perfAnomaly(kind: PerfAnomaly['kind'], detail?: string): void {
  if (!armed()) return
  anomalies.push({ kind, at: performance.now(), detail })
  if (anomalies.length > 256) anomalies.shift()
}

/* ── long tasks + process suspension (armed only) ───────────────────── */

/** Newest-first ring of Long Task entries. */
export const LONG_TASK_RING_CAP = 64

export interface LongTaskRecord {
  /** performance.now() at the task's start (same time origin as the marks). */
  at: number
  /** Task duration; the API only reports tasks over 50ms. */
  ms: number
  /** True when the task BEGAN inside a hidden window — see isSuspended(). */
  suspended: boolean
}

const longTasks: LongTaskRecord[] = []
/** Hidden intervals, so a task delivered after the fact is still classifiable. */
const hiddenWindows: Array<{ from: number; to: number }> = []
let hiddenAt: number | null = null
let hiddenMs = 0
let hiddenCount = 0
let longTaskObserver: PerformanceObserver | undefined
let visibilityInstalled = false

function markHidden(now: number): void {
  if (hiddenAt !== null) return
  hiddenAt = now
}

function markVisible(now: number): void {
  if (hiddenAt === null) return
  const from = hiddenAt
  hiddenAt = null
  hiddenMs += Math.max(0, now - from)
  hiddenCount += 1
  hiddenWindows.push({ from, to: now })
  if (hiddenWindows.length > 32) hiddenWindows.shift()
}

/**
 * A task that started while the page was hidden is a suspension artifact, not
 * jank: the process was frozen (a backgrounded phone) and the browser charges the
 * wall-clock gap to whatever was in flight. Separating the two is what makes a
 * `toCommit` outlier attributable instead of mysterious.
 */
function isSuspended(at: number): boolean {
  if (hiddenAt !== null && at >= hiddenAt) return true
  return hiddenWindows.some(window => at >= window.from && at <= window.to)
}

/** Track hidden windows. rAF already stops while hidden; this names the gap. */
function installVisibilityTracking(): void {
  if (visibilityInstalled || typeof document === 'undefined') return
  visibilityInstalled = true
  if (document.hidden) markHidden(performance.now())
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) markHidden(performance.now())
    else markVisible(performance.now())
  })
}

/** Observe Long Tasks where the browser has them (Chromium; not Safari). */
function installLongTaskObserver(): void {
  if (longTaskObserver !== undefined) return
  const Observer = (globalThis as { PerformanceObserver?: typeof PerformanceObserver }).PerformanceObserver
  if (Observer === undefined) return
  try {
    const observer = new Observer((list) => {
      for (const entry of list.getEntries()) {
        longTasks.unshift({ at: entry.startTime, ms: entry.duration, suspended: isSuspended(entry.startTime) })
      }
      if (longTasks.length > LONG_TASK_RING_CAP) longTasks.length = LONG_TASK_RING_CAP
    })
    observer.observe({ entryTypes: ['longtask'] })
    longTaskObserver = observer
  } catch {
    // Unsupported entry type: frame sampling still runs, longTasks stays empty.
    longTaskObserver = undefined
  }
}

/* ── frame cadence sampler (armed only) ─────────────────────────────── */

let samplerRunning = false
let frames = 0
let longFrames = 0
let lastRaf = 0

/** Start rAF sampling. No-op unless armed; idempotent. */
export function startPerfSampler(): void {
  if (samplerRunning || !armed()) return
  samplerRunning = true
  installVisibilityTracking()
  installLongTaskObserver()
  const tick = (now: number): void => {
    if (!armed()) { samplerRunning = false; return }
    if (lastRaf !== 0) {
      const delta = now - lastRaf
      frames += 1
      if (delta > 50) longFrames += 1
    }
    lastRaf = now
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

/* ── export ──────────────────────────────────────────────────────────── */

export interface PerfSnapshot {
  armed: boolean
  capturedAt: string
  marks: PerfStamp[]
  anomalies: PerfAnomaly[]
  frames: { sampled: number; long: number }
  /** recv→state (decode+fold+coalesce) and recv→commit (full client path). */
  spansMs: { state: number[]; commit: number[] }
  /** Long tasks (>50ms), newest first, hidden-window artifacts flagged. */
  longTasks: LongTaskRecord[]
  /** Wall time spent hidden — the interval rAF sampling cannot see. */
  suspension: { hiddenMs: number; hiddenCount: number }
  /** The always-on error ring: errors.ts is NOT gated by this switch. */
  errors: { total: number; kinds: Partial<Record<ErrorKind, number>>; recent: ErrorRecord[] }
  /** Persistent-storage picture (mobile/storage.ts). */
  storage: StorageInfo
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))]!
}

function spanStats(name: string, values: number[]): { name: string; n: number; avg: number; p50: number; p95: number; max: number } {
  if (values.length === 0) return { name, n: 0, avg: 0, p50: 0, p95: 0, max: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  return {
    name,
    n: values.length,
    avg: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 1000) / 1000,
    p50: Math.round(pct(sorted, 0.5) * 1000) / 1000,
    p95: Math.round(pct(sorted, 0.95) * 1000) / 1000,
    max: Math.round(sorted[sorted.length - 1]! * 1000) / 1000,
  }
}

/** One derivable span: from recv (per seq) through a later stage's stamp. */
function spansFor(stage: string): number[] {
  const values: number[] = []
  for (const stamp of stamps) {
    if (stamp.stage !== stage || stamp.seq === undefined) continue
    const start = recvBySeq.get(stamp.seq)
    if (start !== undefined) values.push(Math.max(0, stamp.t - start))
  }
  return values
}

/** Snapshot of everything collected so far. */
export function perfSnapshot(): PerfSnapshot {
  return {
    armed: armed(),
    capturedAt: new Date().toISOString(),
    marks: [...stamps],
    anomalies: [...anomalies],
    frames: { sampled: frames, long: longFrames },
    spansMs: {
      state: spansFor('state'),
      commit: spansFor('commit'),
    },
    longTasks: [...longTasks],
    suspension: { hiddenMs: Math.round(hiddenMs), hiddenCount },
    errors: errorStats(),
    storage: storageInfo(),
  }
}

/** Compact per-stage statistics (the shape report tooling consumes). */
export function perfStats(): Record<string, unknown> {
  const s = perfSnapshot()
  return {
    armed: s.armed,
    marks: s.marks.length,
    anomalies: s.anomalies,
    frames: s.frames,
    spans: {
      toState: spanStats('state', s.spansMs.state),
      toCommit: spanStats('commit', s.spansMs.commit),
    },
    // Suspended entries are counted apart from the statistics on purpose: mixing
    // a frozen process into the jank distribution would invent a regression that
    // no code change caused.
    longTasks: {
      ...spanStats('longTask', s.longTasks.filter(task => !task.suspended).map(task => task.ms)),
      suspended: s.longTasks.filter(task => task.suspended).length,
      recent: s.longTasks.slice(0, 8),
    },
    suspension: s.suspension,
    errors: { total: s.errors.total, kinds: s.errors.kinds, recent: s.errors.recent.slice(0, 5) },
    storage: s.storage,
  }
}

/**
 * Clear all collected data — a fresh measurement window. The always-on error ring
 * is cleared too: a window that still reports failures from before it started
 * would misattribute them.
 */
export function perfClear(): void {
  stamps.length = 0
  anomalies.length = 0
  recvBySeq.clear()
  frames = 0
  longFrames = 0
  lastRaf = 0
  longTasks.length = 0
  hiddenWindows.length = 0
  hiddenAt = null
  hiddenMs = 0
  hiddenCount = 0
  errorClear()
  armedCache = null
}

/* ── window hookup (call once at app boot) ───────────────────────────── */

/** Expose window.__dshPalmPerf so a phone/Playwright run can export data. */
export function installPerfWindowHook(): void {
  if (typeof window === 'undefined') return
  try {
    const api = { toJSON: perfSnapshot, stats: perfStats, clear: perfClear, refresh: perfRefresh }
    ;(window as unknown as Record<string, unknown>).__dshPalmPerf = api
  } catch { /* non-fatal */ }
}
