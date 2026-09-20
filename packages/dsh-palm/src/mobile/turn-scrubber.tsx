/**
 * D1 turn scrubber: the card that expands above the composer while the turn
 * handle is held.
 *
 * It shows the turn the finger currently points at (number / prompt / response
 * preview) plus a full-width track with one tick per turn and a knob at the
 * current position. The GESTURE lives on the handle in ChatView (it owns the
 * pointer capture and the drag math), so this component is pure presentation —
 * it is pointer-inert and updates only from props.
 */

import type { TurnEntry } from './turn-outline.ts'

/** Ticks stay readable up to this many turns; past it only the rail is drawn. */
const MAX_TICKS = 40

export interface TurnScrubberProps {
  /** Merged turn list, ascending by turn (the scrub axis). */
  entries: readonly TurnEntry[]
  /** Index into `entries` the finger currently points at. */
  index: number
}

/** Percentage along the track for entry `i` of `count` (ends inclusive). */
function trackPercent(i: number, count: number): number {
  return count <= 1 ? 0 : (i / (count - 1)) * 100
}

export function TurnScrubber({ entries, index }: TurnScrubberProps) {
  const count = entries.length
  const safe = Math.min(Math.max(index, 0), Math.max(0, count - 1))
  const entry = entries[safe]
  /** The highest turn number — the denominator, not the entry count. */
  const total = entries[count - 1]?.turn ?? 0
  const pct = trackPercent(safe, count)
  const prompt = entry?.prompt === '' ? '（这一轮没有提问）' : entry?.prompt
  const response = entry?.response === '' ? '（没有回复预览）' : entry?.response

  return (
    <div className="turn-scrub" role="status" aria-live="polite" aria-label="轮次刮擦">
      <div className="turn-scrub-head">
        <span className="turn-scrub-num">第 {entry?.turn ?? 0} / {total} 轮</span>
        <span className="turn-scrub-title">{prompt}</span>
      </div>
      <div className="turn-scrub-sub">{response}</div>
      <div className="turn-scrub-track">
        <div className="turn-scrub-rail" />
        <div className="turn-scrub-fill" style={{ width: `${pct}%` }} />
        {count <= MAX_TICKS && entries.map((item, i) => (
          <i
            key={item.turn}
            className={'turn-scrub-tick' + (i === safe ? ' turn-scrub-tick-at' : '')}
            style={{ left: `${trackPercent(i, count)}%` }}
          />
        ))}
        <div className="turn-scrub-knob" style={{ left: `${pct}%` }} />
      </div>
      <div className="turn-scrub-hint">
        {entry?.loaded === true ? '左右拖动选轮次 · 松手跳转' : '左右拖动选轮次 · 松手跳转（需先载入历史）'}
      </div>
    </div>
  )
}
