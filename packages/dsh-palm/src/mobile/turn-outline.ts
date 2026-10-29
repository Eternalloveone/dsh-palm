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

/** The row a turn jump should land on: the turn's PROMPT, not its answer.
 *  Only assistant rows carry a `turn`, so the row `turnRowIndex` finds is the
 *  first answer row — the question that turn answers sits just above it. Landing
 *  there is what "定位不准" looks like on device: you jump to 第 5 轮 and read the
 *  reply with its question cut off above the viewport. Walks back over the
 *  preceding rows that carry no turn (user prompts, command rows, tool cards of
 *  the same turn) and stops at the previous turn's tail. Out-of-range or
 *  already-prompt indices are returned unchanged. */
export function turnPromptRowIndex(rows: readonly RenderMessage[], index: number): number {
  if (index <= 0 || index >= rows.length) return Math.max(0, index)
  if (rows[index]?.turn === undefined) return index
  let at = index
  while (at > 0 && rows[at - 1]?.turn === undefined) at -= 1
  return at
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
  /** 行的稳定 id（消息 UUID）。跨通道（history 折叠 vs readChat 投影）只有它一致。 */
  id?: string | undefined
  /** 行的正文（搜索定位的文本兜底）。 */
  text?: string | undefined
  /** 合并行（coalesceTurnMessages）保留的每一步 seq：搜索命中按它精确定位。 */
  stepSeqs?: readonly number[] | undefined
}

/** 去掉宿主片段两端的省略号：剩下的才是真的能在正文里比对的文本。 */
export function snippetProbe(snippet: string): string {
  return snippet.replace(/^…+/u, '').replace(/…+$/u, '').trim()
}

/** 把连续空白（含换行、全角空格）压成单空格：索引摘要里的换行位置和正文不一样。 */
function normalizeSpace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

/** 行的正文是否真的带着这段命中原文（8 字窗口滑一遍，容忍 markdown 边界）。 */
export function rowMatchesSnippet(row: TurnRowLike, snippet: string | undefined): boolean {
  const probe = snippet === undefined ? '' : normalizeSpace(snippetProbe(snippet))
  // 没有片段可比时只能信 seq：这是"不知道原文"的降级路径。
  if (probe.length < 2) return true
  const haystack = normalizeSpace(row.text ?? '')
  // 有片段、这一行却没有可比文本（turn 尾卡、被折叠掉的步骤行）：不可信，
  // 别拿它当落点——否则会停在一条空白/不相干的卡片上，看着就是"没定位"。
  if (haystack === '') return false
  if (haystack.includes(probe)) return true
  for (let start = 0; start + 8 <= probe.length; start += 4) {
    if (haystack.includes(probe.slice(start, start + 8))) return true
  }
  return false
}

/**
 * 搜索命中的落脚行。
 *
 * 优先级：行 id（消息 UUID）→ **命中片段文本**→ 合并行的 stepSeqs → seq 相等。
 * 都找不到返回 -1 —— **不要**退回「最靠近的下一条」：窗外命中一旦被兜到窗口边缘，
 * 调用方会以为「已经在窗口里」而不去翻页，真机表现就是「点了下一个，跳到不相干的
 * 地方」/「一动不动」。
 *
 * 靠 seq / stepSeqs 命中的行**必须再用片段校验一次**：索引的 seq 来自
 * `sessions.history` 的折叠，渲染行的 seq 来自 `mobile.readChat` 的投影，两套编号
 * 逐条并不对齐（实测命中 seq=4203 落到 seq=4203 但内容完全不同的相邻消息上）。校验
 * 不过就当没找到，让调用方继续翻页——这正是「搜到了却停在别的段落」的根因。
 */
export function seqRowIndex(
  rows: readonly TurnRowLike[],
  seq: number,
  messageId?: string,
  snippet?: string,
): number {
  let candidate = -1
  if (messageId !== undefined && messageId !== '') {
    const byId = rows.findIndex(row => row.id === messageId)
    if (byId >= 0) candidate = byId
  }
  const probe = snippet === undefined ? '' : normalizeSpace(snippetProbe(snippet))
  if (probe.length >= 2) {
    const exact = rows.findIndex(row => normalizeSpace(row.text ?? '').includes(probe))
    if (exact >= 0) return exact
    // 片段可能跨 markdown 边界（代码块、表格、列表标记）而整段比对不上：先试 8 字
    // 窗口，再退到 2 字对打分。摘要里的 `**`、`|`、换行会把 8 字窗口切碎，2 字对
    // 对切碎不敏感，只要过半对得上就认这一行——比「按 seq 撞到哪行算哪行」准得多。
    for (let start = 0; start + 8 <= probe.length; start += 4) {
      const window = probe.slice(start, start + 8)
      const found = rows.findIndex(row => normalizeSpace(row.text ?? '').includes(window))
      if (found >= 0) return found
    }
    let best = -1
    let bestScore = 0
    for (let index = 0; index < rows.length; index += 1) {
      const haystack = normalizeSpace(rows[index]?.text ?? '')
      if (haystack === '') continue
      let matched = 0
      let total = 0
      for (let start = 0; start + 2 <= probe.length; start += 2) {
        total += 1
        if (haystack.includes(probe.slice(start, start + 2))) matched += 1
      }
      const score = total === 0 ? 0 : matched / total
      if (score > bestScore) {
        bestScore = score
        best = index
      }
    }
    if (best >= 0 && bestScore >= 0.6) return best
  }
  const byStep = rows.findIndex(row => (row.stepSeqs ?? []).includes(seq))
  if (byStep >= 0) return byStep
  const bySeq = rows.findIndex(row => row.seq === seq)
  if (bySeq >= 0) return bySeq
  return candidate
}

export function turnRowIndex(rows: readonly TurnRowLike[], turn: number, seq: number): number {
  if (turn >= 0) {
    const byTurn = rows.findIndex(row => row.turn === turn)
    if (byTurn >= 0) return byTurn
    return rows.findIndex(row => seq >= (row.startSeq ?? row.seq) && seq <= row.seq)
  }
  // 只按 seq 认行（搜索命中）。命中的 seq 常常落在两行之间的空档里：轮次边界事件、
  // 被折叠掉的步骤行、被 preferRicherRows 丢掉的那一份。真机上的表现就是
  // 「第 -1 轮不在更早的历史里」——其实那一处就在窗口里，只是没落进任何一行的区间。
  // 退到「最靠近的下一条」：宁可落在紧邻那一行，也别把用户丢回去。
  const span = rows.findIndex(row => seq >= (row.startSeq ?? row.seq) && seq <= row.seq)
  if (span >= 0) return span
  let nearest = -1
  let nearestStart = Number.POSITIVE_INFINITY
  for (let i = 0; i < rows.length; i += 1) {
    const start = rows[i]?.startSeq ?? rows[i]?.seq ?? Number.POSITIVE_INFINITY
    if (start >= seq && start < nearestStart) {
      nearest = i
      nearestStart = start
    }
  }
  return nearest
}
