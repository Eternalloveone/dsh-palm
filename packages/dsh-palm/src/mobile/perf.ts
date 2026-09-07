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
 *    frames (the browser's own Long Tasks where supported);
 *  - counts SSE anomalies the transport layer already knows about
 *    (seq gaps, poll refills — counters fed by mux / ChatView);
 *  - exposes window.__dshPalmPerf = { toJSON, toCSV, clear } so a phone or a
 *    Playwright/CDP run can export one session's measurements.
 *
 * Timings are deliberately NOT asserted in vitest (timing tests flake under
 * load). The structural guarantees (no-op when off, bounded buffer, export
 * shape) are covered by perf.test.ts instead.
 * @module dsh-palm/mobile/perf
 */

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

/* ── frame cadence sampler (armed only) ─────────────────────────────── */

let samplerRunning = false
let frames = 0
let longFrames = 0
let lastRaf = 0

/** Start rAF sampling. No-op unless armed; idempotent. */
export function startPerfSampler(): void {
  if (samplerRunning || !armed()) return
  samplerRunning = true
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
  }
}

/** Clear all collected data (start a fresh measurement window). */
export function perfClear(): void {
  stamps.length = 0
  anomalies.length = 0
  recvBySeq.clear()
  frames = 0
  longFrames = 0
  lastRaf = 0
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
