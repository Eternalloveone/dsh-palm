/**
 * Message fold: collapse a session event stream into a renderable, ordered
 * message list for the mobile surface.
 *
 * The mobile page is an independent, self-contained bundle, so this module has
 * no value imports: it re-declares a local `WireEvent` (a loose envelope with a
 * typed `type` and a wide `data`) and folds it into {@link RenderMessage} rows.
 * It is a pure, side-effect-free fold — callers hold the rendered list and feed
 * the next batch of events in to get the next list. Caller-supplied `existing`
 * messages are never mutated: every change builds a fresh message object.
 *
 * The data shapes follow the host session protocol (see the dsh session
 * `types.ts` / `surface.ts` and the llm `types.ts` sources the reference audit
 * read):
 *
 * - `user/message`      data = `{ id, role, content: ContentBlock[], source }`
 * - `assistant/message` data = `{ turn, step, message: { id, content }, usage? }`
 * - `assistant/chunk`   data = `{ turn, step, chunk: { type: 'text-delta' | 'reasoning-delta', text } }`
 * - `turn/start`        data = `{ turn }`
 * - `turn/end`          data = `{ turn, reason: { kind: 'error' | ... } }`
 * - `tool/call`         data = `{ turn, step, callId, name, arguments }`
 * - `session/end-seed`  empty data (skipped)
 *
 * Assistant content blocks (`text` vs `reasoning`) fold into two separate
 * fields — `text` and `reasoning` — so the surface can show reasoning behind
 * a collapsed disclosure instead of dumping it into the message body. Tool
 * calls accumulate ordered details (`tools`) in addition to the plain
 * `toolSummary` name list.
 *
 * The mobile message-level aliases `message/chunk`, `message/update` and
 * `message/delete` are also accepted (assumed shapes documented below).
 *
 * Design notes:
 * - Events are applied in ascending `seq` order.
 * - A `seq` watermark is derived from `existing` (the max already-rendered
 *   message seq). Events whose seq is already at or below the watermark are
 *   skipped, which makes re-applying the same batch idempotent without
 *   double-folding streamed chunk text.
 * - Create events additionally dedupe by message id, so a repeated
 *   `user/message` / `assistant/message` replaces in place instead of duplicating.
 * - A pending assistant message (alive while `assistant/chunk`-style deltas
 *   keep arriving, `pending: true`) is finalized by the matching
 *   `assistant/message` (same id or `(turn, step)`) or closed by `turn/end`.
 */
export interface RenderMessage {
  /** Stable message identity — the wire id when present, else the event seq. */
  readonly id: string
  readonly kind: 'user' | 'assistant' | 'command'
  /** The fully folded text (assistant chunks aggregate into their message). */
  readonly text: string
  /**
   * Command card: the `/name args` line from `command/run`; the card's
   * `text` carries the settled `command/done` result while it runs.
   */
  readonly commandLine?: string
  /**
   * Command card lifecycle: `running` from `command/run` until the paired
   * `command/done` lands (the mux delivers both; history replays them).
   */
  readonly commandPhase?: 'running' | 'success' | 'error'
  /**
   * Folded reasoning text, kept separate from `text` so the surface can
   * hide it behind a collapsed Think disclosure (web-UI parity).
   */
  readonly reasoning?: string
  /**
   * Ordered tool calls of this assistant message, in first-seen order,
   * driving the collapsible tool disclosure (name + raw arguments).
   */
  readonly tools?: ToolCallInfo[]
  /**
   * Ordered flow of the message: text runs and tool calls interleaved at
   * their event time points. The settled surface renders this sequence
   * (diff artifacts embedded where the call happened) instead of stacking
   * every artifact after the text. Tool parts reference the call by id —
   * the live entry is looked up at render time, so a result-time view
   * replacement is reflected automatically.
   */
  readonly flow?: ReadonlyArray<FlowPart>
  /** Seq of the latest event that touched this message (used for loadOlder). */
  readonly seq: number
  /** Epoch ms of the latest touch. */
  readonly time: number
  /** True while an assistant message is still receiving chunks (not yet closed). */
  readonly pending?: boolean
  /**
   * Owning turn number (folded from assistant/chunk or assistant/message
   * data). Surfaces may coalesce consecutive same-turn assistant rows into
   * one turn message (see {@link coalesceTurnMessages}); absent for rows
   * whose events never carried a turn.
   */
  readonly turn?: number
  /**
   * Step within the owning turn (folded from chunk/tool-call/assistant
   * data). Together with `turn` this is the stable identity of a streaming
   * row: the synthetic id carries a seq that changes per chunk, and the
   * final id swaps to the host's authoritative one, so surfaces must key
   * rows by (turn, step) — not by id — to avoid remounting a streaming
   * message when it settles.
   */
  readonly step?: number
  /**
   * Seq of the turn message's FIRST folded row (a coalesced turn message
   * spans many step rows; `seq` alone is the newest row's seq). Older-page
   * loading must page by this bound, or the page request would re-fetch the
   * already-shown step rows of the same turn and duplicate their text.
   */
  readonly startSeq?: number
  /**
   * Seq of each folded step row of a coalesced turn message, in order
   * (absent for single-step rows). Lets a search-hit locate scroll to the
   * exact step that matched instead of the turn's first row.
   */
  readonly stepSeqs?: number[]
  /** Text of each folded step row, in order (parallel to `stepSeqs`). */
  readonly stepTexts?: string[]
  /** Plain-text tool call summary for this assistant message, e.g. "使用 bash / read". */
  readonly toolSummary?: string
  /** Set when the owning turn ended in an error. */
  readonly failed?: boolean
  /**
   * Token usage reported by the final assistant event. cacheReadTokens and
   * cacheWriteTokens are only attached when the wire carried finite values.
   */
  readonly usage?: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }
  /** Wire source.kind of a user message (e.g. plugin or user). */
  readonly sourceKind?: string
}

/** One tool call attached to an assistant message (callId dedupes repeats). */
export interface ToolCallInfo {
  /** Tool-call id (synthetic `${name}#${seq}` when the wire omitted it). */
  readonly callId: string
  /** Tool name, e.g. "bash". */
  readonly name: string
  /** Raw arguments JSON, when the event carried it. */
  readonly arguments?: string
  /**
   * Host-computed presentation view for this call, when the deployment's
   * presenter produced one (the mux frame / history entry carries it beside
   * the event). Only the diff card is surfaced on the phone; other cards
   * keep the raw arguments fallback.
   */
  readonly view?: ToolDiffView
}

/**
 * One ordered part of an assistant message's flow: a text run or a tool
 * call (by callId — the live tool entry is looked up at render time, so a
 * result-time view replacement is reflected automatically).
 */
type FlowPart =
  | { readonly kind: 'text'; readonly text: string; readonly seq?: number; readonly partId?: string }
  | { readonly kind: 'tool'; readonly callId: string }

/**
 * The diff-card arm of the host tool presentation contract, re-declared
 * loosely (the mobile bundle has no value imports): a file mutation
 * (write/edit) rendered as removed/added lines per file.
 */
export interface ToolDiffView {
  readonly card: 'diff'
  /** Card header, e.g. `Write foo.txt`. */
  readonly title?: string
  /** One entry per file the call changes. */
  readonly diffs: ReadonlyArray<{
    readonly path: string
    /** Prior content, or null for a new file / an overwrite. */
    readonly oldText: string | null
    /** Content after the change. */
    readonly newText: string
  }>
}

/**
 * The session event envelope as the mobile fold sees it. `data` is kept wide
 * (unknown) so the fold reads fields defensively; `surfaceOp` / `sourceEventSeqs`
 * are envelope metadata unrelated to message rendering and are ignored here.
 */
export interface WireEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
  readonly sourceEventSeqs?: number[]
  readonly surfaceOp?: unknown
  readonly ignorable?: true
  /**
   * Host-computed presentation view riding beside the event (mux frame /
   * history entry shape `{ event, view }`), injected by the surface as
   * `{ ...event, view }`. Shape: `{ for: 'call'|'result', view }`.
   */
  readonly view?: unknown
}

/** Runtime shape guard for the lossless-JSON `data` of a `WireEvent`. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function pickNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** One plan item carried by a `todo/write` snapshot (host TodoItem shape). */
export interface TodoItem {
  /** What this task is — a short imperative line shown in the UI. */
  readonly content: string
  /** Lifecycle state; parallel work may mark several `in_progress`. */
  readonly status: 'pending' | 'in_progress' | 'completed'
}

const TODO_STATUSES: readonly string[] = ['pending', 'in_progress', 'completed']

/**
 * Parse a `todo/write` payload (`{ todos: TodoItem[] }`) into a validated
 * list. Malformed snapshots (wrong root, non-array, null items, bad status)
 * yield `undefined` — the caller keeps showing the previous list rather than
 * blanking the plan strip on one bad write.
 */
export function parseTodoList(data: unknown): TodoItem[] | undefined {
  if (!isRecord(data)) return undefined
  const todos = data['todos']
  if (!Array.isArray(todos)) return undefined
  const items: TodoItem[] = []
  for (const raw of todos) {
    if (!isRecord(raw)) return undefined
    const content = pickString(raw['content'])
    const status = pickString(raw['status'])
    if (content === undefined || status === undefined) return undefined
    if (!TODO_STATUSES.includes(status)) return undefined
    items.push({ content, status: status as TodoItem['status'] })
  }
  return items
}

/** Todo snapshot type with its event seq (adoption is last-write-wins). */
export interface TodoSnapshot {
  readonly seq: number
  readonly items: TodoItem[]
}

/**
 * The newest valid `todo/write` snapshot across events, or undefined when
 * none exists. Scans from the tail (later writes win); a malformed newest
 * snapshot falls through to an older valid one.
 */
export function latestTodoSnapshot(events: readonly WireEvent[]): TodoSnapshot | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event.type !== 'todo/write') continue
    const items = parseTodoList(event.data)
    if (items === undefined) continue
    return { seq: event.seq, items }
  }
  return undefined
}

/** Fallback message id for events without a stable wire id. */
function syntheticId(prefix: string, seq: number): string {
  return `${prefix}#${String(seq)}`
}

/** Concatenate the plain text of every `text` content block.
 *  Exported for host-side consumers (the preview cache) that must parse
 *  message content identically to the fold. */
export function textFromContent(content: unknown): string {
  return blocksOfType(content, 'text')
}

/** Concatenate the plain text of every `reasoning` content block (host-side
 *  consumers share this parse with the fold). */
export function reasoningFromContent(content: unknown): string {
  return blocksOfType(content, 'reasoning')
}

/** Concatenate the plain text of every content block of one type. */
function blocksOfType(content: unknown, type: string): string {
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const block of content) {
    if (!isRecord(block)) continue
    if (block['type'] !== type) continue
    const text = pickString(block['text'])
    if (text !== undefined) out += text
  }
  return out
}

/**
 * Extract a text-chunk target from `assistant/chunk` or the mobile alias
 * `message/chunk`.
 *
 * - DSH shape: `data.chunk = { type: 'text-delta', text }` keyed by
 *   `(turn, step)`; the pending message is created/aggregated on the owning
 *   step and later finalized by the matching `assistant/message`.
 * - Mobile shape: `data.text` with an optional `messageId` binding the delta
 *   to a specific assistant message.
 *
 * Returns null for non-text chunk variants (usage / finish / block-start).
 */
function chunkTarget(data: unknown): { text: string; kind: 'text' | 'reasoning'; id?: string; turn?: number; step?: number } | null {
  if (!isRecord(data)) return null
  let text: string | undefined
  let kind: 'text' | 'reasoning' = 'text'
  let idValue: string | undefined
  let turn: number | undefined
  let step: number | undefined
  const chunk = data['chunk']
  if (isRecord(chunk)) {
    if (chunk['type'] !== 'text-delta' && chunk['type'] !== 'reasoning-delta') return null
    text = pickString(chunk['text'])
    kind = chunk['type'] === 'reasoning-delta' ? 'reasoning' : 'text'
    turn = pickNumber(data['turn'])
    step = pickNumber(data['step'])
    // The streaming envelope also carries the stable message id; honoring it
    // keeps the pending row on the SAME id the final message uses, so a search
    // hit indexed mid-stream (messageId) still matches the finalized row.
    idValue = pickString(data['messageId']) ?? pickString(data['id'])
  } else {
    text = pickString(data['text'])
    kind = pickString(data['kind']) === 'reasoning' ? 'reasoning' : 'text'
    idValue = pickString(data['messageId']) ?? pickString(data['id'])
    turn = pickNumber(data['turn'])
    step = pickNumber(data['step'])
  }
  if (text === undefined) return null
  const result: { text: string; kind: 'text' | 'reasoning'; id?: string; turn?: number; step?: number } = { text, kind }
  if (idValue !== undefined) result.id = idValue
  if (turn !== undefined) result.turn = turn
  if (step !== undefined) result.step = step
  return result
}

/** Mutable fold state; message objects are immutable and swapped on change. */
interface FoldState {
  messages: RenderMessage[]
  byId: Map<string, RenderMessage>
  /** Pending assistant message per `${turn}.${step}`, awaiting finalization. */
  pendingByTurnStep: Map<string, RenderMessage>
  /** Latest assistant message per `${turn}.${step}` (pending or finalized). */
  turnStepMessage: Map<string, RenderMessage>
  /** Owning turn per assistant message id (for turn/end targeting). */
  messageTurn: Map<string, number>
  /** Deduped tool names per assistant message id. */
  toolNames: Map<string, Set<string>>
  /** Highest seq folded so far; the replay/watermark gate. */
  maxSeq: number
}

function createState(existing: readonly RenderMessage[] | undefined, eventMaxSeq?: number): FoldState {
  const messages = existing === undefined ? [] : [...existing]
  const state: FoldState = {
    messages,
    byId: new Map(),
    pendingByTurnStep: new Map(),
    turnStepMessage: new Map(),
    messageTurn: new Map(),
    toolNames: new Map(),
    // An explicit event watermark wins over the row-derived one: rows only
    // carry message-level seqs, and events like turn/end never bump a row's
    // seq, so a window restored from host-folded rows must know the true
    // event watermark or a replay of those events would re-apply below it.
    maxSeq: eventMaxSeq ?? -1,
  }
  for (const message of messages) {
    if (message.seq > state.maxSeq) state.maxSeq = message.seq
    state.byId.set(message.id, message)
    if (message.kind !== 'assistant') continue
    // Rebuild the (turn, step) and turn index maps lost when `existing` was
    // handed back to us as plain rows. Settled rows are indexed too: a
    // late chunk or tool/call for that step (authoritative rewrite) must
    // bind to the existing row instead of creating a duplicate. The row's
    // own turn/step fields are the primary key source — a finalized row
    // carries a wire id (e.g. "a-0") from which the synthetic format
    // ("assistant,0.0#4") cannot be recovered, and without this index a
    // live chunk for the same (turn, step) would mint a NEW row instead of
    // appending to the settled one (chat-window restores folders from
    // host-folded rows, which is exactly this path).
    const decoded = decodePendingTurnStep(message.id)
    const key = tsKey(message.turn, message.step) ?? (decoded === undefined ? undefined : tsKey(decoded.turn, decoded.step))
    if (key !== undefined) {
      state.turnStepMessage.set(key, message)
      if (message.pending === true) state.pendingByTurnStep.set(key, message)
    }
    if (message.turn !== undefined) state.messageTurn.set(message.id, message.turn)
    else if (decoded !== undefined) state.messageTurn.set(message.id, decoded.turn)
    // Rebuild the tool-name dedup set from the row's tool calls: a later
    // tool/call for this step must not re-append a name the summary already
    // shows (refillGap/prepend hand `existing` back as plain rows, so the
    // live map is lost and the summary would truncate to the new name).
    if (message.tools !== undefined && message.tools.length > 0) {
      state.toolNames.set(message.id, new Set(message.tools.map(tool => tool.name)))
    }
  }
  return state
}

function tsKey(turn: number | undefined, step: number | undefined): string | undefined {
  return turn === undefined || step === undefined ? undefined : `${turn}.${step}`
}

/**
 * Recover the `(turn, step)` a pending assistant message was created under from
 * its synthetic id (`assistant,<turn>.<step>#<seq>`), so an incremental fold
 * over an `existing` list can re-attach index maps that were lost across calls.
 */
function decodePendingTurnStep(id: string): { turn: number; step: number } | undefined {
  if (!id.startsWith('assistant,')) return undefined
  const rest = id.slice('assistant,'.length)
  const hash = rest.indexOf('#')
  const tsPart = hash === -1 ? rest : rest.slice(0, hash)
  const dot = tsPart.indexOf('.')
  if (dot <= 0 || dot === tsPart.length - 1) return undefined
  const turn = Number(tsPart.slice(0, dot))
  const step = Number(tsPart.slice(dot + 1))
  if (!Number.isInteger(turn) || !Number.isInteger(step)) return undefined
  return { turn, step }
}

/**
 * Swap in a replacement message object at the old message's position and
 * re-index it. Immutable: `next` is a fresh object; the old one is untouched.
 */
function replaceMessage(state: FoldState, oldMessage: RenderMessage, next: RenderMessage): void {
  const index = state.messages.indexOf(oldMessage)
  if (index !== -1) state.messages[index] = next
  state.byId.delete(oldMessage.id)
  state.byId.set(next.id, next)
}

/** Bundle the maps keyed per `(turn, step)` over to a newly swapped message. */
function retargetTurnStep(state: FoldState, key: string | undefined, oldMessage: RenderMessage, next: RenderMessage): void {
  if (key === undefined) return
  if (state.pendingByTurnStep.get(key) === oldMessage) state.pendingByTurnStep.set(key, next)
  if (state.turnStepMessage.get(key) === oldMessage) state.turnStepMessage.set(key, next)
}

/** The (turn, step) index key a row was created under, from its id. */
function turnStepKeyOf(message: RenderMessage): string | undefined {
  const decoded = decodePendingTurnStep(message.id)
  return decoded === undefined ? undefined : tsKey(decoded.turn, decoded.step)
}

/** Fold one event into the working state. Assumes the event passes the watermark. */
function applyEvent(state: FoldState, event: WireEvent): void {
  if (event.seq > state.maxSeq) state.maxSeq = event.seq
  switch (event.type) {
    case 'user/message':
      applyUserMessage(state, event)
      break
    case 'assistant/message':
      applyAssistantMessage(state, event)
      break
    case 'assistant/chunk':
    case 'message/chunk':
      applyChunk(state, event)
      break
    case 'message/update':
      applyUpdate(state, event)
      break
    case 'message/delete':
      applyDelete(state, event)
      break
    case 'turn/end':
      applyTurnEnd(state, event)
      break
    case 'tool/call':
      applyToolCall(state, event)
      break
    case 'tool/result':
      applyToolResult(state, event)
      break
    case 'command/run':
      applyCommandRun(state, event)
      break
    case 'command/done':
      applyCommandDone(state, event)
      break
    // turn/start, request/context, session/end-seed, and every other/unknown
    // type render nothing.
    default:
      break
  }
}

function applyUserMessage(state: FoldState, event: WireEvent): void {
  const data = isRecord(event.data) ? event.data : {}
  const id = pickString(data['id']) ?? syntheticId('user', event.seq)
  const text = textFromContent(data['content'])
  const source = isRecord(data['source']) ? data['source'] : {}
  const sourceKind = pickString(source['kind'])
  const existing = state.byId.get(id)
  if (existing !== undefined) {
    // Idempotent replace (replayed events update in place, never duplicate).
    replaceMessage(state, existing, {
      ...existing,
      ...(sourceKind !== undefined ? { sourceKind } : {}),
      text,
      seq: event.seq,
      time: event.time,
    })
    return
  }
  const message: RenderMessage = {
    id,
    kind: 'user',
    text,
    ...(sourceKind !== undefined ? { sourceKind } : {}),
    seq: event.seq,
    time: event.time,
  }
  state.messages.push(message)
  state.byId.set(id, message)
}

function applyAssistantMessage(state: FoldState, event: WireEvent): void {
  const data = isRecord(event.data) ? event.data : {}
  const messageData = isRecord(data['message']) ? data['message'] : data
  const id = pickString(messageData['id']) ?? pickString(data['id']) ?? syntheticId('assistant', event.seq)
  const turn = pickNumber(data['turn'])
  const step = pickNumber(data['step'])
  const finalText = textFromContent(messageData['content'])
  const finalReasoning = reasoningFromContent(messageData['content'])
  const key = tsKey(turn, step)
  const usage = usageFromData(data)

  // Finalize the matching assistant message (by id, or by turn/step for the
  // streaming partial that chunks built before the final event arrived).
  let target = state.byId.get(id)
  if (target === undefined && key !== undefined) target = state.pendingByTurnStep.get(key)

  if (target !== undefined) {
    const next: RenderMessage = {
      ...target,
      // KEEP the streaming partial's id when it already carries a real event
      // id (chunk with a uuid): a search hit is indexed while the newest
      // message is still streaming, so its messageId is that pending row's id;
      // swapping to a DIFFERENT final event id here would make the messageId no
      // longer match the rendered row and the locate would fall back to a query
      // match, landing mid-history. Only the fallback synthetic id (no `#`)
      // — i.e. test/edge chunks without a wire id — yields to the final id.
      id: target.id.includes('#') ? id : target.id,
      text: finalText,
      // The final content block list is authoritative; an adapter that omits
      // reasoning from the final message keeps the streamed reasoning text.
      ...(finalReasoning !== '' ? { reasoning: finalReasoning } : {}),
      // The final text is authoritative: equal to the chunk accumulation it
      // keeps the interleaved flow; different, it collapses to one text run.
      flow: finalizeFlow(target.flow, target.text, finalText, event.seq),
      ...(usage !== undefined ? { usage } : {}),
      seq: event.seq,
      time: event.time,
      pending: false,
      ...(step !== undefined ? { step } : {}),
    }
    replaceMessage(state, target, next)
    retargetTurnStep(state, key, target, next)
    if (turn !== undefined) state.messageTurn.set(next.id, turn)
    // The streaming partial's synthetic id is retired: move the per-message
    // indexes (tool-name dedup set, turn map) to the authoritative id, or
    // The streaming partial's id is retained (see above), so no index needs to
    // migrate to a different id; the guard is kept for the unused swap case.
    if (target.id !== next.id) {
      const names = state.toolNames.get(target.id)
      if (names !== undefined) {
        state.toolNames.delete(target.id)
        state.toolNames.set(next.id, names)
      }
      state.messageTurn.delete(target.id)
      if (key !== undefined) state.pendingByTurnStep.delete(key)
    }
    return
  }

  const message: RenderMessage = {
    id,
    kind: 'assistant',
    text: finalText,
    ...(finalText !== '' ? { flow: [{ kind: 'text', text: finalText }] } : {}),
    ...(finalReasoning !== '' ? { reasoning: finalReasoning } : {}),
    ...(usage !== undefined ? { usage } : {}),
    ...(turn !== undefined ? { turn } : {}),
    seq: event.seq,
    time: event.time,
  }
  state.messages.push(message)
  state.byId.set(id, message)
  if (key !== undefined) {
    state.pendingByTurnStep.delete(key)
    state.turnStepMessage.set(key, message)
  }
  if (turn !== undefined) state.messageTurn.set(id, turn)
  // Turns run sequentially: once a turn finalizes, older turns can no longer
  // stream chunks. Drop their (turn, step) index entries so long sessions do
  // not accumulate one entry per finalized message (the current turn's entry
  // stays for late chunks targeting the same (turn, step)).
  if (turn !== undefined && state.turnStepMessage.size > 1) {
    for (const [oldKey, candidate] of state.turnStepMessage) {
      if (candidate === message) continue
      const oldTurn = Number(oldKey.slice(0, oldKey.indexOf('.')))
      if (Number.isInteger(oldTurn) && oldTurn < turn) state.turnStepMessage.delete(oldKey)
    }
  }
}

/**
 * Extract token usage from an assistant event payload. Only attaches when the
 * wire carries finite `inputTokens` AND `outputTokens`; the cache fields are
 * included only for finite numbers.
 */
function usageFromData(data: Record<string, unknown>): { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number } | undefined {
  const usageData = data['usage']
  if (!isRecord(usageData)) return undefined
  const inputTokens = pickNumber(usageData['inputTokens'])
  const outputTokens = pickNumber(usageData['outputTokens'])
  if (inputTokens === undefined || outputTokens === undefined) return undefined
  const usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number } = { inputTokens, outputTokens }
  const cacheReadTokens = pickNumber(usageData['cacheReadTokens'])
  const cacheWriteTokens = pickNumber(usageData['cacheWriteTokens'])
  if (cacheReadTokens !== undefined) usage.cacheReadTokens = cacheReadTokens
  if (cacheWriteTokens !== undefined) usage.cacheWriteTokens = cacheWriteTokens
  return usage
}

/** Append a text run to the flow, merging into a trailing text part. */
function appendTextFlow(flow: ReadonlyArray<FlowPart> | undefined, text: string, seq?: number): ReadonlyArray<FlowPart> {
  if (flow === undefined || flow.length === 0) return [{ kind: 'text', text, ...(seq !== undefined ? { seq } : {}) }]
  const last = flow[flow.length - 1]
  if (last.kind === 'text' && (seq === undefined || last.seq === undefined || last.seq === seq)) {
    return [...flow.slice(0, -1), { kind: 'text', text: last.text + text, ...(last.seq !== undefined || seq !== undefined ? { seq: last.seq ?? seq } : {}) }]
  }
  return [...flow, { kind: 'text', text, ...(seq !== undefined ? { seq } : {}) }]
}

/** Append a tool call to the flow (by callId). */
function appendToolFlow(flow: ReadonlyArray<FlowPart> | undefined, callId: string): ReadonlyArray<FlowPart> {
  return [...(flow ?? []), { kind: 'tool', callId }]
}

/**
 * The final text is authoritative: when it differs from the accumulated
 * chunk text, the text runs collapse into one run of the final text while
 * the tool parts survive (a tool call is an independent event — a text
 * rewrite must not drop it); otherwise the interleaved flow is kept as-is.
 */
function finalizeFlow(flow: ReadonlyArray<FlowPart> | undefined, accumulated: string, finalText: string, seq: number): ReadonlyArray<FlowPart> {
  if (finalText === accumulated) return flow ?? []
  const tools = (flow ?? []).filter(part => part.kind === 'tool')
  return finalText === '' ? tools : [{ kind: 'text', text: finalText, seq }, ...tools]
}

/** Merge two "使用 A / B" summaries by tool name (deduped, order preserved). */
function mergeToolSummary(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  const names = new Set<string>()
  for (const summary of [a, b]) {
    for (const name of summary.replace(/^使用\s*/, '').split(' / ')) {
      const trimmed = name.trim()
      if (trimmed !== '' && trimmed !== 'undefined') names.add(trimmed)
    }
  }
  return names.size === 0 ? undefined : `使用 ${[...names].join(' / ')}`
}

/** Add a row seq only to legacy flows that have no explicit part seq. */
function flowWithSeq(flow: ReadonlyArray<FlowPart> | undefined, seq: number): ReadonlyArray<FlowPart> | undefined {
  if (flow === undefined || flow.some(part => part.kind === 'text' && part.seq !== undefined)) return flow
  return flow.map(part => part.kind === 'text' ? { ...part, seq } : part)
}

/** Concatenate two flows, merging adjacent text runs on a blank line. */function mergeFlows(a: ReadonlyArray<FlowPart> | undefined, b: ReadonlyArray<FlowPart> | undefined): ReadonlyArray<FlowPart> {
  if (a === undefined) return b ?? []
  if (b === undefined) return a
  const out = [...a]
  const first = b[0]
  if (first !== undefined && first.kind === 'text') {
    const last = out[out.length - 1]
    // Keep distinct step seqs as distinct text parts. FlowBody exposes one
    // data-step-seq anchor per text part; merging here would make the later
    // step's search result impossible to locate or highlight.
    if (last !== undefined && last.kind === 'text' && (last.seq === undefined || first.seq === undefined || last.seq === first.seq)) {
      out[out.length - 1] = { kind: 'text', text: last.text + (last.text !== '' && first.text !== '' ? '\n\n' : '') + first.text, ...(last.seq !== undefined || first.seq !== undefined ? { seq: last.seq ?? first.seq } : {}) }
      return [...out, ...b.slice(1)]
    }
  }
  return [...out, ...b]
}

function applyChunk(state: FoldState, event: WireEvent): void {
  const target = chunkTarget(event.data)
  if (target === null) return
  const key = tsKey(target.turn, target.step)
  let message: RenderMessage | undefined
  if (target.id !== undefined) {
    message = state.byId.get(target.id)
    // A tool/call-created placeholder may predate this chunk's authoritative
    // message id: bind by (turn, step) too, so the chunk appends to the same
    // row (absorbing the placeholder's tools) instead of orphaning it.
    if (message === undefined && key !== undefined) {
      message = state.pendingByTurnStep.get(key) ?? state.turnStepMessage.get(key)
    }
  } else if (key !== undefined) {
    message = state.pendingByTurnStep.get(key) ?? state.turnStepMessage.get(key)
  }

  if (message !== undefined && message.kind === 'assistant') {
    const next: RenderMessage = target.kind === 'reasoning'
      ? { ...message, reasoning: (message.reasoning ?? '') + target.text, seq: event.seq, time: event.time }
      : { ...message, text: message.text + target.text, seq: event.seq, time: event.time, flow: appendTextFlow(message.flow, target.text) }
    replaceMessage(state, message, next)
    retargetTurnStep(state, key, message, next)
    return
  }

  const id = target.id
    ?? (key !== undefined ? syntheticId(`assistant,${key}`, event.seq) : syntheticId('assistant', event.seq))
  const created: RenderMessage = target.kind === 'reasoning'
    ? { id, kind: 'assistant', text: '', reasoning: target.text, seq: event.seq, time: event.time, pending: true, ...(target.turn !== undefined ? { turn: target.turn } : {}), ...(target.step !== undefined ? { step: target.step } : {}) }
    : { id, kind: 'assistant', text: target.text, seq: event.seq, time: event.time, pending: true, flow: [{ kind: 'text', text: target.text, seq: event.seq }], ...(target.turn !== undefined ? { turn: target.turn } : {}), ...(target.step !== undefined ? { step: target.step } : {}) }
  state.messages.push(created)
  state.byId.set(id, created)
  if (key !== undefined) {
    state.pendingByTurnStep.set(key, created)
    state.turnStepMessage.set(key, created)
  }
  if (target.turn !== undefined) state.messageTurn.set(id, target.turn)
}

function findByIdOrSeq(state: FoldState, event: WireEvent): RenderMessage | undefined {
  const data = isRecord(event.data) ? event.data : {}
  const id = pickString(data['id'])
  if (id !== undefined) {
    const byId = state.byId.get(id)
    if (byId !== undefined) return byId
  }
  const seq = pickNumber(data['seq'] ?? data['messageSeq'])
  if (seq !== undefined) {
    return state.messages.find(message => message.seq === seq)
  }
  return undefined
}

function applyUpdate(state: FoldState, event: WireEvent): void {
  const message = findByIdOrSeq(state, event)
  if (message === undefined) return
  const data = isRecord(event.data) ? event.data : {}
  const text = pickString(data['text'])
  const next: RenderMessage = {
    ...message,
    ...(text !== undefined ? { text } : {}),
    seq: event.seq,
    time: event.time,
  }
  replaceMessage(state, message, next)
  // Keep the (turn, step) index on the fresh row: a late chunk for the same
  // step must find it, not the replaced (orphaned) object.
  retargetTurnStep(state, turnStepKeyOf(message), message, next)
}

function removeMessage(state: FoldState, message: RenderMessage): void {
  const index = state.messages.indexOf(message)
  if (index !== -1) state.messages.splice(index, 1)
  state.byId.delete(message.id)
  state.messageTurn.delete(message.id)
  state.toolNames.delete(message.id)
  for (const [key, candidate] of state.turnStepMessage) {
    if (candidate === message) state.turnStepMessage.delete(key)
  }
  for (const [key, candidate] of state.pendingByTurnStep) {
    if (candidate === message) state.pendingByTurnStep.delete(key)
  }
}

function applyDelete(state: FoldState, event: WireEvent): void {
  const message = findByIdOrSeq(state, event)
  if (message === undefined) return
  removeMessage(state, message)
}

function applyToolCall(state: FoldState, event: WireEvent): void {
  const data = isRecord(event.data) ? event.data : {}
  const name = pickString(data['name'])
  if (name === undefined) return
  const turn = pickNumber(data['turn'])
  const step = pickNumber(data['step'])
  const key = tsKey(turn, step)

  let target = key === undefined ? undefined : state.turnStepMessage.get(key)
  if (target === undefined && key !== undefined) {
    // The owning step is KNOWN but its row does not exist yet (the call
    // arrived ahead of its chunks): create a pending placeholder for exactly
    // that step. A same-turn scan below would otherwise bind the call to the
    // PREVIOUS step's row, mis-attributing the tool and its flow position.
    // The later chunk/assistant/message for the same (turn,step) merges in.
    const id = syntheticId(`assistant,${key}`, event.seq)
    const placeholder: RenderMessage = {
      id,
      kind: 'assistant',
      text: '',
      seq: event.seq,
      time: event.time,
      pending: true,
      turn,
      step,
    }
    state.messages.push(placeholder)
    state.byId.set(id, placeholder)
    state.turnStepMessage.set(key, placeholder)
    state.pendingByTurnStep.set(key, placeholder)
    if (turn !== undefined) state.messageTurn.set(id, turn)
    target = placeholder
  }
  if (target === undefined && turn !== undefined) {
    // No (turn, step) key on the wire: scan the turn's rows as a fallback
    // (can be the previous step while a multi-step turn streams).
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const candidate = state.messages[i]
      if (candidate !== undefined && candidate.kind === 'assistant' && state.messageTurn.get(candidate.id) === turn) {
        target = candidate
        break
      }
    }
  }
  if (target === undefined && turn === undefined) {
    // No turn context (adapter omitted it): fall back to the last assistant
    // row. With a turn number, an unattached call must NOT ride a previous
    // turn's row — the owning step's chunk/assistant/message will create its
    // own row shortly and this call binds there via the (turn,step) index.
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const candidate = state.messages[i]
      if (candidate !== undefined && candidate.kind === 'assistant') {
        target = candidate
        break
      }
    }
  }
  if (target === undefined) return

  const names = state.toolNames.get(target.id) ?? new Set<string>()
  const isNewName = !names.has(name)
  if (isNewName) {
    names.add(name)
    state.toolNames.set(target.id, names)
  }
  const callId = pickString(data['callId']) ?? `${name}#${String(event.seq)}`
  const args = pickString(data['arguments'])
  const view = diffViewOf(event.view)
  const tools = target.tools ?? []
  const existingIndex = tools.findIndex(tool => tool.callId === callId)
  const isNewCall = existingIndex === -1
  const nextTools: ToolCallInfo[] = isNewCall
    ? [...tools, { callId, name, ...(args !== undefined ? { arguments: args } : {}), ...(view !== undefined ? { view } : {}) }]
    : tools.map((tool, index) => index === existingIndex
      ? { ...tool, ...(args !== undefined ? { arguments: args } : {}), ...(view !== undefined ? { view } : {}) }
      : tool)
  const next: RenderMessage = {
    ...target,
    ...(isNewName ? { toolSummary: `使用 ${[...names].join(' / ')}` } : {}),
    ...(isNewCall || args !== undefined ? { tools: nextTools } : {}),
    ...(isNewCall ? { flow: appendToolFlow(target.flow, callId) } : {}),
    seq: event.seq,
    time: event.time,
  }
  replaceMessage(state, target, next)
  retargetTurnStep(state, key, target, next)
}

/**
 * Attach the result-time presentation view from `tool/result` (data =
 * `{ turn, step, message: { source: { callId } } }`), replacing the
 * call-time view on the matching tool entry — the applied hunk diff wins
 * over the args-derived call diff (desktop parity).
 */
function applyToolResult(state: FoldState, event: WireEvent): void {
  const data = isRecord(event.data) ? event.data : {}
  const message = isRecord(data['message']) ? data['message'] : {}
  const source = isRecord(message['source']) ? message['source'] : {}
  const callId = pickString(source['callId'])
  if (callId === undefined) return
  const view = diffViewOf(event.view)
  if (view === undefined) return
  for (const row of state.messages) {
    if (row.kind !== 'assistant' || row.tools === undefined) continue
    const index = row.tools.findIndex(tool => tool.callId === callId)
    if (index === -1) continue
    const nextTools = row.tools.map((tool, i) => i === index ? { ...tool, view } : tool)
    const next: RenderMessage = { ...row, tools: nextTools, seq: event.seq, time: event.time }
    replaceMessage(state, row, next)
    // The diff lands while the step may still be streaming: keep the index on
    // the fresh row or the following chunks bind to the orphaned object.
    retargetTurnStep(state, turnStepKeyOf(row), row, next)
    return
  }
}

/**
 * Extract the diff-card view from a `{ for: 'call'|'result', view }`
 * presentation envelope (the host's ToolEventView shape). Anything else —
 * terminal/search/read cards, malformed payloads — resolves to undefined so
 * the surface keeps the raw-arguments fallback.
 */
function diffViewOf(envelope: unknown): ToolDiffView | undefined {
  if (!isRecord(envelope)) return undefined
  const view = envelope['view']
  if (!isRecord(view) || view['card'] !== 'diff') return undefined
  const rawDiffs = view['diffs']
  if (!Array.isArray(rawDiffs)) return undefined
  const diffs: Array<{ path: string; oldText: string | null; newText: string }> = []
  for (const raw of rawDiffs) {
    if (!isRecord(raw)) return undefined
    const path = pickString(raw['path'])
    const newText = pickString(raw['newText'])
    if (path === undefined || newText === undefined) return undefined
    const oldText = raw['oldText']
    diffs.push({ path, oldText: typeof oldText === 'string' ? oldText : null, newText })
  }
  const title = pickString(view['title'])
  return { card: 'diff', ...(title !== undefined ? { title } : {}), diffs }
}

/**
 * Command card from `command/run` (data = `{ commandId, name, args?, source }`).
 * The card renders immediately as "running" — the mux delivers this frame the
 * moment the host admits the command, which is the phone's in-stream feedback
 * while a long command like `/compact` works. A `command/done` that already
 * folded (out-of-order replay) is never rolled back to running.
 */
function applyCommandRun(state: FoldState, event: WireEvent): void {
  const data = isRecord(event.data) ? event.data : {}
  const commandId = pickString(data['commandId']) ?? syntheticId('command', event.seq)
  const existing = state.byId.get(commandId)
  if (existing !== undefined && existing.kind === 'command' && existing.commandPhase !== 'running') return
  const name = pickString(data['name']) ?? ''
  const args = pickString(data['args']) ?? ''
  const message: RenderMessage = {
    id: commandId,
    kind: 'command',
    text: '',
    commandLine: args === '' ? `/${name}` : `/${name} ${args}`,
    commandPhase: 'running',
    seq: event.seq,
    time: event.time,
  }
  if (existing !== undefined) replaceMessage(state, existing, message)
  else {
    state.messages.push(message)
    state.byId.set(message.id, message)
  }
}

/**
 * Settle the command card from `command/done` (data = `{ commandId, kind,
 * text? }`). A missing run (windowed history started between the pair, or a
 * cross-window replay) still renders the settled card; its line is unknown,
 * so only the result text shows.
 */
function applyCommandDone(state: FoldState, event: WireEvent): void {
  const data = isRecord(event.data) ? event.data : {}
  const commandId = pickString(data['commandId']) ?? syntheticId('command', event.seq)
  const phase = pickString(data['kind']) === 'error' ? 'error' : 'success'
  const resultText = pickString(data['text']) ?? ''
  const existing = state.byId.get(commandId)
  const line = existing !== undefined && existing.kind === 'command' ? existing.commandLine : undefined
  const text = resultText !== ''
    ? resultText
    : line !== undefined ? `${line} · 已执行` : '命令已执行'
  const message: RenderMessage = {
    id: commandId,
    kind: 'command',
    text,
    ...(line !== undefined ? { commandLine: line } : {}),
    commandPhase: phase,
    seq: event.seq,
    time: event.time,
  }
  if (existing !== undefined) replaceMessage(state, existing, message)
  else {
    state.messages.push(message)
    state.byId.set(message.id, message)
  }
}

function applyTurnEnd(state: FoldState, event: WireEvent): void {
  const data = isRecord(event.data) ? event.data : {}
  const turn = pickNumber(data['turn'])
  const reason = isRecord(data['reason']) ? data['reason'] : {}
  const failed = reason['kind'] === 'error'

  let targets: RenderMessage[]
  if (turn !== undefined) {
    targets = state.messages.filter(message => message.kind === 'assistant' && state.messageTurn.get(message.id) === turn)
  } else {
    targets = state.messages.filter(message => message.kind === 'assistant')
  }
  if (targets.length === 0) {
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const candidate = state.messages[i]
      if (candidate !== undefined && candidate.kind === 'assistant') {
        targets = [candidate]
        break
      }
    }
  }
  for (const message of targets) {
    const wasPending = message.pending === true
    const next: RenderMessage = {
      ...message,
      ...(wasPending ? { pending: false } : {}),
      ...(failed ? { failed: true } : {}),
      // Preserve each step's own final-event seq. Collapsing every message
      // onto turn/end makes same-turn ordering depend on arbitrary ids.
      time: event.time,
    }
    replaceMessage(state, message, next)
    retargetTurnStep(state, turnStepKeyOf(message), message, next)
  }
}

/**
 * Fold a batch of session events into a renderable message list.
 *
 * @param events - events to apply, in any order (folded by ascending seq).
 * @param existing - the previously rendered list (live-stream incremental tail).
 * @returns messages sorted by seq.
 */
export function foldEvents(events: readonly WireEvent[], existing?: readonly RenderMessage[]): RenderMessage[] {
  return new EventFolder(existing).fold(events)
}

/**
 * The running turn's logged `turn/start` time (epoch ms) for a raw event
 * window, or undefined when the window's last turn boundary is a `turn/end`
 * (or there is no boundary at all). Folding consumes the boundary events,
 * so this scan runs on the raw window before folding. Desktop turn-clock
 * parity: the anchor restored here must equal the desktop timeline's open
 * turn start, so a mid-turn reload keeps the real elapsed time.
 */
export function lastOpenTurnStartTime(events: readonly WireEvent[]): number | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const type = events[i]?.type
    if (type === 'turn/end') return undefined
    if (type === 'turn/start') return events[i]?.time
  }
  return undefined
}

/**
 * Coalesce consecutive same-turn assistant rows into one turn message.
 *
 * A busy turn emits one `assistant/message` per model step (each step's
 * reasoning + text as its own message id). Without coalescing, a 15-row
 * history tail fills with a single turn's step rows and the real prior
 * conversation (user prompts, final answers with code fences) is pushed out
 * of the visible window — the phone looks like replies "lost their code
 * blocks" when the text was never rendered at all. Merging adjacent
 * same-turn assistant rows collapses N step rows into one turn message;
 * text / reasoning / tools concatenate in message order. Applied at the
 * surface state layer (ChatView), not inside the fold, so live and replay
 * folding stay byte-identical and row ids remain stable while streaming.
 */
export function coalesceTurnMessages(messages: readonly RenderMessage[]): RenderMessage[] {
  const out: RenderMessage[] = []
  for (const message of messages) {
    const previous = out.length > 0 ? out[out.length - 1] : undefined
    if (previous !== undefined && previous.kind === 'assistant' && message.kind === 'assistant'
      && previous.turn !== undefined && message.turn !== undefined
      && previous.turn === message.turn) {
      const merged: RenderMessage = {
        ...previous,
        // Step texts join on a blank line: each step is its own markdown
        // paragraph run, and while the turn is still streaming the merged
        // row stays pending — the blank line lets parseStreamPrefix close
        // the finished steps as real <p> blocks instead of forcing the whole
        // turn into the plain-text preview.
        text: previous.text + (previous.text !== '' && message.text !== '' ? '\n\n' : '') + message.text,
        ...(previous.reasoning !== undefined || message.reasoning !== undefined
          ? { reasoning: (previous.reasoning ?? '') + ((previous.reasoning ?? '') !== '' && (message.reasoning ?? '') !== '' ? '\n\n' : '') + (message.reasoning ?? '') }
          : {}),
        ...(previous.tools !== undefined || message.tools !== undefined
          ? { tools: [...(previous.tools ?? []), ...(message.tools ?? [])] }
          : {}),
        ...(previous.flow !== undefined || message.flow !== undefined
          ? { flow: mergeFlows(flowWithSeq(previous.flow, previous.seq), flowWithSeq(message.flow, message.seq)) }
          : {}),
        // Tool summaries merge by name instead of the latest step
        // overwriting earlier steps ("使用 bash" must survive "使用 read").
        ...(previous.toolSummary !== undefined || message.toolSummary !== undefined
          ? { toolSummary: mergeToolSummary(previous.toolSummary, message.toolSummary) }
          : {}),
        // The merge widens the row's seq span: keep the FIRST row's seq as
        // startSeq so older-page loading can page strictly before the whole
        // turn (see RenderMessage.startSeq).
        startSeq: previous.startSeq ?? previous.seq,
        seq: message.seq,
        stepSeqs: [...(previous.stepSeqs ?? [previous.startSeq ?? previous.seq]), message.seq],
        stepTexts: [...(previous.stepTexts ?? [previous.text]), message.text],
        time: message.time,
        // The latest row's status wins: a finalized step (no pending flag)
        // clears the merged row's pending — an interrupted turn (every row
        // still pending) keeps the streaming shape. failed propagates once
        // set: a failed step never un-fails the turn.
        pending: message.pending === true,
        ...(message.failed === true ? { failed: true } : {}),
        ...(message.usage !== undefined ? { usage: message.usage } : {}),
      }
      out[out.length - 1] = merged
    } else {
      out.push(message)
    }
  }
  return out
}

/**
 * Incremental folder for one message stream. Live chat folds one event at a
 * time; rebuilding the five index maps by scanning every message per event
 * made that path O(n) per event (O(n * events) per turn). A folder keeps the
 * indexes alive across folds, applies each event in O(1) map operations, and
 * returns the previous snapshot identity unchanged when nothing applied, so
 * React skips the re-render entirely. Replayed events are no-ops: the maxSeq
 * watermark advanced by the first application skips them, which also makes a
 * double-invoked React state updater harmless.
 */
export class EventFolder {
  private state: FoldState
  private snapshotList: RenderMessage[] | undefined

  /**
   * @param initial - seed rows (history tail load); omit for an empty stream.
   * @param watermark - explicit event-seq watermark: every event at or below
   * it is skipped as already applied. Restoring a window from host-folded
   * rows passes the window's event watermark (see createState) so a replayed
   * live frame can never double-apply below it.
   */
  constructor(initial?: readonly RenderMessage[], watermark?: number) {
    this.state = createState(initial, watermark)
  }

  /** Event-seq watermark after the folds applied so far (readers use it to
   *  hand a restored window its true replay floor). */
  get lastSeq(): number {
    return this.state.maxSeq
  }

  /** Fold one batch incrementally; returns the current snapshot list. */
  fold(events: readonly WireEvent[]): RenderMessage[] {
    const sorted = [...events].sort((a, b) => a.seq - b.seq)
    // Watermark snapshot taken BEFORE this batch: everything at or below it
    // was already applied by an earlier fold (replay from the poll fallback
    // or a double-invoked React updater). Events above it all apply — even
    // several sharing one seq within the batch — so a merged frame that
    // legally carries multiple events of the same seq loses none of them
    // (the old check read the live maxSeq, so the batch's second same-seq
    // event was skipped as if it were a replay).
    const floor = this.state.maxSeq
    let applied = false
    for (const event of sorted) {
      if (event.seq <= floor) continue
      applyEvent(this.state, event)
      applied = true
    }
    if (!applied && this.snapshotList !== undefined) return this.snapshotList
    this.snapshotList = snapshotOf(this.state)
    return this.snapshotList
  }

  /** Replace the whole stream (history reload / session switch). */
  seed(messages: readonly RenderMessage[]): void {
    this.state = createState(messages)
    this.snapshotList = undefined
  }

  /** Prepend an older history page (exact seam; no overlapping seqs). */
  prepend(older: readonly RenderMessage[]): void {
    this.state = createState([...older, ...this.state.messages])
    this.snapshotList = undefined
  }

  /** Current snapshot list; a fresh copy whenever the folder changed. */
  snapshot(): RenderMessage[] {
    if (this.snapshotList !== undefined) return this.snapshotList
    this.snapshotList = snapshotOf(this.state)
    return this.snapshotList
  }
}

/** Copy the folder's rows and keep them seq-ordered (skips re-sorting the common ordered case). */
function snapshotOf(state: FoldState): RenderMessage[] {
  const out = [...state.messages]
  let ordered = true
  for (let index = 1; index < out.length; index += 1) {
    const prev = out[index - 1]!
    const current = out[index]!
    if (prev.seq > current.seq) {
      ordered = false
      break
    }
  }
  // Array.sort is stable: equal-seq rows keep their event insertion order.
  return ordered ? out : out.sort((a, b) => a.seq - b.seq)
}
