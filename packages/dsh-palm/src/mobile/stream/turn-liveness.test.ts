/**
 * turn-liveness: which evidence may expire the tracked live turn.
 *
 * The rule exists because a lost `turn/end` frame left the previous turn reading
 * 深度求索中 with a stopwatch that never stopped, while the next turn's clock
 * counted from the old start. Getting the evidence wrong in the other direction is
 * just as bad: zeroing a card that is genuinely running (steering appends user rows
 * inside the same turn).
 */
import { describe, expect, it } from 'vitest'
import { turnNumberIsStale } from './turn-liveness.ts'

describe('turnNumberIsStale', () => {
  it('expires the tracked turn once a LATER turn already has rows', () => {
    expect(turnNumberIsStale(0, [
      { kind: 'assistant', turn: 0 },
      { kind: 'assistant', turn: 1 },
    ])).toBe(true)
  })

  it('is not fooled by a user message inside the same turn (steer / claimed queue item)', () => {
    // 插话和排队消息被认领都在同一轮里追加用户行：轮号没变，这一轮还在跑。
    expect(turnNumberIsStale(0, [
      { kind: 'assistant', turn: 0 },
      { kind: 'user' },
      { kind: 'assistant', turn: 0 },
    ])).toBe(false)
  })

  it('keeps the current turn when only older or unknown-turn rows exist', () => {
    expect(turnNumberIsStale(2, [
      { kind: 'assistant', turn: 0 },
      { kind: 'assistant', turn: 2 },
      { kind: 'assistant' },
      { kind: 'user' },
    ])).toBe(false)
  })

  it('has nothing to expire when no turn is tracked', () => {
    expect(turnNumberIsStale(undefined, [{ kind: 'assistant', turn: 9 }])).toBe(false)
  })
})
