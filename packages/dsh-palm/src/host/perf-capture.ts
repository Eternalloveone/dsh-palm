/**
 * **host · 性能采样域**（W5-1：从 `mobile-api.ts` 抽出的第一个域）。
 *
 * 原来这三百来行和 5,000 行的 RPC 分发挤在一个文件里——改一个采样上限要在一个
 * 5,000 行的文件里找，review 也看不出这块是独立的。它只依赖 fs/path、没有跨域状态，
 * 是最干净的接缝，所以先搬它。
 *
 * 语义没变：**两种采样形态**（原始 mark 环 / 聚合 stats）各有自己的字节上限，
 * 落盘保留 {@link PERF_CAPTURE_KEEP} 份，写完顺手裁剪。
 *
 * @module dsh-palm/host/perf-capture
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const PERF_CAPTURE_KEEP = 20

/**
 * Size ceiling for one aggregate capture. `stats()` is a few KB, so anything past
 * this is a client bug or a probe — and it keeps the intake comfortably inside
 * the route's small-JSON body budget.
 */
export const PERF_CAPTURE_MAX_BYTES = 64 * 1024

/**
 * Ceiling for the raw mark ring (`__dshPalmPerf.toJSON()`). A full 2048-mark
 * buffer is ~200 KB and is the ONLY form that can locate an individual outlier
 * span (it keeps per-mark timestamps, stage and detail), so it gets its own.
 */
export const PERF_RAW_MAX_BYTES = 512 * 1024

/**
 * Which of the two capture forms this is: the raw mark ring (`stamps`) or the
 * `stats()` aggregate (`spans`). `invalid` means it is not a capture at all.
 */
export function perfCaptureKind(capture: unknown): 'raw' | 'aggregate' | 'invalid' {
  if (capture === null || typeof capture !== 'object' || Array.isArray(capture)) return 'invalid'
  return Array.isArray((capture as Record<string, unknown>).stamps) ? 'raw' : 'aggregate'
}

/**
 * Refuse anything that is not a perf capture. The phone sends exactly what
 * `__dshPalmPerf.stats()` or `.toJSON()` returns (timings, frame counts, event
 * kinds — no message content, see mobile/perf.ts), so a body that cannot be that
 * shape is a client bug or a probe, and neither belongs on disk.
 * @returns the refusal reason, or undefined when the capture looks right.
 */
export function validatePerfCapture(capture: unknown): string | undefined {
  const kind = perfCaptureKind(capture)
  if (kind === 'invalid') return '缺少性能抓取数据'
  const record = capture as Record<string, unknown>
  const bytes = Buffer.byteLength(JSON.stringify(capture))
  if (kind === 'raw') {
    // A raw capture without marks carries nothing the aggregate does not, and
    // would only add noise to the capture directory.
    if ((record.stamps as unknown[]).length === 0) return '原始抓取里没有标记'
    return bytes > PERF_RAW_MAX_BYTES ? '原始抓取超过体积上限' : undefined
  }
  const spans = record.spans
  if (spans === null || typeof spans !== 'object' || Array.isArray(spans)) return '性能抓取缺少 spans 聚合'
  const spanRecord = spans as Record<string, unknown>
  if (spanRecord.toState === undefined && spanRecord.toCommit === undefined) return '性能抓取缺少 spans.toState/toCommit'
  if (bytes > PERF_CAPTURE_MAX_BYTES) return '性能抓取超过体积上限'
  return undefined
}

/**
 * Write one capture into `dir` and return its absolute path.
 *
 * The file name is built HERE — clock, a sanitized label and the capture kind —
 * so nothing from the wire can steer a path: the label keeps only
 * `[A-Za-z0-9_-]` (no dots, no separators) and is length-capped, and the
 * extension is fixed. Captures are pruned to the newest
 * {@link PERF_CAPTURE_KEEP} so a measurement loop cannot fill the disk.
 */
export function writePerfCapture(
  dir: string,
  capture: unknown,
  label: string,
  now: number,
  kind: 'raw' | 'aggregate' = 'aggregate',
): string {
  mkdirSync(dir, { recursive: true })
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-')
  const safe = label.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || 'device'
  const file = join(dir, `capture-${stamp}-${safe}-${kind}.json`)
  // 0600: the capture is diagnostic detail about the host's own UI, not a
  // shared document (the same posture as the devices store).
  writeFileSync(file, JSON.stringify(capture), { encoding: 'utf8', mode: 0o600 })
  prunePerfCaptures(dir, PERF_CAPTURE_KEEP)
  return file
}

/** Keep the newest `keep` captures in `dir` (best effort: never throws). */
export function prunePerfCaptures(dir: string, keep: number): void {
  try {
    // The ISO stamp leads the name, so a name sort is an age sort.
    const files = readdirSync(dir).filter(name => name.startsWith('capture-') && name.endsWith('.json')).sort()
    for (const stale of files.slice(0, Math.max(0, files.length - keep))) {
      try {
        rmSync(join(dir, stale), { force: true })
      } catch {
        // non-fatal: the next write tries again
      }
    }
  } catch {
    // non-fatal: an unreadable directory must not fail the capture
  }
}

/* ── mobile.error intake ───────────────────────────────────────────────────── */

/** Error reports kept on disk: newest `ERROR_REPORT_KEEP` win, older pruned. */
