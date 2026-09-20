/** Merged turn outline parsing + merge tests (方案 B). */
import { describe, expect, it } from 'vitest'
import { localTurnEntries, mergeTurnEntries, parseTurnOutline, readingTurnAt, scrubTurnIndex, turnRowIndex, type TurnEntry } from './turn-outline.ts'
import type { RenderMessage } from './messages.ts'

/** One outline-style entry (wire shape). */
function entry(turn: number, seq: number, prompt = '', response = '', loaded = false): TurnEntry {
  return { turn, seq, prompt, response, loaded }
}

describe('parseTurnOutline', () => {
  it('parses the array wire shape with prompt/response previews', () => {
    const parsed = parseTurnOutline([
      { turn: 1, seq: 12, prompt: '你好', response: '你好！' },
      { turn: 2, seq: 30, prompt: '继续', response: '好的。' },
    ])
    expect(parsed).toEqual([
      { turn: 1, seq: 12, prompt: '你好', response: '你好！', loaded: false },
      { turn: 2, seq: 30, prompt: '继续', response: '好的。', loaded: false },
    ])
  })

  it('parses the persisted checkpoint { turns: [...] } shape', () => {
    const parsed = parseTurnOutline({ turns: [{ turn: 3, seq: 55, prompt: 'p', response: 'r' }], draft: 'hi' })
    expect(parsed).toEqual([{ turn: 3, seq: 55, prompt: 'p', response: 'r', loaded: false }])
  })

  it('returns [] for null / string / plain object / missing turns', () => {
    expect(parseTurnOutline(null)).toEqual([])
    expect(parseTurnOutline('turns')).toEqual([])
    expect(parseTurnOutline({ draft: 'hi' })).toEqual([])
    expect(parseTurnOutline(42)).toEqual([])
    expect(parseTurnOutline({ turns: 'nope' })).toEqual([])
  })

  it('drops rows with non-numeric or missing turn, and non-record items', () => {
    const parsed = parseTurnOutline([
      { turn: 'x', seq: 1, prompt: '', response: '' },
      null,
      { seq: 2, prompt: '', response: '' }, // no turn
      { turn: 4, seq: 4, prompt: 'ok', response: 'fine' },
      7,
      'string',
    ])
    expect(parsed).toEqual([{ turn: 4, seq: 4, prompt: 'ok', response: 'fine', loaded: false }])
  })

  it('drops entries missing any required field (turn/seq/prompt/response)', () => {
    const parsed = parseTurnOutline([
      { turn: 1, seq: 5, prompt: undefined, response: undefined },
      { turn: 2, seq: 9, prompt: 'p', response: 123 },
      { turn: 3, seq: 11, prompt: 'prompt', response: 'resp' },
      { turn: 4, seq: 'nope', prompt: 'p', response: 'r' },
      { turn: 5, prompt: 'p', response: 'r' },
    ])
    expect(parsed).toEqual([
      { turn: 3, seq: 11, prompt: 'prompt', response: 'resp', loaded: false },
    ])
  })

  it('returns [] for an empty array', () => {
    expect(parseTurnOutline([])).toEqual([])
  })

  it('does not throw on malformed nested values', () => {
    expect(() => parseTurnOutline([{ turn: 1 }, { turn: NaN }, { turn: Infinity }])).not.toThrow()
  })
})

describe('mergeTurnEntries', () => {
  it('dedupes by turn, preferring the loaded entry, sorted ascending', () => {
    const outline = [
      entry(3, 55, 'o3p', 'o3r'),
      entry(1, 12, 'o1p', 'o1r'),
      entry(2, 30, 'o2p', 'o2r'),
    ]
    const local = [
      entry(2, 31, 'l2p', 'l2r', true),
      entry(3, 56, 'l3p', 'l3r', true),
    ]
    expect(mergeTurnEntries(outline, local)).toEqual([
      entry(1, 12, 'o1p', 'o1r', false),
      entry(2, 31, 'l2p', 'l2r', true),
      entry(3, 56, 'l3p', 'l3r', true),
    ])
  })

  it('keeps host-only turns with loaded=false', () => {
    const outline = [entry(5, 99, 'p', 'r')]
    expect(mergeTurnEntries(outline, [])).toEqual([entry(5, 99, 'p', 'r', false)])
  })

  it('adds purely-local turns (projection missing)', () => {
    const merged = mergeTurnEntries([], [entry(9, 10, 'lp', 'lr', true)])
    expect(merged).toEqual([entry(9, 10, 'lp', 'lr', true)])
  })

  it('handles unordered duplicate inputs', () => {
    const outline = [entry(2, 20, 'a', 'a'), entry(1, 10, 'b', 'b'), entry(2, 21, 'c', 'c')]
    const local = [entry(2, 22, 'd', 'd', true)]
    expect(mergeTurnEntries(outline, local)).toEqual([
      entry(1, 10, 'b', 'b', false),
      entry(2, 22, 'd', 'd', true),
    ])
  })
})

describe('localTurnEntries', () => {
  function user(id: string, text: string, seq: number): RenderMessage {
    return { id, kind: 'user', text, seq, time: seq * 1000 }
  }
  function assistant(id: string, turn: number, text: string, seq: number, startSeq?: number): RenderMessage {
    return { id, kind: 'assistant', text, seq, time: seq * 1000, turn, ...(startSeq !== undefined ? { startSeq } : {}) }
  }

  it('pairs each assistant turn with its preceding user prompt', () => {
    const list = [
      user('u1', '你好', 1),
      assistant('a1', 1, '你好！', 6, 2),
      user('u2', '继续', 12),
      assistant('a2', 2, '好的。', 18, 13),
    ]
    expect(localTurnEntries(list)).toEqual([
      { turn: 1, seq: 2, prompt: '你好', response: '你好！', loaded: true },
      { turn: 2, seq: 13, prompt: '继续', response: '好的。', loaded: true },
    ])
  })

  it('skips assistant rows without a turn and user rows without a follow-up', () => {
    const noTurn: RenderMessage = { id: 'aNoTurn', kind: 'assistant', text: '无轮次', seq: 20, time: 20000 }
    const list = [
      user('u0', '孤立', 1),
      assistant('a1', 3, '回复', 8, 2),
      noTurn,
    ]
    expect(localTurnEntries(list)).toEqual([
      { turn: 3, seq: 2, prompt: '孤立', response: '回复', loaded: true },
    ])
  })
})

describe('readingTurnAt', () => {
  function prompt(id: string, seq: number): RenderMessage {
    return { id, kind: 'user', text: '提问', seq, time: seq * 1000 }
  }
  function reply(id: string, turn: number, seq: number): RenderMessage {
    return { id, kind: 'assistant', text: '回复', seq, time: seq * 1000, turn }
  }

  it('reads the turn directly when an assistant row sits at the index', () => {
    const list = [prompt('u1', 1), reply('a1', 1, 6), prompt('u2', 12), reply('a2', 2, 18)]
    expect(readingTurnAt(list, 1)).toBe(1)
    expect(readingTurnAt(list, 3)).toBe(2)
  })

  // The bug the device reported: the row under the viewport top is normally a
  // user prompt, which carries no turn — the old code fell back to the NEWEST
  // turn, so the handle read "43/43" while the reader sat at turn 2.
  it('walks DOWN from a turn-less prompt row to the turn it began', () => {
    const list = [prompt('u1', 1), reply('a1', 1, 6), prompt('u2', 12), reply('a2', 2, 18)]
    expect(readingTurnAt(list, 2)).toBe(2)
  })

  it('walks UP when no row at or below the index carries a turn', () => {
    const list = [reply('a1', 7, 6), prompt('u2', 12), prompt('u3', 13)]
    expect(readingTurnAt(list, 2)).toBe(7)
  })

  it('clamps out-of-range indexes and returns undefined for an empty list', () => {
    expect(readingTurnAt([], 0)).toBeUndefined()
    const list = [reply('a1', 4, 6)]
    expect(readingTurnAt(list, -3)).toBe(4)
    expect(readingTurnAt(list, 99)).toBe(4)
  })

  it('returns undefined when no loaded row carries a turn at all', () => {
    expect(readingTurnAt([prompt('u1', 1), prompt('u2', 2)], 0)).toBeUndefined()
  })
})

describe('scrubTurnIndex', () => {
  const LEFT = 30
  const RIGHT = 360

  it('maps the track ends to the first and the last turn', () => {
    expect(scrubTurnIndex(LEFT, LEFT, RIGHT, 20)).toBe(0)
    expect(scrubTurnIndex(RIGHT, LEFT, RIGHT, 20)).toBe(19)
  })

  it('maps the middle of the track to the middle of the list', () => {
    expect(scrubTurnIndex((LEFT + RIGHT) / 2, LEFT, RIGHT, 20)).toBe(10)
  })

  // The device complaint: a RELATIVE drag from a handle pinned to the screen's
  // right edge runs out of room before the end of the list. Mapping the finger's
  // absolute position puts both ends within reach.
  it('clamps positions outside the track to its ends', () => {
    expect(scrubTurnIndex(-500, LEFT, RIGHT, 20)).toBe(0)
    expect(scrubTurnIndex(9999, LEFT, RIGHT, 20)).toBe(19)
  })

  it('never walks backwards as the finger moves right', () => {
    let previous = -1
    for (let x = -40; x <= 420; x += 7) {
      const index = scrubTurnIndex(x, LEFT, RIGHT, 20)
      expect(index).toBeGreaterThanOrEqual(previous)
      previous = index
    }
  })

  it('degrades safely for a single-turn list, an empty list, or a zero span', () => {
    expect(scrubTurnIndex(200, LEFT, RIGHT, 1)).toBe(0)
    expect(scrubTurnIndex(200, LEFT, RIGHT, 0)).toBe(0)
    expect(scrubTurnIndex(200, LEFT, LEFT, 20)).toBe(0)
    expect(scrubTurnIndex(200, RIGHT, LEFT, 20)).toBe(0)
  })
})

describe('turnRowIndex', () => {
  const rows = [
    { seq: 10, startSeq: 10, turn: 1 },
    { seq: 24, startSeq: 11, turn: 2 },
    { seq: 40, startSeq: 25, turn: 3 },
  ]

  it('returns -1 when nothing matches', () => {
    expect(turnRowIndex(rows, 99, 999)).toBe(-1)
    expect(turnRowIndex([], 1, 5)).toBe(-1)
  })

  it('prefers the row carrying the turn number', () => {
    expect(turnRowIndex(rows, 2, 11)).toBe(1)
    expect(turnRowIndex(rows, 3, 25)).toBe(2)
  })

  // The device regression: an outline entry's seq is the turn/start EVENT seq,
  // which falls in the gap before the turn's first row (startSeq). Range
  // matching alone finds nothing there, so the turn number must decide.
  it('matches a turn whose boundary seq sits before its first row', () => {
    expect(turnRowIndex(rows, 2, 10)).toBe(1)
  })

  it('falls back to the seq range for seq-only callers', () => {
    expect(turnRowIndex(rows, -1, 24)).toBe(1)
    expect(turnRowIndex(rows, -1, 39)).toBe(2)
  })
})
