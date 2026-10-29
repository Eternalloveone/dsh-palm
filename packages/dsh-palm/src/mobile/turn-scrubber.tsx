/**
 * D1 turn scrubber: the card that expands above the composer while the turn
 * handle is held.
 *
 * It shows the turn the finger currently points at (number / prompt / response
 * preview) plus a full-width track with one tick per turn and a knob at the
 * current position. The GESTURE lives on the handle in ChatView (it owns the
 * pointer capture and the drag math), so this component is pure presentation —
 * it is pointer-inert and updates only from props.
 *
 * The axis spans EVERY turn the host knows about (`total`), not just the ones
 * already paged into the phone. Tying it to `entries.length` made the knob stop
 * at the oldest loaded turn: on a long session the host outline only reaches a
 * couple of dozen turns back, so the track silently shrank to "第 44 / 57 轮" at
 * the far left and the reader could never drag to the beginning.
 */

import type { CSSProperties } from 'react'
import type { TurnEntry } from './turn-outline.ts'

/** Ticks stay readable up to this many turns; past it only the rail is drawn. */
const MAX_TICKS = 40

export interface TurnScrubberProps {
  /** Merged turn list, ascending by turn (supplies the previews and the ticks). */
  entries: readonly TurnEntry[]
  /** Position on the FULL axis, 0-based: `index + 1` is the turn number. */
  index: number
  /**
   * Length of that axis — the host's highest turn number. Absent keeps the old
   * behaviour of spanning only the loaded entries.
   */
  total?: number
}

/** Percentage along the track for position `i` of `count` (ends inclusive). */
function trackPercent(i: number, count: number): number {
  return count <= 1 ? 0 : (i / (count - 1)) * 100
}

export function TurnScrubber({ entries, index, total }: TurnScrubberProps) {
  const axis = total !== undefined && total > 0 ? total : entries.length
  const safe = Math.min(Math.max(index, 0), Math.max(0, axis - 1))
  /** Turn number under the finger (turns are 1-based, the axis is not). */
  const turn = safe + 1
  const entry = entries.find(item => item.turn === turn)
  /** The denominator: never below the axis, so paging never shrinks the readout. */
  const highest = entries[entries.length - 1]?.turn ?? 0
  const totalTurn = Math.max(highest, axis)
  const pct = trackPercent(safe, axis)
  const prompt = entry === undefined
    ? ''
    : entry.prompt === '' ? '（这一轮没有提问）' : entry.prompt
  const response = entry === undefined
    ? '（松手会往回翻到这一轮）'
    : entry.response === '' ? '（没有回复预览）' : entry.response

  return (
    <div className="turn-scrub" role="status" aria-live="polite" aria-label="轮次刮擦">
      <div className="turn-scrub-head">
        <span className="turn-scrub-num">第 {turn} / {totalTurn} 轮</span>
        <span className="turn-scrub-title">{prompt}</span>
      </div>
      <div className="turn-scrub-sub">{response}</div>
      <div className="turn-scrub-track">
        <div className="turn-scrub-rail" />
        {entries.length > 0 && entries.length < axis && (
          <div
            className="turn-scrub-loaded"
            style={{
              left: `${trackPercent((entries[0]?.turn ?? 1) - 1, axis)}%`,
              width: `${trackPercent((entries[entries.length - 1]?.turn ?? 1) - 1, axis) - trackPercent((entries[0]?.turn ?? 1) - 1, axis)}%`,
            }}
          />
        )}
        <div className="turn-scrub-fill" style={{ width: `${pct}%` }} />
        {entries.length <= MAX_TICKS && entries.map(item => (
          <i
            key={item.turn}
            className={'turn-scrub-tick' + (item.turn === turn ? ' turn-scrub-tick-at' : '')}
            style={{ left: `${trackPercent(item.turn - 1, axis)}%` }}
          />
        ))}
        <div
          className="turn-scrub-knob"
          style={{ '--knob-pct': `${pct}%` } as CSSProperties}
        />
      </div>
      <div className="turn-scrub-hint">
        {entry?.loaded === true ? '左右拖动选轮次 · 松手跳转' : '左右拖动选轮次 · 松手跳转（需先载入历史）'}
      </div>
    </div>
  )
}
