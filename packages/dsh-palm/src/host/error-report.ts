/**
 * **host · 错误上报域**（W5-1：从 `mobile-api.ts` 抽出的第二个域）。
 *
 * 这块管的是"手机上报的崩溃/错误怎么验证、怎么落盘、什么情况下才推送到通知渠道"。
 * 原来它散在 5,000 行的 RPC 分发文件里，而它其实**与 RPC 分发无关**——验证、指纹、
 * 去重冷却、落盘裁剪都是纯逻辑，单独存在才好测。
 *
 * 语义没变：**同一指纹一小时内只推一次**（冷却），落盘保留 {@link ERROR_REPORT_KEEP} 份。
 *
 * @module dsh-palm/host/error-report
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { appendProbeLog } from './probe-log.ts'
import type { NotifyEvent, NotifyService } from '../notify/notify-engine.ts'

export const ERROR_REPORT_KEEP = 20
/** Size ceiling for one report's JSON body (a probe or a client bug past this). */
export const ERROR_REPORT_BYTES_MAX = 64 * 1024

/**
 * Message ceiling, mirroring the client ring (`errors.ts` ERROR_MESSAGE_MAX).
 * The body ceiling must NOT stand in for this one: a 5 KB "message" cannot have
 * come from the ring, and accepting it would quietly widen the contract the
 * design pinned (≤240 chars, longer is refused).
 */
export const ERROR_MESSAGE_MAX = 240
/** First report of a fingerprint pushes; later pushes wait this long. */
export const ERROR_PUSH_COOLDOWN_MS = 60 * 60 * 1000
/** Allowed report kinds — mirrors the `ErrorKind` union in mobile/errors.ts. */
const ERROR_KINDS = new Set(['error', 'rejection', 'resource'])

/** `file.ext:line:col` with no path separators (basename shape). */
const FRAME_SHAPE = /^[^/\\]+:\d+:\d+$/

/**
 * The identity of a report: `sha256(kind + "\n" + message + "\n" + source)` cut
 * to 8 hex chars. This is the HOST-side spelling of the client ring's dedupe key
 * (kind + message + source, see mobile/errors.ts), so the two ends cannot diverge
 * on "is this the same error".
 */
export function errorFingerprint(report: { kind?: unknown; message?: unknown; source?: unknown; probe?: unknown }): string {
  const kind = String(report.kind ?? '')
  // 探针的指纹只按**探针名**算：message 里带现场读数（lag=28 / localSeq=3703 / frame=…），
  // 读数一变就等于「新错误」，同一件事会反复落盘、反复弹通知（2026-11-16 实测）。
  const probeName = typeof report.probe === 'string' && report.probe !== '' ? `probe:${report.probe}` : ''
  const message = probeName !== '' ? probeName : String(report.message ?? '')
  const source = report.source === undefined ? '' : String(report.source)
  return createHash('sha256').update(`${kind}\n${message}\n${source}`).digest('hex').slice(0, 8)
}

/**
 * Refuse anything that is not a well-formed error report. The phone sends the
 * sanitized shape it ALREADY keeps (no full stack, no origin, no argument text),
 * so a body that cannot be that shape is a client bug or a probe. The frame shape
 * is basename only — any path separator is an attempt to carry a path, and it is
 * refused here AND can never reach the file name.
 * @returns the refusal reason, or undefined when the report looks right.
 */
export function validateErrorReport(report: unknown): string | undefined {
  if (report === null || typeof report !== 'object' || Array.isArray(report)) return '错误报告不是对象'
  const record = report as Record<string, unknown>
  if (!ERROR_KINDS.has(String(record.kind))) return '错误报告 kind 非法'
  if (typeof record.message !== 'string' || record.message === '') return '错误报告缺少 message'
  if (record.message.length > ERROR_MESSAGE_MAX) return '错误报告 message 超过 240 字'
  if (record.source !== undefined) {
    if (typeof record.source !== 'string' || record.source === '') return '错误报告 source 非法'
    if (!FRAME_SHAPE.test(record.source)) return '错误报告 source 不是 file:line:col'
  }
  if (record.frames !== undefined) {
    if (!Array.isArray(record.frames)) return '错误报告 frames 不是数组'
    if (record.frames.length > 3) return '错误报告帧数超过 3 条'
    for (const frame of record.frames) {
      if (typeof frame !== 'string' || !FRAME_SHAPE.test(frame)) return '错误报告帧不是 basename:line:col'
    }
  }
  if (typeof record.count !== 'number' || !Number.isInteger(record.count) || record.count < 1) return '错误报告 count 非法'
  // The whole-report ceiling is still enforced: a frame string is a basename
  // shape but has no length bound of its own.
  if (Buffer.byteLength(JSON.stringify(report)) > ERROR_REPORT_BYTES_MAX) return '错误报告超过体积上限'
  return undefined
}

/**
 * Write one report into `dir` and return its absolute path.
 *
 * The file name is built HERE — clock and the fingerprint — so nothing from the
 * wire can steer a path: the fingerprint is 8 hex chars and the clock is the
 * host's own. Reports are pruned to the newest {@link ERROR_REPORT_KEEP}, and
 * the fingerprint rides the name so the intake can tell whether it has seen this
 * error before by scanning the directory.
 */
export function writeErrorReport(dir: string, report: unknown, now: number): string {
  mkdirSync(dir, { recursive: true })
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-')
  const fingerprint = errorFingerprint(report as { kind?: unknown; message?: unknown; source?: unknown })
  const file = join(dir, `error-${stamp}-${fingerprint}.json`)
  // 0600: reports are diagnostic detail about the host's own device, not
  // shared documents (the same posture as the devices store and perf captures).
  writeFileSync(file, JSON.stringify(report), { encoding: 'utf8', mode: 0o600 })
  pruneErrorReports(dir, ERROR_REPORT_KEEP)
  return file
}

/** Keep the newest `keep` reports in `dir` (best effort: never throws). */
export function pruneErrorReports(dir: string, keep: number): void {
  try {
    const files = readdirSync(dir).filter(name => name.startsWith('error-') && name.endsWith('.json')).sort()
    for (const stale of files.slice(0, Math.max(0, files.length - keep))) {
      try {
        rmSync(join(dir, stale), { force: true })
      } catch {
        // non-fatal: the next write tries again
      }
    }
  } catch {
    // non-fatal: an unreadable directory must not fail the report
  }
}

/** Whether a report for this fingerprint already sits in `dir`. */
export function errorSeen(dir: string, fingerprint: string): boolean {
  try {
    return readdirSync(dir).some(name => name.endsWith(`-${fingerprint}.json`))
  } catch {
    return false
  }
}

/**
 * The push policy for one report. A fingerprint is pushed on first SIGHT —
 * i.e. only when its report does not already sit in the directory — and even
 * that waits out the 60-minute cooldown since the last push. A fingerprint that
 * already exists is a repeat and is never pushed (it is still written/pruned).
 * The result is a policy, not a delivery guarantee — delivery is best-effort
 * and channel failures never undo the write.
 */
export function errorPushDecision(args: { exists: boolean; lastPushAt: number | undefined; now: number }): { push: boolean; reason: 'first-seen' | 'cooldown' | 'repeat' } {
  if (args.exists) return { push: false, reason: 'repeat' }
  const withinCooldown = args.lastPushAt !== undefined && args.now - args.lastPushAt < ERROR_PUSH_COOLDOWN_MS
  return withinCooldown ? { push: false, reason: 'cooldown' } : { push: true, reason: 'first-seen' }
}

/**
 * Probe kinds that are REAL ALERTS (everything else is evidence).
 *
 * `reportProbe` is the self-diagnostic channel: a record says "this path fired",
 * not "this failed". Probes sit on the recovery path and are usually followed by
 * their own failure signal, so pushing them turned every successful self-heal into
 * a 「手机端出错」 alert plus a `[error]` line the user gets on the phone
 * (2026-11-16: `stream-lag lag=28` at 22:44 recovered by itself).
 *
 * Default is evidence (write to disk, never push, never consume the alert
 * cooldown). Only a probe that means the user LOST something belongs here:
 * `send-no-echo` (their message did not come back) and `turn-duplicate` (the
 * screen shows the same turn twice). Adding a probe must NOT start pushing —
 * that inversion is what made every new probe an alert by accident.
 */
const ALERT_PROBES: readonly string[] = ['send-no-echo', 'turn-duplicate']

/**
 * Browser-generated layout notices: they describe the page's own rendering loop,
 * not a failure of this app, and offer the reader nothing to act on. Chrome and
 * WebKit emit `ResizeObserver loop ...` whenever a delivery pass ends with
 * notifications still pending; it is not an exception and the page stays intact.
 * Matching the stable stem, because browsers differ in the tail
 * ("…notifications." vs "…notifications" / "limit exceeded").
 */
const BENIGN_MESSAGE_STEMS: readonly string[] = ['ResizeObserver loop']

/**
 * Whether a report is evidence only: written to disk (the trail matters), never
 * pushed, never surfaced in a session, and never consuming the cooldown that a
 * real failure's single push needs.
 */
export function isEvidenceOnly(report: { message?: unknown; probe?: unknown }): boolean {
  const probe = report.probe
  if (typeof probe === 'string' && probe !== '') return !ALERT_PROBES.includes(probe)
  const message = String(report.message ?? '')
  return BENIGN_MESSAGE_STEMS.some(stem => message.includes(stem))
}

/** Cooldown clock for error pushes, one per plugin lifetime. */
let lastErrorPushAt: number | undefined = undefined

/** Time-travel/reset seam for the intake unit test (not part of the contract). */
export function resetErrorPushCooldown(): void {
  lastErrorPushAt = undefined
}

/** The in-memory cooldown clock (reads, never mutates). */
function currentCooldown(): number | undefined {
  return lastErrorPushAt
}

/**
 * Push one error report once, reusing the existing L3/L2 delivery. Built as a
 * distinct helper so the intake branch stays thin and the notify capability is
 * optional: when `notify` is absent the intake simply writes and returns — it
 * never constructs a failure out of a missing notifier.
 */
export function pushErrorOnce(notify: NotifyService | undefined, report: { message?: unknown; kind?: unknown }, fingerprint: string): void {
  if (notify === undefined) return
  const message = String(report.message ?? 'unknown error')
  const event: NotifyEvent = {
    id: `error-${fingerprint}`,
    kind: 'task-failed',
    title: '手机端出错',
    body: `[${String(report.kind ?? 'error')}] ${message.slice(0, 120)}`,
    sessionId: '',
    ts: Date.now(),
  }
  // Route the report through the engine so it reaches the inbox and the
  // delivery telemetry too; going straight to the channel functions meant a
  // failed report was invisible everywhere except the host log.
  notify.engine.publish(event)
}

/**
 * The intake branch for `mobile.error`: validate → write (which prunes) →
 * decide whether to push on first sight (cooldown-gated) → report the verdict.
 * `exists` is computed BEFORE the write (a first sight of a fingerprint must see
 * the pre-write directory), so the sequence is read-exists → write → push. The
 * cooldown clock is the module-level in-memory value, one per plugin lifetime;
 * `resetCooldown` is a test-only seam to bring it back to a known state.
 */
export function ingestErrorReport(input: {
  dir: string
  /** 探针日志目录：给了就写 `probe-*.jsonl`，不给退回旧行为（写错误目录、不推送）。 */
  probeDir?: string
  report: unknown
  notify: NotifyService | undefined
  now: number
  hasSeen?: (dir: string, f: string) => boolean
  push?: (n: NotifyService | undefined, r: { message?: unknown; kind?: unknown }, f: string) => void
}): { file: string; bytes: number; pushed: boolean } {
  const fingerprint = errorFingerprint(input.report as { kind?: unknown; message?: unknown; source?: unknown })
  const exists = (input.hasSeen ?? errorSeen)(input.dir, fingerprint)
  // Evidence-only reports still land on disk, but never push: a recovery step that
  // worked on its own is not an incident, and a benign layout notice is not a bug.
  const decision = isEvidenceOnly(input.report as { message?: unknown; probe?: unknown })
    ? { push: false as const, reason: 'evidence' as const }
    : errorPushDecision({ exists, lastPushAt: currentCooldown(), now: input.now })
  const probeName = (input.report as { probe?: unknown } | null)?.probe
  // 探针 = 日志：按天追加到 probe-*.jsonl，不进错误目录、不推送、不占冷却。
  if (decision.reason === 'evidence' && typeof probeName === 'string' && probeName !== '' && input.probeDir !== undefined) {
    const logged = appendProbeLog(input.probeDir, input.report, input.now)
    if (logged !== undefined) {
      return { file: logged, bytes: Buffer.byteLength(JSON.stringify(input.report)), pushed: false }
    }
    // 日志写不进去就退回错误目录（至少留下现场），但仍然不推送。
  }
  const file = writeErrorReport(input.dir, input.report, input.now)
  if (decision.push) {
    lastErrorPushAt = input.now
    ;(input.push ?? pushErrorOnce)(input.notify, input.report as { message?: unknown; kind?: unknown }, fingerprint)
  }
  return { file, bytes: Buffer.byteLength(JSON.stringify(input.report)), pushed: decision.push }
}

/**
 * Minimal command-registry surface the mobile directory needs. The host
 * `CommandRuntime.list(agent)` resolves the effective view for one agent —
 * the same catalog the desktop composer's `/` popup shows. Passing the
 * session's agent is required for Web deployments, where per-agent rows
 * (plan-mode, command-compact) live in agent presets and are invisible to
 * the plain-context view; `undefined` (the global view) is only the
 * fallback when no agent resolves.
 */
