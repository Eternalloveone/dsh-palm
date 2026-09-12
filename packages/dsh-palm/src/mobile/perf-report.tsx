/**
 * 「上报性能数据」 row for 设置 → 通用.
 *
 * Rendered ONLY while the instrumentation is armed (`?perf=1`, or the
 * `dsh.palm.perf` flag): this is a measurement affordance, not a feature, and an
 * unarmed page has nothing worth sending. Two forms, deliberately:
 *
 * - 摘要 hands over `stats()` — the aggregates that answer "how slow is the
 *   typical batch" (a few KB);
 * - 原始 hands over `toJSON()` — the mark ring itself, the only form that can
 *   locate ONE outlier span, because it keeps each mark's timestamp, stage and
 *   detail (~200 KB).
 *
 * Both fall back to the clipboard, because a capture lives in this page's memory
 * alone (perf.ts keeps a ring buffer; nothing is persisted and nothing is
 * uploaded on its own) — a failed report must not lose it.
 *
 * @module dsh-palm/mobile/perf-report
 */

import { useState } from 'react'
import { reportPerf } from './api.ts'
import { perfEnabled } from './perf.ts'
import { toast } from './toast.tsx'

/** The slice of the perf window hook this row needs (see perf.ts). */
interface PerfCapture {
  marks?: number
  stamps?: unknown[]
  frames?: { sampled?: number; long?: number }
}

/** The perf window hook installed at boot, or undefined when it is not there yet. */
interface PerfWindowHook {
  stats: () => PerfCapture
  toJSON: () => PerfCapture
}

function perfHook(): PerfWindowHook | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { __dshPalmPerf?: PerfWindowHook }).__dshPalmPerf
}

/** How many marks a capture holds: the two forms report the count differently. */
function markCount(capture: PerfCapture): number {
  if (typeof capture.marks === 'number') return capture.marks
  return Array.isArray(capture.stamps) ? capture.stamps.length : 0
}

/** Best-effort clipboard hand-off of one capture. */
async function copyCapture(capture: unknown): Promise<boolean> {
  try {
    const clipboard = navigator.clipboard
    if (clipboard === undefined || typeof clipboard.writeText !== 'function') return false
    await clipboard.writeText(JSON.stringify(capture))
    return true
  } catch {
    return false
  }
}

/**
 * Ask for the environment label a capture is filed under (the T3 matrix keys:
 * `android-lan`, `ios-lan`, `android-remote`, …). A cancelled or blocked prompt
 * still reports, just under the generic label.
 */
function askLabel(): string {
  const asked = typeof window.prompt === 'function'
    ? window.prompt('这是哪套环境？（如 android-lan / ios-lan / android-remote）', 'android-lan')
    : undefined
  const trimmed = (asked ?? '').trim()
  return trimmed === '' ? 'device' : trimmed
}

/** The settings row: how much has been collected, and the two report buttons. */
export function PerfReportRow() {
  const [busy, setBusy] = useState(false)
  const [reported, setReported] = useState<string | undefined>(undefined)
  if (!perfEnabled()) return null
  const hook = perfHook()
  const snapshot = hook?.stats()
  const marks = snapshot === undefined ? 0 : markCount(snapshot)
  const sampled = snapshot?.frames?.sampled ?? 0

  const submit = (raw: boolean): void => {
    if (busy || hook === undefined) return
    const capture = raw ? hook.toJSON() : hook.stats()
    // A capture with no marks still carries frame statistics (that is exactly
    // what a blur A/B needs), so this warns rather than refuses — but it warns,
    // because an accidental no-turn capture is a wasted round trip.
    if (markCount(capture) === 0
      && !window.confirm('还没有采到回合标记（marks=0），可能这一轮没跑过。仍然上报吗？')) {
      toast('已取消：先跑一轮再上报')
      return
    }
    setBusy(true)
    void reportPerf(capture, askLabel()).then(
      (result) => {
        setBusy(false)
        setReported(result.file)
        toast(`已上报性能数据：${result.file}`)
      },
      () => {
        // A failed report must not lose the capture: it is only in this page.
        void copyCapture(capture).then(
          (copied) => {
            setBusy(false)
            toast(copied ? '上报失败，已复制性能数据到剪贴板（粘给我即可）' : '上报失败，且复制失败')
          },
          () => { setBusy(false); toast('上报失败') },
        )
      },
    )
  }

  return (
    <li className="settings-note settings-installHint">
      <span>
        性能数据：已采集 {marks} 标记 · {sampled} 帧{reported === undefined ? '' : ' · 已上报'}
      </span>
      <span className="settings-perfActions">
        <button
          type="button"
          className="settings-installHint-btn"
          disabled={busy || hook === undefined}
          onClick={() => { submit(false) }}
        >
          {busy ? '上报中…' : '上报摘要'}
        </button>
        <button
          type="button"
          className="settings-installHint-btn"
          disabled={busy || hook === undefined}
          onClick={() => { submit(true) }}
        >
          上报原始
        </button>
      </span>
    </li>
  )
}
