/**
 * Turn outline for the mobile chat level: parse the host `turnOutline`
 * projection and merge it with locally-rendered turns so the phone can show a
 * jumpable per-turn list on a long session.
 *
 * Data shapes (confirmed on device, do not guess):
 * - wire view  = array `{ turn:number; seq:number; prompt:string; response:string }[]`
 * - checkpoint = `{ turns: [...] , draft: string }`
 *
 * The host already truncates prompt (≤50 chars) and response (≤120 chars), so
 * this module does not truncate — the UI ellipsizes with CSS. Parsing is
 * strictly tolerant: malformed rows are dropped, never thrown.
 */

import type { RenderMessage } from './messages.ts'

/** One row of the merged turn list. `loaded` distinguishes turns that are in
 *  the currently rendered window (jump = in-place scroll) from turns that must
 *  be paged in first (jump = loadOlder then scroll). */
export interface TurnEntry {
  turn: number
  /** Anchor seq: the host-provided seq when unloaded, the window row's
   *  `startSeq ?? seq` once loaded (the target for in-window jumping). */
  seq: number
  prompt: string
  response: string
  loaded: boolean
}

/** Narrow runtime guard for projection payloads. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Tolerant parse of the wire `turnOutline` projection. Accepts both the array
 *  view and the persisted `{ turns: [...] }` shape. Rows lacking a numeric
 *  `turn` (or otherwise malformed) are dropped; `null`/strings/empty return [].
 *  Resulting entries are marked NOT loaded — the host list is the full outline,
 *  and the loaded flag is stamped by {@link mergeTurnEntries}. */
export function parseTurnOutline(value: unknown): TurnEntry[] {
  const raw = Array.isArray(value)
    ? value
    : (isRecord(value) && Array.isArray(value['turns']) ? value['turns'] : [])
  const out: TurnEntry[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    // Missing any required field (turn/seq/prompt/response) drops the row.
    const turn = item['turn']
    const seq = item['seq']
    const prompt = item['prompt']
    const response = item['response']
    if (typeof turn !== 'number' || !Number.isFinite(turn)) continue
    if (typeof seq !== 'number' || !Number.isFinite(seq)) continue
    if (typeof prompt !== 'string') continue
    if (typeof response !== 'string') continue
    out.push({ turn, seq, prompt, response, loaded: false })
  }
  return out
}

/** Merge the host outline with locally-rendered turns. Dedupes by turn number,
 *  prefers a loaded (rendered) entry over the host preview, and sorts ascending
 *  by turn. Turns only the host knows about keep `loaded: false`. */
export function mergeTurnEntries(outline: readonly TurnEntry[], localTurns: readonly TurnEntry[]): TurnEntry[] {
  const byTurn = new Map<number, TurnEntry>()
  for (const entry of outline) {
    if (!byTurn.has(entry.turn)) byTurn.set(entry.turn, entry)
  }
  for (const entry of localTurns) {
    // A rendered turn replaces the host preview (authoritative text + the real
    // in-window seq anchor). Unrendered entries the host already registered are
    // kept as-is; purely-local entries (projection missing) are added.
    if (entry.loaded || !byTurn.has(entry.turn)) byTurn.set(entry.turn, entry)
  }
  return [...byTurn.values()].sort((a, b) => a.turn - b.turn)
}

/** The turn being read for the row at `index` (the row under the viewport top):
 *  the first row at or below it that carries a `turn`, scanning upward only as
 *  a fallback. Only assistant rows carry a turn (user prompts and command rows
 *  do not — see chunkTarget in messages.ts), so resolving the single top row
 *  leaves the handle reporting the newest turn while the reader is deep in
 *  history. The index is clamped; undefined means no loaded row carries a turn. */
export function readingTurnAt(rows: readonly RenderMessage[], index: number): number | undefined {
  if (rows.length === 0) return undefined
  const from = Math.min(Math.max(index, 0), rows.length - 1)
  for (let i = from; i < rows.length; i++) {
    const turn = rows[i]?.turn
    if (turn !== undefined) return turn
  }
  for (let i = from - 1; i >= 0; i--) {
    const turn = rows[i]?.turn
    if (turn !== undefined) return turn
  }
  return undefined
}

/** Derive locally-rendered turn rows from the folded message list. For each
 *  assistant turn present in the window, the prompt is the nearest preceding
 *  user/command message, the response is the merged assistant text, and seq is
 *  the row's `startSeq ?? seq` (the anchor for an in-place jump). Assistant
 *  rows without a turn cannot be matched to the outline and are skipped. */
export function localTurnEntries(messages: readonly RenderMessage[]): TurnEntry[] {
  const byTurn = new Map<number, { seq: number; prompt: string; response: string }>()
  let pendingPrompt: { text: string; seq: number } | undefined
  for (const message of messages) {
    if (message.kind === 'user' || message.kind === 'command') {
      pendingPrompt = { text: message.text, seq: message.startSeq ?? message.seq }
      continue
    }
    if (message.kind !== 'assistant' || message.turn === undefined) continue
    const seq = message.startSeq ?? message.seq
    const entry = byTurn.get(message.turn)
    if (entry === undefined) {
      byTurn.set(message.turn, {
        seq,
        prompt: pendingPrompt?.text ?? '',
        response: message.text,
      })
    } else {
      if (seq < entry.seq) entry.seq = seq
      if (entry.prompt === '' && pendingPrompt !== undefined) entry.prompt = pendingPrompt.text
      if (entry.response === '') entry.response = message.text
    }
    // The prompt belongs to this turn; the next assistant turn gets its own
    // preceding user message, so consume it once used.
    pendingPrompt = undefined
  }
  return [...byTurn.entries()]
    .map(([turn, entry]) => ({ turn, seq: entry.seq, prompt: entry.prompt, response: entry.response, loaded: true }))
    .sort((a, b) => a.turn - b.turn)
}

/** Map a finger POSITION onto a turn index for the D1 scrubber — absolute, like
 *  a video progress bar: the track's left edge is the oldest turn, its right
 *  edge the newest, so every turn is reachable by dragging. A relative drag
 *  could not do that: the handle sits at the screen's right edge, leaving the
 *  finger no room to travel toward newer turns. Positions outside the track
 *  clamp to its ends; a degenerate span, or a list shorter than two turns,
 *  yields 0. Callers must pass `trackRight > trackLeft`. */
export function scrubTurnIndex(x: number, trackLeft: number, trackRight: number, count: number): number {
  if (count <= 1) return 0
  const span = trackRight - trackLeft
  if (!(span > 0)) return 0
  const ratio = (Math.min(Math.max(x, trackLeft), trackRight) - trackLeft) / span
  return Math.min(count - 1, Math.max(0, Math.round(ratio * (count - 1))))
}

/** The row a turn jump should land on: the row carrying the turn NUMBER, or —
 *  for callers that only have a message seq (search hits) — the row whose
 *  [startSeq, seq] range contains it. -1 when nothing matches.
 *
 *  The turn number has to win. A host outline entry's `seq` is the turn/start
 *  EVENT's seq, which fires before the turn's first message, so it sits in the
 *  gap BETWEEN two rows: range matching alone silently finds nothing, and the
 *  jump then pages history in and still lands nowhere. */
export interface TurnRowLike {
  seq: number
  startSeq?: number | undefined
  turn?: number | undefined
}

export function turnRowIndex(rows: readonly TurnRowLike[], turn: number, seq: number): number {
  const byTurn = rows.findIndex(row => row.turn === turn)
  if (byTurn >= 0) return byTurn
  return rows.findIndex(row => seq >= (row.startSeq ?? row.seq) && seq <= row.seq)
}
