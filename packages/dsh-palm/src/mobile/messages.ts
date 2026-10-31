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
/**
 * One file a `present` call declared this turn — the desktop's deliverable
 * card entry: a mandatory workspace path plus the optional human description.
 */
export interface TurnDeliverable {
  readonly path: string
  readonly description?: string
}

export interface RenderMessage {
  /** Stable message identity — the wire id when present, else the event seq. */
  readonly id: string
  readonly kind: 'user' | 'assistant' | 'command' | 'turn'
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
   * 这一轮的计划（收工时挂在交付卡上，只读展示）。
   *
   * 状态条在「全部完成且无后台任务」时会淡出收起，计划得留个能点开的入口 ——
   * 交付卡上的 `计划 3/3 · 用时 8分12秒` 胶囊就是它。
   */
  readonly plan?: { items: readonly TodoItem[] }
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
  /**
   * 这一行在**搜索索引里**的正文（宿主用同一个 `searchableText` 算出的原文）。
   * 只随 `mobile.readChat` 回来，用来把「搜到的命中」落到正确的行上：索引的 seq/id
   * 与渲染行的 seq/id 来自两条不同通道，逐条并不对齐，而这段文本两边一字不差。
   * 老宿主不带这个字段，客户端退回 text + flow 自行比对。
   */
  readonly searchText?: string
  /** Seq of the latest event that touched this message (used for loadOlder). */
  readonly seq: number
  /** Epoch ms of the latest touch. */
  readonly time: number
  /**
   * Turn-tail row (kind `turn`): how long the turn took, in epoch ms — the
   * phone's take on the desktop's `用时 9分29秒`. Absent when the window never
   * carried the `turn/start` anchor.
   */
  /**
   * 这一行是不是「本轮过程卡的归属行」。
   *
   * 默认 true。同一轮被用户插话切成多段时，只有第一段是归属行；后续段为 false ——
   * 它的工具/思考/工具摘要都已上提到第一段，这一段只画正文，不再画第二张卡。
   */
  readonly processCardOwner?: boolean

  readonly durationMs?: number
  /**
   * The owning turn's `turn/start` time (epoch ms), folded onto every row of
   * that turn. A running turn's process head ticks off it (`now - turnStartAt`);
   * once `turn/end` lands, `durationMs` freezes the number instead.
   */
  readonly turnStartAt?: number
  /**
   * Host time (epoch ms) of the FIRST event that created this row — the clock
   * fallback for a turn whose `turn/start` never reached this window (a tail
   * page loaded mid-turn). The running head must never end up with no timer.
   */
  readonly firstSeenAt?: number
  /** Turn-tail row: the files `present` declared this turn, in order. */
  readonly deliverables?: readonly TurnDeliverable[]
  /** Turn-tail row: workspace paths this turn's tool views mutated (minus the declared deliverables). */
  readonly produced?: readonly string[]
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
   * 用户消息里的图片（持久附件引用，按出现顺序）。
   *
   * 0.1.5 起宿主不再把图片字节内联进 `user/message`：content 里是
   * `{ type: 'image', attachment: { attachmentId, mediaType, width, height, name? } }`，
   * 字节要另经 `mobile.readAttachment` 取（桌面端同样如此，见 ui-conversation 的
   * historical-images）。以前这里只折 `text`，于是图片块被整块丢掉——纯图片消息
   * 文本为空，行渲染直接 return null，手机上什么都看不到。
   */
  readonly images?: readonly MessageImage[]
  /**
   * 这条消息附带的文件引用（`{ type: 'file', attachment: { attachmentId, name, bytes } }`）。
   *
   * 以前只折 `images`，文件块被整块丢掉：文档明明上传成功、prompt 里也带着 receipt，
   * 发出去的那一行却只剩文字 —— 用户在"发送条"里看不到自己附了什么（真机反馈）。
   * 桌面端同一份 content 会渲染成一张文件卡片，这里对齐。
   */
  readonly files?: readonly MessageFile[]
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
  /** Set when the owning turn ended at the per-request output-token cap. */
  readonly maxTokens?: boolean
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
  /**
   * Row state for the process timeline (desktop parity): `running` from the
   * call until its `tool/result` settles it (`ok`, or `error` when the
   * result message says so), and `stopped` when the owning turn ends with
   * the call still open — an interrupted turn, exactly like the desktop row.
   */
  readonly state?: 'running' | 'ok' | 'error' | 'stopped'
  /**
   * Files the tool's RESULT meta names as changed (`meta.diffs[].path`, or
   * `meta.path` for a plain write). This survives projections that strip the
   * call's arguments — a window that keeps only the tool name still tells us
   * what was written — and it covers turns whose files changed through a tool
   * this file's own mutating-name list does not know.
   */
  readonly metaPaths?: readonly string[]
}

/**
 * One ordered part of an assistant message's flow: a text run, a reasoning
 * run or a tool call (by callId — the live tool entry is looked up at render
 * time, so a result-time view replacement is reflected automatically).
 *
 * Reasoning is a POSITIONED part, not just the merged `reasoning` string: the
 * phone renders one process group in which thinking and tool calls interleave
 * in event order (desktop turn-process parity), which needs to know WHERE each
 * reasoning run happened, not only what it said.
 */
type FlowPart =
  | { readonly kind: 'text'; readonly text: string; readonly seq?: number; readonly partId?: string }
  | { readonly kind: 'reasoning'; readonly text: string; readonly seq?: number }
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

/** Fold one event into the projection-equivalent todo state (the mobile
 *  mirror of the host `tool-todo` projection apply):
 *  - `todo/write` replaces the list (malformed writes keep the previous one);
 *  - `turn/end` normalizes a task still `in_progress` to `completed` (agents
 *    routinely skip the final all-done write, so the turn boundary must not
 *    leave the strip stuck on an intermediate snapshot) — `pending` items were
 *    never started and stay untouched;
 *  - `turn/start` clears the whole list (the host clears its projection there);
 *  - every other event returns the same state.
 *  Seeding the plan strip from this fold (rather than a raw newest-write scan)
 *  keeps a reopened session consistent with the host projection: an old turn
 *  that ended mid-task shows its finished checklist, and a new turn that never
 *  wrote a todo shows nothing at all.
 */
export function foldTodoEvent(
  state: TodoSnapshot | undefined,
  event: WireEvent,
): TodoSnapshot | undefined {
  if (event.type === 'todo/write') {
    const items = parseTodoList(event.data)
    return items === undefined ? state : { seq: event.seq, items }
  }
  if (event.type === 'turn/end' && state !== undefined) {
    return {
      seq: state.seq,
      items: state.items.map(item => item.status === 'in_progress'
        ? { ...item, status: 'completed' }
        : item),
    }
  }
  if (event.type === 'turn/start') return undefined
  return state
}

/** Fold a whole event sequence into its projection-equivalent todo snapshot
 *  (undefined = cleared / never written). Events must be in seq order. */
export function foldTodoSnapshot(events: readonly WireEvent[]): TodoSnapshot | undefined {
  let state: TodoSnapshot | undefined
  for (const event of events) state = foldTodoEvent(state, event)
  return state
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

/** 一条消息里的图片引用（字节不在事件里，见 {@link RenderMessage.images}）。 */
export interface MessageImage {
  /** 内容寻址的持久附件 id（同一张图永远同一个 id，取一次即可长期缓存）。 */
  attachmentId: string
  /** 图片 MIME 类型。 */
  mediaType: string
  /** 原图宽（宿主入库时记录的像素宽）。 */
  width: number
  /** 原图高。 */
  height: number
  /** 字节数（宿主入库时记录）。 */
  bytes?: number
  /** 原始文件名。 */
  name?: string
}

/** 一条消息里的文件附件引用（内容寻址，字节另行读取）。 */
export interface MessageFile {
  /** 内容寻址的持久附件 id（sha256）。 */
  attachmentId: string
  /** 宿主清洗过的展示文件名。 */
  name: string
  /** 字节数。 */
  bytes: number
}

/**
 * 从 content 里取文件附件引用。
 *
 * 正式形态是 `{ type: 'file', attachment: { attachmentId, name, bytes } }`（宿主把
 * receipt 换成这份引用之后落库）；也兼容字段平铺在同一层的形态，缺 id 的块跳过。
 *
 * 以前只折 images，文件块被整块丢掉：文档上传成功、prompt 里也带着 receipt，发出去
 * 的那一行却只剩文字 —— 用户在"发送条"里看不到自己附了什么（真机反馈）。
 */
export function filesFromContent(content: unknown): MessageFile[] {
  if (!Array.isArray(content)) return []
  const files: MessageFile[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const record = block as Record<string, unknown>
    if (record['type'] !== 'file') continue
    const attachment = isRecord(record['attachment']) ? record['attachment'] : record
    // 没有名字的块画不出东西（名字是唯一认得出的信息），直接跳。
    const name = pickString(attachment['name']) ?? pickString(record['name'])
    if (name === undefined) continue
    // id 用于 key/去重：正式形态有 attachmentId；兼容只有 receiptId 的中间形态，
    // 两者都没有时用位置占位（宁可显示一张没 id 的卡片，也不要整块消失）。
    const attachmentId = pickString(attachment['attachmentId'])
      ?? pickString(record['attachmentId'])
      ?? pickString(record['receiptId'])
      ?? `file-${files.length}`
    files.push({
      attachmentId,
      name,
      bytes: pickNumber(attachment['bytes']) ?? pickNumber(record['bytes']) ?? 0,
    })
  }
  return files
}

/**
 * 从 content 里取图片引用。宿主把引用嵌在 `attachment` 下
 * （`{ type: 'image', attachment: { attachmentId, mediaType, … } }`）；也兼容
 * 字段直接平铺在同一层的旧形态，缺 id 或 mediaType 的块跳过。
 */
export function imagesFromContent(content: unknown): MessageImage[] {
  if (!Array.isArray(content)) return []
  const images: MessageImage[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const record = block as Record<string, unknown>
    if (record['type'] !== 'image') continue
    const attachment = isRecord(record['attachment']) ? record['attachment'] : record
    const attachmentId = pickString(attachment['attachmentId'])
    const mediaType = pickString(attachment['mediaType'])
    if (attachmentId === undefined || mediaType === undefined) continue
    const bytes = pickNumber(attachment['bytes'])
    const name = pickString(attachment['name'])
    images.push({
      attachmentId,
      mediaType,
      width: pickNumber(attachment['width']) ?? 0,
      height: pickNumber(attachment['height']) ?? 0,
      ...(bytes === undefined ? {} : { bytes }),
      ...(name === undefined ? {} : { name }),
    })
  }
  return images
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
 * Ordered flow of an assistant message's content blocks: text runs and reasoning
 * blocks in author order. `assistant/message` carries the whole block list, and
 * this is the only place the interleaving survives a history reload —
 * `textFromContent` and `reasoningFromContent` each drop it by type.
 */
function flowFromContent(content: unknown): FlowPart[] {
  if (!Array.isArray(content)) return []
  const out: FlowPart[] = []
  for (const block of content) {
    if (!isRecord(block)) continue
    const type = block['type']
    if (type !== 'text' && type !== 'reasoning') continue
    const text = pickString(block['text'])
    if (text === undefined || text === '') continue
    out.push(type === 'reasoning' ? { kind: 'reasoning', text } : { kind: 'text', text })
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
  /** `turn/start` epoch ms per turn (the turn tail's duration anchor). */
  turnStarts: Map<number, number>
  /**
   * 本轮的最近一份计划（`todo/write` 折叠出来的快照）。
   *
   * 收工时挂到交付卡上：状态条在全完成时会淡出，计划得有地方看得到。
   */
  plan?: { turn: number | undefined; items: TodoItem[] }
  /**
   * 每轮的收工时刻（``turn/end`` 的时间）。往上翻页补进来的旧行来自切口之前那一页，
   * 那一页里没有这一轮的 turn/end，于是它们既没有用时也不带收工时间；只有记住这个，
   * 补进来的行才能和同一轮其它行一样收尾。
   */
  turnEnds: Map<number, number>
  /**
   * 宿主播给我们的「当前开着的那一轮」起点（`mobile.readChat` 的 page.turnStartAt、
   * `mobile.turnState` 的 turnStartAt）。
   *
   * 长回合的 turn/start 会落在折叠窗口之外：那时 `applyTurnEnd` 只能拿窗口里最早的
   * 一行当锚点，收工瞬间用时比真实值短一截（真机 8分39秒 的一轮，秒表一路数到
   * 8分37秒，收工后定格成 6分48秒）。宿主其实知道真起点，所以这里单独记一份，
   * 收工定格优先用它 —— 只对"当前最新一轮"生效，避免把旧回合的收工时刻算错。
   */
  openTurnStart?: number
  /**
   * 当前开着的轮号（`turn/start` 记、`turn/end` 清）。
   *
   * 实时流的某些事件不带 `turn`（流式分片、步骤文本）。不补的话这些行 `turn` 是
   * undefined，折叠时就认不出「和上一条同属一轮」，同一轮被画成两条过程条 ——
   * 等尾页/收工把轮号补齐后才合成一条。真机「一进会话多条过程条，过一会儿只剩一条」
   * 就是这么来的。
   */
  openTurn?: number
  /**
   * 这一轮当前第几步（最近一次见到 step 的编号）。
   *
   * 助手行的**金标准身份是 (turn, step)**。流式分片常常只带 turn 不带 step，身份就
   * 退化成 id —— 页面行、实时行、pending 行各一套 id，同一行于是变成好几条。
   * 轮号早就这样兜了（openTurn），步号必须同样兜，否则「同轮同文」只能靠事后去重。
   */
  openStep?: number
  /** Files declared by `deliverables/presented` per turn, deduped by path. */
  presented: Map<number, TurnDeliverable[]>
}

/**
 * 宿主折叠好的行里，工具调用不一定会带 diff 视图：那时手机上只剩一整块参数
 * JSON，红绿卡看起来就"消失"了。这里按事件流的同一套规则补一遍 —— 只在
 * view 缺席时补，宿主给了就以宿主的为准。
 * @param existing - 宿主或缓存交回来的行（可能没有工具行）。
 */
function seedDiffViews(existing: readonly RenderMessage[] | undefined): RenderMessage[] {
  if (existing === undefined) return []
  return existing.map(message => {
    if (message.kind !== 'assistant' || message.tools === undefined) return message
    let touched = false
    const tools = message.tools.map(tool => {
      if (tool.view !== undefined) return tool
      const view = diffViewFromArguments(tool.name, tool.arguments)
      if (view === undefined) return tool
      touched = true
      return { ...tool, view }
    })
    return touched ? { ...message, tools } : message
  })
}

function createState(existing: readonly RenderMessage[] | undefined, eventMaxSeq?: number): FoldState {
  const messages = seedDiffViews(existing)
  const state: FoldState = {
    messages,
    byId: new Map(),
    pendingByTurnStep: new Map(),
    turnStepMessage: new Map(),
    messageTurn: new Map(),
    toolNames: new Map(),
    turnStarts: new Map(),
    turnEnds: new Map(),
    presented: new Map(),
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

/** 「这一轮、步号未知」的桶键标记。 */
const UNKNOWN_STEP = '*'

/**
 * 分片/最终消息该落进哪一行：先按 (turn, step)，再退回「本轮未知步」桶。
 *
 * 这是「同一轮画成两张过程卡」的根：分片只带 turn、不带 step 时旧代码 key 是 undefined，
 * 于是**每一片都新建一行**（各一个 synthetic id），屏幕上两张卡、都 pending、都顶秒表。
 */
function lookupKeys(turn: number | undefined, step: number | undefined): string[] {
  const exact = tsKey(turn, step)
  const bucket = turn === undefined ? undefined : `${turn}.${UNKNOWN_STEP}`
  if (exact !== undefined && bucket !== undefined) return [exact, bucket]
  if (exact !== undefined) return [exact]
  return bucket === undefined ? [] : [bucket]
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
  let index = state.messages.indexOf(oldMessage)
  if (index === -1) {
    // The (turn, step) index can outlive the row OBJECT it points at: an
    // earlier rewrite swapped that object for a fresh one. Dropping the
    // rewrite here is what silently swallowed a step's later tool calls
    // (the row was still indexed, so every following call bound to the
    // orphan and its update vanished). Land it on the row that actually
    // carries the replaced row's id, else on the same turn's last
    // assistant row, else append: an update is never thrown away.
    index = state.messages.findIndex(message => message.id === oldMessage.id)
    if (index === -1 && oldMessage.turn !== undefined) {
      for (let i = state.messages.length - 1; i >= 0; i -= 1) {
        const candidate = state.messages[i]
        if (candidate !== undefined && candidate.kind === 'assistant' && candidate.turn === oldMessage.turn) {
          index = i
          break
        }
      }
    }
  }
  if (index === -1) state.messages.push(next)
  else state.messages[index] = next
  state.byId.delete(oldMessage.id)
  state.byId.set(next.id, next)
}

/** Bundle the maps keyed per `(turn, step)` over to a newly swapped message. */
function retargetTurnStep(state: FoldState, key: string | undefined, oldMessage: RenderMessage, next: RenderMessage): void {
  if (key === undefined) return
  if (state.pendingByTurnStep.get(key) === oldMessage) state.pendingByTurnStep.set(key, next)
  if (state.turnStepMessage.get(key) === oldMessage) state.turnStepMessage.set(key, next)
}

/**
 * The (turn, step) index key a row was created under. The row's own fields
 * are the primary source — an `assistant/message` row carries the host's
 * authoritative message id (a uuid), from which the synthetic
 * "assistant,<turn>.<step>#<seq>" format cannot be recovered. The id decode
 * stays as the fallback for rows folded before the fields existed.
 */
function turnStepKeyOf(message: RenderMessage): string | undefined {
  const fromRow = tsKey(message.turn, message.step)
  if (fromRow !== undefined) return fromRow
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
    case 'turn/start':
      applyTurnStart(state, event)
      // 新一轮开始：计划从头记（上一轮那份已经挂在上轮的交付卡上了）。
      state.plan = undefined
      break
    case 'todo/write': {
      const items = parseTodoList(event.data)
      if (items !== undefined) {
        // 挂给收工时那张交付卡：状态条在全完成时会收起，计划得留个入口。
        state.plan = { turn: newestAssistantTurn(state), items }
      }
      break
    }
    case 'deliverables/presented':
      applyPresented(state, event)
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
  const images = imagesFromContent(data['content'])
  const files = filesFromContent(data['content'])
  const source = isRecord(data['source']) ? data['source'] : {}
  const sourceKind = pickString(source['kind'])
  const existing = state.byId.get(id)
  if (existing !== undefined) {
    // Idempotent replace (replayed events update in place, never duplicate).
    replaceMessage(state, existing, {
      ...existing,
      ...(sourceKind !== undefined ? { sourceKind } : {}),
      ...(images.length > 0 ? { images } : {}),
      ...(files.length > 0 ? { files } : {}),
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
    ...(images.length > 0 ? { images } : {}),
    ...(files.length > 0 ? { files } : {}),
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
  // 分片不带 turn 时跟着当前这一轮走：不然这一行没有轮号，折叠认不出它和上一条同行，
  // 同一轮会被画成两条过程条（真机「多条 → 过一会儿只剩一条」）。
  const turn = pickNumber(data['turn']) ?? state.openTurn
  const explicitStep = pickNumber(data['step'])
  if (explicitStep !== undefined) state.openStep = explicitStep
  const step = explicitStep ?? state.openStep
  const finalText = textFromContent(messageData['content'])
  const finalReasoning = reasoningFromContent(messageData['content'])
  const key = tsKey(turn, step)
  const usage = usageFromData(data)

  // Finalize the matching assistant message (by id, or by turn/step for the
  // streaming partial that chunks built before the final event arrived).
  let target = state.byId.get(id)
  if (target === undefined) {
    // 最终消息带 step、而流式那一行落在「未知步」桶里：两个键都找一遍再决定新建。
    for (const candidate of lookupKeys(turn, step)) {
      const found = state.pendingByTurnStep.get(candidate)
      if (found !== undefined) { target = found; break }
    }
  }

  if (target !== undefined) {
    const next: RenderMessage = {
      ...target,
      // KEEP the streaming partial's id when it already carries a real event
      // id (chunk with a uuid): a search hit is indexed while the newest
      // message is still streaming, so its messageId is that pending row's id;
      // swapping to a DIFFERENT final event id here would make the messageId no
      // longer match the rendered row and the locate would fall back to a query
      // match, landing mid-history. Only the fallback synthetic id (`prefix#seq`,
      // i.e. test/edge chunks without a wire id) yields to the final id.
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
    // The id only changes on the synthetic→real swap above (see the `id` field),
    // so the per-message indexes (tool-name dedup set, turn map) must follow it;
    // the retained-id path needs no migration and skips this block.
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

  // History carries the whole content block list: walking it in order is what
  // keeps thinking and text interleaved after a reload (live rows already have
  // their positioned flow from the chunks).
  const contentFlow = flowFromContent(messageData['content'])
  const message: RenderMessage = {
    id,
    kind: 'assistant',
    text: finalText,
    ...(contentFlow.length > 0 ? { flow: contentFlow } : (finalText !== '' ? { flow: [{ kind: 'text', text: finalText }] } : {})),
    ...(finalReasoning !== '' ? { reasoning: finalReasoning } : {}),
    ...(usage !== undefined ? { usage } : {}),
    ...(turn !== undefined ? { turn } : {}),
    // The replace branch above stamps `step` too: without it here, the
    // (turn, step) index key of a host-uuid row cannot be recovered from
    // the id, so the first tool/result orphans the row and every later
    // tool/call of the same step is dropped (the real-machine "1 步" lie).
    ...(step !== undefined ? { step } : {}),
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

/**
 * Append a reasoning run to the flow, merging into a trailing reasoning part.
 * The part carries no seq of its own: reasoning chunks change seq on every
 * token, and a per-chunk seq would break the merge (the merged run's position
 * is already implied by the array order).
 */
function appendReasoningFlow(flow: ReadonlyArray<FlowPart> | undefined, text: string): ReadonlyArray<FlowPart> {
  if (flow === undefined || flow.length === 0) return [{ kind: 'reasoning', text }]
  const last = flow[flow.length - 1]
  if (last !== undefined && last.kind === 'reasoning') {
    return [...flow.slice(0, -1), { kind: 'reasoning', text: last.text + text, ...(last.seq !== undefined ? { seq: last.seq } : {}) }]
  }
  return [...flow, { kind: 'reasoning', text }]
}

/** Append a tool call to the flow (by callId). */
function appendToolFlow(flow: ReadonlyArray<FlowPart> | undefined, callId: string): ReadonlyArray<FlowPart> {
  return [...(flow ?? []), { kind: 'tool', callId }]
}

/**
 * The final text is authoritative: when it differs from the accumulated chunk
 * text, every text run collapses into ONE trailing run of the final text while
 * the reasoning and tool parts survive at their own positions (a tool call is an
 * independent event — a text rewrite must not drop it, and the answer belongs
 * AFTER the steps that produced it). Otherwise the interleaved flow is kept.
 */
function finalizeFlow(flow: ReadonlyArray<FlowPart> | undefined, accumulated: string, finalText: string, seq: number): ReadonlyArray<FlowPart> {
  if (finalText === accumulated) return flow ?? []
  const steps = (flow ?? []).filter(part => part.kind !== 'text')
  return finalText === '' ? steps : [...steps, { kind: 'text', text: finalText, seq }]
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
  if (flow === undefined || flow.some(part => part.kind !== 'tool' && part.seq !== undefined)) return flow
  return flow.map(part => part.kind === 'tool' ? part : { ...part, seq })
}

/** Concatenate two flows, merging adjacent text runs on a blank line. */function mergeFlows(a: ReadonlyArray<FlowPart> | undefined, b: ReadonlyArray<FlowPart> | undefined): ReadonlyArray<FlowPart> {
  if (a === undefined) return b ?? []
  if (b === undefined) return a
  const out = [...a]
  const first = b[0]
  if (first !== undefined && first.kind === 'text') {
    const last = out[out.length - 1]
    // Keep distinct step seqs as distinct text parts. The process group's
    // expanded body exposes one data-step-seq anchor per text part; merging
    // here would make the later step's search result impossible to locate.
    if (last !== undefined && last.kind === 'text' && (last.seq === undefined || first.seq === undefined || last.seq === first.seq)) {
      out[out.length - 1] = { kind: 'text', text: last.text + (last.text !== '' && first.text !== '' ? '\n\n' : '') + first.text, ...(last.seq !== undefined || first.seq !== undefined ? { seq: last.seq ?? first.seq } : {}) }
      return [...out, ...b.slice(1)]
    }
  }
  return [...out, ...b]
}

/**
 * The owning turn's clock, folded onto a row: `turn` always rides along, and
 * `turnStartAt` is attached as soon as the turn's `turn/start` has been seen so
 * a running process head can tick without any surface-side bookkeeping.
 */
function turnStamp(state: FoldState, turn: number | undefined): { turn?: number; turnStartAt?: number } {
  if (turn === undefined) return {}
  // 窗口里没有这一轮的 turn/start 时，宿主种进来的外部锚点（openTurnStart）就是它；
  // 只认窗口里最新的那一轮 —— 更早的轮次有它自己的 turn/start 或干脆不该有锚点。
  const newest = newestAssistantTurn(state)
  const startedAt = state.turnStarts.get(turn)
    ?? (newest === undefined || turn >= newest ? state.openTurnStart : undefined)
  return { turn, ...(startedAt !== undefined ? { turnStartAt: startedAt } : {}) }
}

function applyChunk(state: FoldState, event: WireEvent): void {
  const target = chunkTarget(event.data)
  if (target === null) return
  // 缺 turn/step 时跟着「当前这一轮」走，并且落进「未知步」桶：同一轮的所有无步分片
  // 因此合成一行，而不是每片新建一行。
  const turn = target.turn ?? state.openTurn
  const step = target.step ?? state.openStep
  const keys = lookupKeys(turn, step)
  const key = keys[0]
  const findRow = (): RenderMessage | undefined => {
    for (const candidate of keys) {
      const found = state.pendingByTurnStep.get(candidate) ?? state.turnStepMessage.get(candidate)
      if (found !== undefined) return found
    }
    return undefined
  }
  let message: RenderMessage | undefined
  if (target.id !== undefined) {
    message = state.byId.get(target.id)
    // A tool/call-created placeholder may predate this chunk's authoritative
    // message id: bind by (turn, step) too, so the chunk appends to the same
    // row (absorbing the placeholder's tools) instead of orphaning it.
    if (message === undefined) message = findRow()
  } else {
    message = findRow()
  }

  if (message !== undefined && message.kind === 'assistant') {
    const next: RenderMessage = target.kind === 'reasoning'
      ? { ...message, reasoning: (message.reasoning ?? '') + target.text, seq: event.seq, time: event.time, flow: appendReasoningFlow(message.flow, target.text) }
      : { ...message, text: message.text + target.text, seq: event.seq, time: event.time, flow: appendTextFlow(message.flow, target.text) }
    replaceMessage(state, message, next)
    retargetTurnStep(state, key, message, next)
    return
  }

  const id = target.id
    ?? (key !== undefined ? syntheticId(`assistant,${key}`, event.seq) : syntheticId('assistant', event.seq))
  const created: RenderMessage = target.kind === 'reasoning'
    ? { id, kind: 'assistant', text: '', reasoning: target.text, seq: event.seq, time: event.time, firstSeenAt: event.time, pending: true, flow: [{ kind: 'reasoning', text: target.text }], ...turnStamp(state, turn), ...(step !== undefined ? { step } : {}) }
    : { id, kind: 'assistant', text: target.text, seq: event.seq, time: event.time, firstSeenAt: event.time, pending: true, flow: [{ kind: 'text', text: target.text, seq: event.seq }], ...turnStamp(state, turn), ...(step !== undefined ? { step } : {}) }
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
      firstSeenAt: event.time,
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
  const view = diffViewOf(event.view) ?? diffViewFromArguments(name, args)
  const tools = target.tools ?? []
  const existingIndex = tools.findIndex(tool => tool.callId === callId)
  const isNewCall = existingIndex === -1
  const nextTools: ToolCallInfo[] = isNewCall
    ? [...tools, { callId, name, state: 'running', ...(args !== undefined ? { arguments: args } : {}), ...(view !== undefined ? { view } : {}) }]
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
  // The result's meta is the authoritative "these files changed" record — the
  // page may keep the tool NAME but drop the arguments, and a turn can change
  // files through any tool. Keep it on the call so the report card survives.
  const meta = isRecord(data['meta']) ? data['meta'] : undefined
  // The result settles the row's state even when it carries no diff view (a
  // read/search/terminal result): the timeline's dot must stop spinning.
  const settled: ToolCallInfo['state'] = message['isError'] === true || message['error'] !== undefined ? 'error' : 'ok'
  for (const row of state.messages) {
    if (row.kind !== 'assistant' || row.tools === undefined) continue
    const index = row.tools.findIndex(tool => tool.callId === callId)
    if (index === -1) continue
    const nextTools = row.tools.map((tool, i) => i === index
      ? {
          ...tool,
          state: settled,
          ...(view !== undefined ? { view } : {}),
          ...(meta === undefined ? {} : (() => {
            const paths = metaPathsOf(tool.name, meta)
            return paths.length > 0 ? { metaPaths: paths } : {}
          })()),
        }
      : tool)
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
 * 宿主没给 diff 视图时，用工具参数自己拼一个。
 *
 * `edit` 的参数本来就是一对 old_string / new_string，`write` 是整段新内容，
 * 足够画出红绿 —— 比把原始 JSON 摊在屏幕上强得多。别的工具不猜：参数格式
 * 各家不同，猜错了不如老实显示原文。
 *
 * 只在 `event.view` 缺席时兜底：宿主给了就以宿主的为准（那是按已应用的
 * hunk 算出来的，比参数更准）。
 * @param name - 工具名。
 * @param raw - 事件的 arguments 原串（JSON）。
 */
function diffViewFromArguments(name: string, raw: string | undefined): ToolDiffView | undefined {
  if (raw === undefined || raw === '') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!isRecord(parsed)) return undefined
  const path = pickString(parsed['file_path']) ?? pickString(parsed['path']) ?? pickString(parsed['filePath'])
    ?? pickString(parsed['file']) ?? pickString(parsed['filename']) ?? pickString(parsed['target'])
  const newText = pickString(parsed['new_string']) ?? pickString(parsed['content']) ?? pickString(parsed['newText'])
  if (path === undefined || newText === undefined) return undefined
  const oldText = pickString(parsed['old_string']) ?? pickString(parsed['oldText']) ?? null
  return { card: 'diff', title: name, diffs: [{ path, oldText, newText }] }
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

/**
 * Record a turn's start time. `turn/start` renders nothing on its own, but the
 * turn tail needs the anchor to report how long the turn took.
 */
function applyTurnStart(state: FoldState, event: WireEvent): void {
  const data = isRecord(event.data) ? event.data : {}
  const turn = pickNumber(data['turn'])
  if (turn !== undefined) state.openTurn = turn
  // 新一轮从第一步重新数：不清会让新轮里缺 step 的分片沿用上一轮的步号。
  state.openStep = undefined
  if (turn !== undefined) state.turnStarts.set(turn, event.time)
  // 真的 turn/start 到了：外部种进来的"当前轮起点"就该退场，别留给下一轮。
  state.openTurnStart = undefined
}

/**
 * 窗口里最新的 assistant 轮号（收工定格判「这是不是当前那一轮」用）。
 */
function newestAssistantTurn(state: FoldState): number | undefined {
  let newest: number | undefined
  for (const message of state.messages) {
    if (message.kind !== 'assistant') continue
    const turn = state.messageTurn.get(message.id) ?? message.turn
    if (turn !== undefined && (newest === undefined || turn > newest)) newest = turn
  }
  return newest
}

/**
 * 一轮里最早的可信起点——`turn/start` 不在折叠状态里时的锚点兜底。
 *
 * turn/end 只带轮号，时长必须靠锚点算；而一个跑了十几分钟的回合，它的
 * turn/start 与窗口切口之间隔着几百条事件，翻页补读也够不着。这时退回"这一轮
 * 手头最早的证据"：行自己带的 turnStartAt（服务端折叠时盖上去的），或者最早
 * 那一行的时间。前者是真正的起点，后者比真正的起点晚几秒（生成第一步的耗时）
 * ——但永远有值，于是"完全没有用时"变成"略短一点的用时"。
 */
function earliestTurnTime(state: FoldState, turn: number): number | undefined {
  let earliest: number | undefined
  for (const message of state.messages) {
    if (message.kind !== 'assistant') continue
    if (state.messageTurn.get(message.id) !== turn) continue
    for (const candidate of [message.turnStartAt, message.time]) {
      if (typeof candidate !== 'number' || !Number.isFinite(candidate)) continue
      if (earliest === undefined || candidate < earliest) earliest = candidate
    }
  }
  return earliest
}

/**
 * Fold `deliverables/presented` (data = `{ turn, callId, files }`): the files a
 * `present` call declared this turn. Entries are validated like the desktop's
 * `isPresentedFile` (a non-empty path is mandatory) and deduped by path, so a
 * replayed window cannot double a card.
 */
function applyPresented(state: FoldState, event: WireEvent): void {
  const data = isRecord(event.data) ? event.data : {}
  const turn = pickNumber(data['turn'])
  const files = data['files']
  if (turn === undefined || !Array.isArray(files)) return
  const existing = state.presented.get(turn) ?? []
  const seen = new Set(existing.map(file => file.path))
  const next = [...existing]
  for (const entry of files) {
    if (!isRecord(entry)) continue
    const path = pickString(entry['path'])
    if (path === undefined || seen.has(path)) continue
    const description = pickString(entry['description'])
    seen.add(path)
    next.push(description === undefined ? { path } : { path, description })
  }
  if (next.length !== existing.length) state.presented.set(turn, next)
}

/** Workspace paths this turn's tool views mutated, in first-seen order. */
function producedFilesOf(messages: readonly RenderMessage[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const message of messages) {
    for (const tool of message.tools ?? []) {
      for (const path of producedPathsOf(tool)) {
        if (seen.has(path)) continue
        seen.add(path)
        out.push(path)
      }
    }
  }
  return out
}

/**
 * Tool names whose arguments name the file they change.
 *
 *  The diff view is the *live* half of a turn's output list: the mux presenters
 *  attach `view.diffs` to a tool event as it streams, and a page folded from
 *  history only carries it when that deployment's presenter happened to be
 *  registered for that call. The arguments are the durable half — they sit in
 *  the log, so any page folded from the log has them. Reading them is what
 *  keeps the turn-tail card alive across a reload.
 */
const MUTATING_TOOL_NAMES = new Set([
  'write', 'write_file', 'edit', 'edit_file', 'multiedit', 'multi_edit',
  'notebook_edit', 'apply_patch', 'create_file', 'str_replace_editor',
])

/** Argument keys that name the target file of a write-ish tool call. */
const ARG_PATH_KEYS = ['file_path', 'filePath', 'path', 'notebook_path', 'target_file', 'abs_path'] as const

/** Parse a tool call's raw arguments into an object, when they are one. */
function parseArguments(raw: string | undefined): Record<string, unknown> | undefined {
  if (raw === undefined || raw === '') return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * Files a tool RESULT's meta records as changed.
 *
 * `edit` results carry `{ path, diffs: [{ path, oldText, newText }] }`; a plain
 * write carries `{ path }`. Everything else (`read` carries `{ path }` too, a
 * shell call carries only `{ cwd }`) must not count as a produced file, so the
 * tool name guards the bare-path case.
 * @param toolName - the call's tool name.
 * @param meta - the `tool/result` event's meta object.
 * @returns changed file paths, deduped.
 */
function metaPathsOf(toolName: string, meta: Record<string, unknown>): string[] {
  const out: string[] = []
  const diffs = meta['diffs']
  if (Array.isArray(diffs)) {
    for (const raw of diffs) {
      if (!isRecord(raw)) continue
      const path = pickString(raw['path'])
      if (path !== undefined && path !== '') out.push(path)
    }
  }
  if (out.length === 0 && MUTATING_TOOL_NAMES.has(toolName.toLowerCase())) {
    const path = pickString(meta['path'])
    if (path !== undefined && path !== '') out.push(path)
  }
  return [...new Set(out)]
}

/**
 * Files one tool call reports mutating: its diff view first (that is what the
 * desktop renders), then the result meta (survives stripped arguments), then
 * the call's own arguments.
 */
function producedPathsOf(tool: ToolCallInfo): string[] {
  const fromView: string[] = []
  for (const diff of tool.view?.diffs ?? []) fromView.push(diff.path)
  if (fromView.length > 0) return fromView
  if ((tool.metaPaths?.length ?? 0) > 0) return [...(tool.metaPaths ?? [])]
  if (!MUTATING_TOOL_NAMES.has(tool.name.toLowerCase())) return []
  const args = parseArguments(tool.arguments)
  if (args === undefined) return []
  const out: string[] = []
  for (const key of ARG_PATH_KEYS) {
    const path = pickString(args[key])
    if (path !== undefined && path !== '') out.push(path)
  }
  return out
}

/** Files a `present` call declared, recovered from its arguments. */
function presentedFromArguments(tool: ToolCallInfo): TurnDeliverable[] {
  if (tool.name.toLowerCase() !== 'present') return []
  const args = parseArguments(tool.arguments)
  const files = args?.['files']
  if (!Array.isArray(files)) return []
  const out: TurnDeliverable[] = []
  for (const entry of files) {
    if (!isRecord(entry)) continue
    const path = pickString(entry['path'])
    if (path === undefined || path === '') continue
    const description = pickString(entry['description'])
    out.push(description === undefined ? { path } : { path, description })
  }
  return out
}

/** Row id of a turn's report row (stable, so a replayed window replaces it). */
function turnTailId(turn: number | undefined): string {
  return `turn-tail:${turn === undefined ? 'last' : turn}`
}

/** True for the turn-tail report row (never an assistant step row). */
function isTurnTailRow(message: RenderMessage): boolean {
  return message.id.startsWith('turn-tail:')
}

/** True when a report row actually lists something (an empty one renders as nothing). */
function reportsAnything(message: RenderMessage | undefined): boolean {
  if (message === undefined) return false
  return (message.deliverables?.length ?? 0) + (message.produced?.length ?? 0) > 0
}

/**
 * The turns the list shows that have finished — every turn whose card is already
 * decided (a running turn has no card yet, by design).
 *
 * 卡片的来源是日志里那一轮的 `tool/result` meta，不是页。页给的行可能被投影剥掉
 * 参数、被窗口截掉一轮早先的调用，据此推"产出了什么"一会儿对一会儿错；这个函数
 * 只回答"列表里有哪些回合已经收工"，由调用方去日志里把它们挨个折一遍。
 * @param rows - folded rows shown on screen.
 * @returns finished turn numbers, oldest first.
 */
export function completedTurns(rows: readonly RenderMessage[]): number[] {
  const out = new Set<number>()
  for (const row of rows) {
    if (row.turn === undefined || isTurnTailRow(row)) continue
    if ((row.tools ?? []).some(tool => tool.state === 'running')) continue
    out.add(row.turn)
  }
  return [...out].sort((left, right) => left - right)
}

/**
 * True when this page holds a completed turn that handed files back but no
 * report row for it — i.e. the card is missing although something was made.
 *
 * The page alone cannot tell whether such a turn exists: the tool names survive
 * every projection, the arguments and diff views need not. So this is the
 * condition under which the surface reads the events themselves instead of
 * guessing, and `mergeTurnReports` folds that answer back in.
 * @param rows - folded page rows.
 * @returns whether the page is missing at least one expected report row.
 */
export function expectsTurnReport(rows: readonly RenderMessage[]): boolean {
  return missingTurnReports(rows).length > 0
}

/**
 * The turns whose card the page cannot produce: a completed turn with rows yet
 * no report row carrying content.
 *
 * 判据不能挂在工具名上：窗口只留最近的几步时，一轮里早先的 `edit`/`write` 会被
 * 截掉，页里只剩 `pwsh` —— 真机就是这么"卡片彻底不见了"，而日志里那一轮明明改了
 * 文件（`tool/result` 的 meta 里有 diffs）。所以只要这一轮没卡就问一次日志，日志
 * 折出来没有产出才是真的没有。
 * @param rows - folded page rows.
 * @returns the turn numbers still missing a report, oldest first.
 */
export function missingTurnReports(rows: readonly RenderMessage[], openTurn?: number): number[] {
  const reported = new Set<number>()
  const hasRows = new Set<number>()
  for (const row of rows) {
    if (row.turn === undefined) continue
    if (isTurnTailRow(row)) {
      if (reportsAnything(row)) reported.add(row.turn)
      continue
    }
    // 跑着的行不算"已完成"：那一轮结束前本来就不该有卡。
    if ((row.tools ?? []).some(tool => tool.state === 'running')) continue
    // 纯聊天回合（一个工具都没调）不可能产出文件，不必为它读日志。
    if ((row.tools ?? []).length === 0) continue
    hasRows.add(row.turn)
  }
  // 正在跑的那一轮不算「缺卡」：它本来就不该有卡；回读日志只会把还没结束的回合
  // 当成已完成（真机：底部还在"输出中…"，卡片却已是 ✅完成）。
  return [...hasRows]
    .filter(turn => !reported.has(turn))
    .filter(turn => turn !== openTurn)
    .sort((left, right) => left - right)
}

/**
 * Merge one authoritative report row over a page-guessed one.
 *
 * 页里那张是猜的（窗口截断会让它少列文件），日志折出来的才是这一轮真正交回的
 * 东西。所以以日志那张为准（时间、序号、清单都取它），但文件清单取并集 —— 万一
 * 日志翻页没翻到整轮，也不至于把页里已经显示的文件抹掉。
 * @param guessed - the row already on screen.
 * @param recovered - the row folded from the event log.
 * @returns the row to display.
 */
function preferRecoveredReport(guessed: RenderMessage, recovered: RenderMessage): RenderMessage {
  const deliverables = [...(recovered.deliverables ?? [])]
  const seenDeliverable = new Set(deliverables.map(file => file.path))
  for (const file of guessed.deliverables ?? []) {
    if (seenDeliverable.has(file.path)) continue
    seenDeliverable.add(file.path)
    deliverables.push(file)
  }
  const produced = [...(recovered.produced ?? [])]
  const seenProduced = new Set(produced)
  for (const path of guessed.produced ?? []) {
    if (seenProduced.has(path)) continue
    seenProduced.add(path)
    produced.push(path)
  }
  return {
    ...recovered,
    ...(deliverables.length > 0 ? { deliverables } : {}),
    ...(produced.length > 0 ? { produced } : {}),
  }
}

/**
 * Fold report rows recovered from raw events into a page that lacked them.
 *
 * The recovered rows are authoritative: they come from the turn's own events,
 * while a page-supplied row is only what that projection happened to keep. A
 * page row for the same turn is therefore replaced (its files are unioned in,
 * never dropped). A recovered row lands right after that turn's last row, or at
 * the end when the page never saw the turn.
 * @param rows - current folded rows.
 * @param tails - report rows folded from the event log.
 * @returns the merged row list.
 */
export function mergeTurnReports(
  rows: readonly RenderMessage[],
  tails: readonly RenderMessage[],
): RenderMessage[] {
  let out = [...rows]
  for (const tail of tails) {
    if (!isTurnTailRow(tail) || !reportsAnything(tail)) continue
    const existing = out.find(row => row.id === tail.id)
    if (existing !== undefined) {
      out = out.map(row => (row.id === tail.id
        ? (reportsAnything(existing) ? preferRecoveredReport(existing, tail) : tail)
        : row))
      continue
    }
    const sameTurn = out.filter(row => row.turn === tail.turn && !isTurnTailRow(row))
    const anchor = sameTurn[sameTurn.length - 1]
    if (anchor === undefined) {
      out.push(tail)
      continue
    }
    out.splice(out.indexOf(anchor) + 1, 0, tail)
  }
  return out
}

/**
 * Carry the report rows already on screen into a freshly loaded row list.
 *
 * 进会话时列表会被整个换掉好几次（缓存页 → 网络页 → 实时重放基线）。页自己不带
 * 报告行，换一次卡片就闪没一次；用户看到的就是"点进会话，卡片突然又消失了"。
 * 这一份只保留"新列表里仍然有那个回合"的报告行，其余交给调用方重新补读。
 * @param previous - the rows that were on screen.
 * @param next - the rows replacing them.
 * @returns the new rows, with the still-relevant report rows kept.
 */
export function keepTurnReports(
  previous: readonly RenderMessage[],
  next: readonly RenderMessage[],
): RenderMessage[] {
  const reportRows = previous.filter(row => isTurnTailRow(row) && reportsAnything(row) && row.turn !== undefined)
  const carried = reportRows.filter(row =>
    next.some(other => other.turn === row.turn && !isTurnTailRow(other)),
  )
  // 页里**完全没有**这一轮的行（回合的全部事件都在窗口之外）：也要把刚看到的那张卡
  // 留下，最多留最新 N 轮。否则就是真机那句「交付结果卡片闪一下才出现」——换列表时
  // 卡被丢掉，几秒后 cardRecovery 读到 turn/end 再补回来，中间那一下就是空白。
  //
  // 只能留最近几轮：留全量就变成「上一轮的卡片永远赖在最新位置」。
  // 只在**尾部相邻**时留：卡属于比页里最新一轮还旧一点的那一轮（差距不超过
  // KEEP_ORPHAN_REPORT_TURNS）。跳到深历史时页里最新一轮离得很远，卡必须掉，否则
  // 「上一轮的卡片赖在最新位置」——那正是 keepTurnReports 当初只认页内回合的原因。
  const newestInPage = next.reduce((max, row) => Math.max(max, row.turn ?? 0), 0)
  const orphaned = reportRows
    .filter(row => {
      if (newestInPage === 0) return false
      if (next.some(other => other.turn === row.turn)) return false
      const turn = row.turn ?? 0
      return turn <= newestInPage && newestInPage - turn <= KEEP_ORPHAN_REPORT_TURNS
    })
    .sort((left, right) => (right.turn ?? 0) - (left.turn ?? 0))
    .slice(0, KEEP_ORPHAN_REPORT_TURNS)
  const kept = [...carried, ...orphaned]
  if (kept.length === 0) return [...next]
  return mergeTurnReports(next, kept)
}

/**
 * 一行的身份：跟 surface 的 React key 同源（(turn, step) 优先，否则 id）。
 * 只有同身份的两行才谈得上"谁更全"。
 */
/** 换列表时最多替屏幕上保留多少「页窗口之外的更早行」。 */
const MAX_KEPT_OLDER_ROWS = 200
/** 换列表时，页里已经没有那一轮的行，仍替屏幕上保留几张最近的交付卡。 */
export const KEEP_ORPHAN_REPORT_TURNS = 2

/**
 * 给缺轮号的助手行补上轮号（**合并之前**跑，全客户端只此一份实现）。
 *
 * 为什么必须有：行的身份是 `(turn, step)`，而实时折出来的行早期没有 turn。
 * 之前身份会退化到 `row.id`，而缓存快照 / 尾页 / 实时帧三个生产者给的 id 各不相同
 * —— 同一行于是被存成两条，屏幕上就是同一轮两张过程卡（进会话那一刻最容易撞上）。
 *
 * 规则保守：中间没有用户行插进来，就沿用上一条助手行的轮号；遇到用户行即清空。
 * 没有需要补的行时返回**原数组**（保持引用，避免多余重渲染）。
 */
export function normalizeTranscriptRows(rows: readonly RenderMessage[]): readonly RenderMessage[] {
  let carried: number | undefined
  let out: RenderMessage[] | undefined
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!
    if (row.kind === 'user') {
      carried = undefined
      continue
    }
    if (row.kind !== 'assistant') continue
    if (row.turn !== undefined) {
      carried = row.turn
      continue
    }
    if (carried === undefined) continue
    if (out === undefined) out = rows.slice()
    out[i] = { ...row, turn: carried }
  }
  return out ?? rows
}

/**
 * 两行"画出来会一模一样"吗（用来复用旧对象，避免无意义重渲染）。
 *
 * 为什么需要：进会话时网络页会给出同一行的一份新对象（内容相同），React 收到新对象
 * 就重渲染 —— 交付卡、工具卡都会"重新画一遍"，用户看到的就是"卡片重新渲染显示"。
 * 内容等价时**返回旧对象**，React 就跳过这次渲染。
 *
 * 只比较影响渲染的字段，不比对象引用，也不做深比较（开销可控）。
 */
function sameRenderedRow(left: RenderMessage, right: RenderMessage): boolean {
  if (left === right) return true
  if (left.kind !== right.kind) return false
  if (left.turn !== right.turn || left.step !== right.step) return false
  if (left.seq !== right.seq) return false
  if (left.pending !== right.pending) return false
  if ((left.text ?? '') !== (right.text ?? '')) return false
  if ((left.reasoning ?? '') !== (right.reasoning ?? '')) return false
  if ((left.toolSummary ?? '') !== (right.toolSummary ?? '')) return false
  const leftTools = left.tools ?? []
  const rightTools = right.tools ?? []
  if (leftTools.length !== rightTools.length) return false
  for (let index = 0; index < leftTools.length; index += 1) {
    const a = leftTools[index]
    const b = rightTools[index]
    if (a === undefined || b === undefined) return false
    if (a.callId !== b.callId || a.state !== b.state || a.name !== b.name) return false
  }
  const leftFiles = left.deliverables ?? []
  const rightFiles = right.deliverables ?? []
  if (leftFiles.length !== rightFiles.length) return false
  for (let index = 0; index < leftFiles.length; index += 1) {
    if (leftFiles[index]?.path !== rightFiles[index]?.path) return false
  }
  if ((left.flow?.length ?? 0) !== (right.flow?.length ?? 0)) return false
  return true
}

function rowIdentity(row: RenderMessage): string {
  // 身份只描述「这一行在对话里的位置」，且必须**在流式过程中保持不变**：
  //   · 交付卡按轮唯一（它和本轮最后一条助手行可能共享 seq，先认轮号才不会并进正文）；
  //   · 有 (turn, step) 就按它 —— 宿主折叠、实时帧、缓存快照给的都是这个位置；
  //   · 有 turn 但还没分步（流式早期）：按「本轮的未分步行」算一个身份，**不能按 seq**，
  //     否则每个 chunk 都换身份，同一条消息会被当成一串新行（重复的过程条正是这么来的）；
  //   · 连 turn 都没有（极早期）：才退 seq / startSeq，最后退 id。
  if (row.kind === 'turn' && row.turn !== undefined) return `turn${row.turn}`
  if (row.turn !== undefined && row.step !== undefined) return `t${row.turn}.${row.step}`
  if (row.turn !== undefined && row.pending === true) return `t${row.turn}~`
  if (typeof row.seq === 'number' && Number.isFinite(row.seq)) return `s${row.seq}`
  if (typeof row.startSeq === 'number' && Number.isFinite(row.startSeq)) return `ss${row.startSeq}`
  return `id${row.id}`
}


/**
 * 同一次工具调用的两个版本，合并成"状态取新的、内容取全的"。
 *
 * 页（宿主折叠窗口）会把参数剥掉、把早先的调用截掉；屏幕上那份是当时逐个事件折出来
 * 的，参数和 diff 视图都还在。换列表时不能因为页更"新"就把这些丢掉 —— 丢了就是真机
 * 那句"拉历史的那一下屏幕闪一下"：卡片、diff、命令参数集体消失，再异步补回来。
 */
function richerTool(next: ToolCallInfo, previous: ToolCallInfo | undefined): ToolCallInfo {
  if (previous === undefined) return next
  return {
    ...previous,
    ...next,
    // 参数/视图页那边常常是空的：空就留屏幕上那份（状态仍用页的，它更新）。
    ...(next.arguments === undefined || next.arguments === '' ? { arguments: previous.arguments } : {}),
    ...(next.view === undefined ? { view: previous.view } : {}),
  }
}

/**
 * 把新列表里"比屏幕上更残缺"的行，换成屏幕上那份更全的版本。
 *
 * 进会话的顺序是：内存快照（当时逐事件折出来的完整版）→ 网络尾页（宿主投影，参数被
 * 剥掉、不带报告行）→ 铺开的更早几页。页更"权威"，但更**穷**：直接整份替换，屏幕上
 * 就会看到卡片消失、diff 收起、工具行参数清空，然后卡片补读再异步挂回来 —— 用户看到
 * 的就是"拉历史的时候闪一下"。
 *
 * 所以换列表时逐行比较：同身份的两行合并（状态/时间用新的，参数/视图/报告用全的），
 * 只有真正变了才产生新行；一行都没变时**原样返回上一个数组**，React 不重绘。
 *
 * @param previous - 屏幕上那份（可能更全）。
 * @param next - 新折出来的那份（更新，但可能更穷）。
 * @returns the rows to render; `previous` itself when nothing changed.
 */
export function preferRicherRows(
  previousInput: readonly RenderMessage[],
  nextInput: readonly RenderMessage[],
): RenderMessage[] {
  // 三个生产者（缓存快照 / 尾页 / 实时帧）的行都从这里进，先统一补轮号再谈身份 ——
  // 身份一旦只认位置，同一行就不可能出现两份。
  const previous = normalizeTranscriptRows(previousInput)
  const next = normalizeTranscriptRows(nextInput)
  if (previous.length === 0 || next.length === 0) return [...next]
  const previousById = new Map<string, RenderMessage>()
  /** step → 屏幕上的那一行：只在**来行缺轮号**时兜底用。 */
  const previousByStep = new Map<number, RenderMessage>()
  for (const row of previous) {
    previousById.set(rowIdentity(row), row)
    if (row.turn !== undefined && row.step !== undefined) previousByStep.set(row.step, row)
  }
  // 页是一段窗口：它比屏幕上那份**短**是常态（尾页 25 行 vs 屏幕上 120 行）。窗口
  // 覆盖不到的、更早的那些行不能跟着被丢掉 —— 丢了就是"拉历史那一下列表塌一半再长
  // 回来"，正是真机看到的那一闪。保留比页首更早的那一段（上限防止无限增长）。
  const firstNextSeq = next[0]!.startSeq ?? next[0]!.seq
  const keptOlder = previous
    .filter(row => (row.startSeq ?? row.seq) < firstNextSeq)
    .slice(-MAX_KEPT_OLDER_ROWS)
  const merged: RenderMessage[] = []
  /** 身份 → 它在 merged 里的下标。同身份的行只出现一次，后来者就地合并。 */
  const slots = new Map<string, number>()
  const pushOrMerge = (row: RenderMessage): void => {
    const identity = rowIdentity(row)
    const at = slots.get(identity)
    if (at === undefined) {
      slots.set(identity, merged.length)
      merged.push(row)
      return
    }
    // 已经在数组里（来自 keptOlder 的更早那份，或者页里先到的同一行）：就地合并，
    // 而不是丢掉或再推一份。以前 turn 行（交付卡）走「页说啥就是啥」的快捷路径：
    // ①页里没有这张卡、它又被 keptOlder 留着时，页再推一遍 → 同一行两份，屏幕上就是
    // 多条过程条 + 闪一下；②页那份是「瘦版」（没有 plan / 交付物 / 用时），直接把更全的
    // 那份顶掉 → 计划和交付卡消失。现在所有行走同一条合并路径。
    // 内容等价时**复用旧对象**：React 拿到同一个引用就跳过这次渲染，
    // 交付卡/工具卡不会在"网络页到达"那一拍被重画一遍（真机："卡片重新渲染显示"）。
    const mergedRow = mergeRows(merged[at]!, row)
    merged[at] = sameRenderedRow(merged[at]!, mergedRow) ? merged[at]! : mergedRow
  }
  for (const older of keptOlder) pushOrMerge(older)
  for (const row of next) {
    // 真机（2026-10-29）：尾页每步一行（turn 98 step 3），实时流折出来的那段还没经历
    // `turn/start`、轮号是 undefined，id 又是另一套 —— 只按 id 找不到同一行，于是两行
    // 都留着，同一轮被画成两张过程卡（时间还对得上，最容易误认为「跑了两遍」）。
    // 来行缺轮号但带着 step 时，用 step 找回屏幕上那一行就地合并。
    const byId = previousById.get(rowIdentity(row))
    const byStep = byId === undefined && row.turn === undefined && row.step !== undefined
      ? previousByStep.get(row.step)
      : undefined
    const before = byId ?? byStep
    pushOrMerge(before === undefined ? row : mergeRows(before, row))
  }
  // 同一个 message id 只能留一份：页切会把一个回合切成「半截行」（只有第一步）和
  // 「整回合行」（startSeq..最后一步）两个版本，两版都进列表就是两张同 id 的卡；而
  // 半截行一旦胜出，这一回合后面几步的正文就再也渲染不出来 —— 索引收过那些正文，
  // 搜索于是指到一段屏幕上不存在的文字（真机：命中 seq=1165 落在一张只画到 1136
  // 的卡上，一个高亮都没有）。这里按「跨度大、正文全」的那份收敛。
  const deduped: RenderMessage[] = []
  const seenAt = new Map<string, number>()
  for (const row of merged) {
    const at = seenAt.get(row.id)
    if (at === undefined) {
      seenAt.set(row.id, deduped.length)
      deduped.push(row)
      continue
    }
    deduped[at] = heavierRow(deduped[at]!, row)
  }
  return deduped
}

/**
 * 同一身份的两行合并：状态/时间用新的（页更权威），内容用全的（屏幕上那份是逐事件
 * 折出来的，参数、diff、交付物、计划都还在）。
 */
function mergeRows(before: RenderMessage, row: RenderMessage): RenderMessage {
  const tools = row.tools === undefined
    ? before.tools
    : row.tools.map(tool => richerTool(tool, before.tools?.find(other => other.callId === tool.callId)))
  const unionTools = tools === undefined
    ? undefined
    : [
      ...tools,
      ...(before.tools ?? []).filter(old => !tools.some(tool => tool.callId === old.callId)),
    ]
  const richer: RenderMessage = {
    ...before,
    ...row,
    // 缺轮号的一侧跟着另一侧补齐（与 coalesce 同一条规则）：标识客户是同一轮，
    // 不补的话下游认不出「这一行属于正在跑的第 98 轮」，过程卡的状态与秒表都会丢。
    ...(row.turn === undefined && before.turn !== undefined ? { turn: before.turn } : {}),
    ...(row.step === undefined && before.step !== undefined ? { step: before.step } : {}),
    // 正文只增不减：页常常是**重叠窗口**，同一行会给一份截断版（比如只到这一页的
    // 边界），拿它覆盖屏幕上的完整版 = 正文「往回缩」闪一下。前缀关系时保留长的。
    ...(row.text === '' && before.text !== '' ? { text: before.text } : {}),
    ...(row.text !== '' && before.text !== '' && row.text.length < before.text.length
      && before.text.startsWith(row.text)
      ? { text: before.text }
      : {}),
    ...(unionTools !== undefined && unionTools.length > 0 ? { tools: unionTools } : {}),
    ...(row.reasoning === undefined && before.reasoning !== undefined ? { reasoning: before.reasoning } : {}),
    ...(row.flow === undefined && before.flow !== undefined ? { flow: before.flow } : {}),
    ...(row.deliverables === undefined && before.deliverables !== undefined ? { deliverables: before.deliverables } : {}),
    ...(row.produced === undefined && before.produced !== undefined ? { produced: before.produced } : {}),
    // 计划是客户端折叠时才挂上去的（宿主的页窗口里常常没有 todo/write）：页那份缺了
    // 就留屏幕上这份，否则一换页胶囊就没了。
    ...(row.plan === undefined && before.plan !== undefined ? { plan: before.plan } : {}),
    ...(row.durationMs === undefined && before.durationMs !== undefined ? { durationMs: before.durationMs } : {}),
    // 跨度取并集：页把一轮切在中间时，两版各覆盖半截（半截行 1136 起、整回合行
    // 1137 起）。只让页那份说话会把起点的更早半截丢掉，搜索命中就落到一段没画的正文上。
    ...(Math.min(before.startSeq ?? before.seq, row.startSeq ?? row.seq) === (row.startSeq ?? row.seq)
      ? {}
      : { startSeq: Math.min(before.startSeq ?? before.seq, row.startSeq ?? row.seq) }),
    ...(Math.max(before.seq, row.seq) === row.seq ? {} : { seq: Math.max(before.seq, row.seq) }),
  }
  // 内容没变就复用屏幕上那个对象：React 的 memo 挡住整行重绘。
  return sameRowContent(before, richer) ? before : richer
}

/**
 * 同一个 id 的两版行：留跨度大、正文全的那份。
 *
 * 页（宿主的折叠窗口）会按"这一页到哪"把回合切在中间，同一份 assistant 内容因此可能
 * 以两种形状到达：只含第一步的半截行，和整回合行。它们不是"新/旧"，而是"全/缺"，
 * 取内容多的那份；工具按 callId 求并集，失败/截断标记任一为真即真，跨度取并集。
 */
function heavierRow(left: RenderMessage, right: RenderMessage): RenderMessage {
  const weight = (row: RenderMessage): number => {
    const flowLen = (row.flow ?? []).reduce((sum, part) => sum + ((part as { text?: string }).text ?? '').length, 0)
    return (row.stepSeqs?.length ?? 0) * 1_000_000 + flowLen + row.text.length + (row.reasoning ?? '').length
  }
  const heavy = weight(right) > weight(left) ? right : left
  const light = heavy === left ? right : left
  const heavyTools = heavy.tools
  const tools = heavyTools === undefined
    ? light.tools
    : [...heavyTools, ...(light.tools ?? []).filter(old => !heavyTools.some(tool => tool.callId === old.callId))]
  return {
    ...light,
    ...heavy,
    seq: Math.max(left.seq, right.seq),
    ...(left.startSeq === undefined && right.startSeq === undefined
      ? {}
      : { startSeq: Math.min(left.startSeq ?? left.seq, right.startSeq ?? right.seq) }),
    ...(tools === undefined || tools.length === 0 ? {} : { tools }),
    ...(left.failed === true || right.failed === true ? { failed: true } : {}),
    ...(left.maxTokens === true || right.maxTokens === true ? { maxTokens: true } : {}),
  }
}

/**
 * 两行"画出来"是否一致。只比会显示的字段，够了就复用对象。
 *
 * 比的是**合并后**的行，判据必须偏保守（宁可判"变了"多绘一次，也不要漏掉一次变化）。
 */
function sameRowContent(left: RenderMessage, right: RenderMessage): boolean {
  const toolKey = (row: RenderMessage): string => (row.tools ?? [])
    .map(tool => `${tool.callId}\u0002${tool.name}\u0002${tool.state}\u0002${(tool.arguments ?? '').length}\u0002${tool.view === undefined ? 0 : 1}`)
    .join('\u0002')
  return left.id === right.id
    && left.kind === right.kind
    && left.text === right.text
    && left.reasoning === right.reasoning
    && left.seq === right.seq
    && left.time === right.time
    && left.turn === right.turn
    && left.step === right.step
    && left.pending === right.pending
    && left.failed === right.failed
    && left.maxTokens === right.maxTokens
    && left.durationMs === right.durationMs
    && left.turnStartAt === right.turnStartAt
    && left.firstSeenAt === right.firstSeenAt
    && left.startSeq === right.startSeq
    && (left.flow?.length ?? 0) === (right.flow?.length ?? 0)
    && toolKey(left) === toolKey(right)
    && (left.deliverables ?? []).map(item => item.path).join('\u0002') === (right.deliverables ?? []).map(item => item.path).join('\u0002')
    && (left.produced ?? []).join('\u0002') === (right.produced ?? []).join('\u0002')
    && (left.images ?? []).map(image => image.attachmentId).join('\u0002') === (right.images ?? []).map(image => image.attachmentId).join('\u0002')
    && (left.stepTexts ?? []).length === (right.stepTexts ?? []).length
    && (left.stepSeqs ?? []).join(',') === (right.stepSeqs ?? []).join(',')
}

/**
 * Rebuild the turn-tail rows a folded page did not carry.
 *
 *  The row is normally produced by {@link applyTurnEnd} while folding the live
 *  stream: `turn/end` brings the turn's final seq, and the delivery list is
 *  already in `state.presented`. A page served from the host's folded window, or
 *  a cached page whose turn ended while the tab was closed, arrives as ROWS —
 *  there is no `turn/end` left to fold, so a turn whose card is missing stays
 *  missing forever and the card the user just saw disappears on refresh.
 *
 *  Everything the card needs is in the rows themselves: the declared files in a
 *  `present` call's arguments, the output files in each write-ish call's
 *  arguments (or its diff view). So the surface can rebuild it — one row per
 *  completed turn that has something to report, right after that turn's last
 *  row. A turn still running is left alone: its card appears when the turn
 *  ends, exactly like a live one.
 *
 *  An existing report row is trusted only when it actually reports something:
 *  a row with no files renders as nothing, and such a row is what an older
 *  folded window leaves behind (it emitted the tail for its clock alone). Left
 *  alone, that empty row both hides the card and blocks this rebuild.
 */
export function ensureTurnTails(rows: readonly RenderMessage[], openTurn?: number): RenderMessage[] {
  const existingTail = new Map<number, RenderMessage>()
  const lastRowOfTurn = new Map<number, RenderMessage>()
  const running = new Set<number>()
  for (const row of rows) {
    if (isTurnTailRow(row)) {
      if (row.turn !== undefined) existingTail.set(row.turn, row)
      continue
    }
    if (row.turn === undefined) continue
    lastRowOfTurn.set(row.turn, row)
    for (const tool of row.tools ?? []) {
      if (tool.state === 'running') running.add(row.turn)
    }
  }
  // 正在跑的那一轮**绝不猜卡**（`openTurn` 由实时流给出，不靠任何推断）。
  //
  // 真机现场（2026-10-30）：会话明明还在跑（底部"输出中…"），上面那张卡却写着
  // ✅完成、用时 1分45秒。原因就在这里：那一轮的工具都跑完了（没进 running 集合），
  // 但模型还在输出正文、turn/end 尚未出现；猜卡只认工具状态，于是把「工具跑完」
  // 当成了「这一轮完成」。判据必须来自**实时流的活跃轮次**，不能靠工具状态猜。
  const pending = [...lastRowOfTurn.keys()].filter(turn => (
    !running.has(turn)
    && !reportsAnything(existingTail.get(turn))
    && turn !== openTurn
  ))
  if (pending.length === 0) return [...rows]
  /** Rebuilt report row, keyed by turn (replaces the empty one in place, or is appended). */
  const rebuilt = new Map<number, RenderMessage>()
  /** Empty report rows whose turn has nothing to report after all: drop them. */
  const dropped = new Set<string>()
  for (const turn of pending) {
    const targets = rows.filter(row => row.turn === turn && !isTurnTailRow(row))
    const deliverables: TurnDeliverable[] = []
    const seen = new Set<string>()
    for (const row of targets) {
      for (const tool of row.tools ?? []) {
        for (const file of presentedFromArguments(tool)) {
          if (seen.has(file.path)) continue
          seen.add(file.path)
          deliverables.push(file)
        }
      }
    }
    const declared = new Set(deliverables.map(file => file.path))
    const produced = producedFilesOf(targets).filter(path => !declared.has(path))
    const existing = existingTail.get(turn)
    if (deliverables.length === 0 && produced.length === 0) {
      if (existing !== undefined) dropped.add(existing.id)
      continue
    }
    const anchor = existing ?? lastRowOfTurn.get(turn)
    if (anchor === undefined) continue
    rebuilt.set(turn, {
      ...anchor,
      id: turnTailId(turn),
      kind: 'turn',
      text: '',
      turn,
      // 报告行不是某一步的行：把锚点行的 step 清掉。留着它的话，行 key 会退化成
      // `(turn, step)`，和锚点行撞成同一个 key —— React 遇到重复 key 的行为是
      // "可能重复或丢弃子节点"，真机表现就是卡片时有时无。
      step: undefined,
      // 原有行可能带着它自己的时钟（老窗口只有时长、没有清单）：留着，
      // 只把清单补上。
      ...(deliverables.length > 0 ? { deliverables } : {}),
      ...(produced.length > 0 ? { produced } : {}),
    })
  }
  if (rebuilt.size === 0 && dropped.size === 0) return [...rows]
  const out: RenderMessage[] = []
  for (const row of rows) {
    if (dropped.has(row.id)) continue
    const replacement = row.turn === undefined ? undefined : rebuilt.get(row.turn)
    if (isTurnTailRow(row)) {
      out.push(replacement ?? row)
      continue
    }
    out.push(row)
    if (row.turn !== undefined && lastRowOfTurn.get(row.turn) === row) {
      // Only append when the turn had no report row to replace.
      if (replacement !== undefined && existingTail.get(row.turn) === undefined) out.push(replacement)
    }
  }
  return out
}

function applyTurnEnd(state: FoldState, event: WireEvent): void {
  const data = isRecord(event.data) ? event.data : {}
  const turn = pickNumber(data['turn'])
  state.openTurn = undefined
  const reason = isRecord(data['reason']) ? data['reason'] : {}
  const failed = reason['kind'] === 'error'
  const maxTokens = reason['kind'] === 'max-tokens'

  // The anchor is the turn/start event's own time. It is usually in the window,
  // but a turn that ran for ten minutes has hundreds of events between its start
  // and the page cut, so the window (and the backfill peek behind it) never sees
  // it — and turn/end carries no duration, so the whole turn reports no elapsed
  // time. Fall back to the earliest row this turn produced: it is a few seconds
  // after the true start (the time to produce that first step) and always inside
  // the window, which turns "no clock at all" into "a clock that is a little
  // short". A known-approximate duration beats a blank one.
  //
  // 但"短一截"在真机上是可见的倒退：秒表一路数到 8分37秒，收工瞬间定格成 6分48秒
  // （窗口起点比真起点晚了 109 秒）。宿主的页面/`mobile.turnState` 带着真起点
  // （page.turnStartAt），客户端会把它种进 state.openTurnStart；只要这一轮是窗口里
  // 最新的那一轮，就用它定格 —— 这才是和桌面端一致的数字。旧回合的 turn/end
  // （翻页补读、乱序帧）不能拿它当锚点，否则会把旧回合的用时算成天文数字。
  const newestTurn = newestAssistantTurn(state)
  const anchored = turn === undefined ? undefined : state.turnStarts.get(turn)
  const external = turn !== undefined && newestTurn !== undefined && turn >= newestTurn ? state.openTurnStart : undefined
  const startedAt = anchored ?? external ?? (turn === undefined ? undefined : earliestTurnTime(state, turn))
  const durationMs = startedAt === undefined ? undefined : Math.max(0, event.time - startedAt)

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
  // Turn ended abnormally? Only then are still-open calls genuinely interrupted.
  // A normal completion that still shows an open call means its `tool/result`
  // never reached this fold (a dropped frame, or a window rebuilt mid-turn) — the
  // work itself finished. Marking those `stopped` there is what made a finished
  // turn's head flip from 已完成 to 已中断 while the user watched, and flip back
  // to 已完成 on re-entering the session (the server-side fold has the results).
  const aborted = reason['kind'] !== undefined && reason['kind'] !== 'completed'
  // 记住这一轮的收工时刻：往上翻页补进来的行来自切口之前那一页，那里没有这条
  // turn/end，只有记住它才能把这些行补齐（否则同一轮里一半行有用时、一半没有）。
  if (turn !== undefined) state.turnEnds.set(turn, event.time)
  for (const message of targets) {
    const wasPending = message.pending === true
    // The desktop row's `stopped` state belongs to abandoned calls only.
    const openTools = (message.tools ?? []).some(tool => tool.state === 'running')
    const next: RenderMessage = {
      ...message,
      ...(openTools
        ? {
            tools: (message.tools ?? []).map(tool => tool.state === 'running'
              ? { ...tool, state: aborted ? 'stopped' as const : 'ok' as const }
              : tool),
          }
        : {}),
      ...(wasPending ? { pending: false } : {}),
      ...(failed ? { failed: true } : {}),
      ...(maxTokens ? { maxTokens: true } : {}),
      // The process head lives on the assistant row, so the turn's clock must
      // land there too — not only on the turn-tail row.
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(startedAt !== undefined ? { turnStartAt: startedAt } : {}),
      // Preserve each step's own final-event seq. Collapsing every message
      // onto turn/end makes same-turn ordering depend on arbitrary ids.
      time: event.time,
    }
    replaceMessage(state, message, next)
    retargetTurnStep(state, turnStepKeyOf(message), message, next)
  }

  const deliverables = turn === undefined ? undefined : state.presented.get(turn)
  const declared = new Set((deliverables ?? []).map(file => file.path))
  const produced = producedFilesOf(targets).filter(path => !declared.has(path))
  // The turn tail (the desktop's `turn-tail` node): what the turn cost and what
  // it handed back. Emitted only when there is something to report, and keyed by
  // turn so a replayed window replaces its row instead of stacking a new one.
  // 计时已经在过程组折叠头里（每一行都盖了 durationMs），尾巴只报"交回了什么"：
  // 没有交付物也没有产出文件时不生成尾巴行，免得每次回复后面挂个空壳。
  // 收工时手上的计划：未完成的项按宿主语义归一成已完成（这一轮结束了）。
  const planState = state.plan
  const planForTail = planState === undefined || planState.items.length === 0
    ? undefined
    : {
        items: planState.items.map(item => (item.status === 'in_progress'
          ? { ...item, status: 'completed' as const }
          : item)),
      }
  // 有文件、**或者**写过计划才出这条尾巴：计划也是「这一轮交回了什么」的一部分，
  // 而且是状态条收起之后唯一的计划入口。
  const hasReport = (deliverables?.length ?? 0) > 0 || produced.length > 0 || planForTail !== undefined
  if (!hasReport) return
  const tailId = turnTailId(turn)
  const tail: RenderMessage = {
    id: tailId,
    kind: 'turn',
    text: '',
    seq: event.seq,
    time: event.time,
    ...(turn !== undefined ? { turn } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(deliverables !== undefined ? { deliverables } : {}),
    ...(produced.length > 0 ? { produced } : {}),
    ...(planForTail === undefined ? {} : { plan: planForTail }),
  }
  const existingTail = state.byId.get(tailId)
  if (existingTail !== undefined) replaceMessage(state, existingTail, tail)
  else {
    state.messages.push(tail)
    state.byId.set(tailId, tail)
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
 * True for a user row the phone never paints: an injected (`source.kind`
 * anything but 'user') user/message, hidden by message-row.tsx's guard.
 * Mirrors that guard EXACTLY, so the coalescer's notion of "invisible" can
 * never drift from what is actually on screen; a future injected kind is
 * transparent for free.
 */
function isHiddenInjectedRow(message: RenderMessage): boolean {
  // 只有这四种**纯噪音**注入行是透明的：它们在屏幕上从不渲染（message-row 的守卫）。
  // 触发类唤醒消息（agent-message / subagent-settled / schedule / team-message / …）**不是**
  // 透明的 —— 它们要独立成行才能渲染成卡片；当成透明的话会被并进助手那一轮，正文被折进
  // 过程卡里（真机实测："消息卡片被纳入到了过程卡片中"，独立卡片根本不出现）。
  // 这张表与 message-row.tsx 的 TRIGGER_TITLES 互补：那边出的卡 = 这边不透明的行。
  return message.kind === 'user' && message.sourceKind !== undefined && message.sourceKind !== 'user'
    && !isTriggerSourceKind(message.sourceKind)
}

/**
 * 宿主唤醒消息的来源类型。与桌面端 ui-chat 的 turn-trigger.ts 同一张表：
 * 这些消息在手机端要出折叠卡（message-row.tsx），并且必须打断 assistant 折叠链。
 */
const TRIGGER_SOURCE_KINDS = new Set([
  'agent-message',
  'team-message',
  'subagent-settled',
  'webhook',
  'schedule',
  'tool-jobs',
  'cordis-host-runner',
  'goal',
])

/** True when this source kind is a wake message the mobile renders as its own card. */
export function isTriggerSourceKind(sourceKind: string): boolean {
  return TRIGGER_SOURCE_KINDS.has(sourceKind)
}

/**
 * 卡片标题。文案与桌面端 locale 的 message.trigger.* 一致。
 * 这张表是**唯一真源**：判"是否出卡"（message-row.tsx）与判"是否透明"
 * （上面的 isHiddenInjectedRow）都读它，避免两份清单各自演化后漂移。
 */
const TRIGGER_TITLES: Record<string, string> = {
  'agent-message': '收到任务消息',
  'team-message': '收到团队消息',
  'subagent-settled': '子任务状态更新',
  'webhook': '收到外部事件',
  'schedule': '定时任务',
  'tool-jobs': '后台任务状态更新',
  'cordis-host-runner': '插件状态更新',
  'goal': '继续执行目标',
}

/** 唤醒消息卡的标题；非唤醒来源返回 undefined（调用方照旧不渲染、也不出卡）。 */
export function triggerTitleOf(sourceKind: string): string | undefined {
  return isTriggerSourceKind(sourceKind) ? TRIGGER_TITLES[sourceKind] : undefined
}

/**
 * 唤醒消息卡的**卡头符号**（emoji），与标题表一一对应。只用 emoji 11 及更早的字符，
 * 老机型不会显示成空方块。符号放在卡头的图标位，标题文字保持纯文本 —— 便于搜索、
 * 也不会让断言标题的用例跟着变。
 */
const TRIGGER_EMOJI: Record<string, string> = {
  'agent-message': '📨',
  'team-message': '👥',
  'subagent-settled': '🧩',
  'webhook': '🔔',
  'schedule': '⏰',
  'tool-jobs': '⚙️',
  'cordis-host-runner': '🔌',
  'goal': '🎯',
}

/** 唤醒消息卡卡头的符号；非唤醒来源返回 undefined。 */
export function triggerEmojiOf(sourceKind: string): string | undefined {
  return isTriggerSourceKind(sourceKind) ? TRIGGER_EMOJI[sourceKind] : undefined
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
 *
 * Rows the UI hides are transparent to the chain: the host injects a
 * user/message between the steps of one turn (compact-checkpoint,
 * agent-instructions, skill-catalog, runtime-context), and those used to cut
 * a single turn into one process card per step. They are dropped from the
 * output while merging; a real user message still ends the turn.
 */


export function coalesceTurnMessages(messages: readonly RenderMessage[]): RenderMessage[] {
  const out: RenderMessage[] = []
  for (const message of messages) {
    const previous = out.length > 0 ? out[out.length - 1] : undefined
    // The host injects a user/message BETWEEN the steps of one turn
    // (compact-checkpoint, agent-instructions, skill-catalog,
    // runtime-context — all with source.kind !== 'user'). They are hidden
    // on screen, yet they used to break the merge chain and split a single
    // turn into one process card per step (the three-card bug). They are
    // transparent: inside an assistant run they are dropped from the output
    // entirely (the show-system-messages switch is gone, so these rows can
    // never be displayed — dropping them is lossless). A REAL user message
    // (sourceKind 'user', or absent) still ends the turn.
    if (isHiddenInjectedRow(message)) {
      if (previous !== undefined && previous.kind === 'assistant') continue
      out.push(message)
      continue
    }
    // 同一轮的两段（含「其中一段还不知道轮号」的情况）要合成一张过程卡。
    //
    // 真机现象：刚进一个正在跑的会话时，屏上有两条一模一样的过程卡，过一会儿才合成
    // 一条。原因是尾页折叠出来的那段带轮号（turn 42），而挂上 mux 之后实时折出来的
    // 那段还没经历 turn/start，turn 是 undefined —— 旧判据要求两边都有轮号且相等，
    // 于是同一轮被画了两次。这里把「缺轮号」当成「跟着上一条走」。
    const mergeableByTurn = previous !== undefined
      && previous.kind === 'assistant' && message.kind === 'assistant'
      // 合并判据（三条，任一成立即同一轮）：
      //  ①两边都有轮号且相等；
      //  ②有一边缺轮号，但两条是**同一条消息**（id 相同）；
      //  ③有一边缺轮号，但**step 相同** —— 这一条是 2026-10-29 真机补上的：
      //    尾页每步一行（turn 98 step 1..5），实时流折出来的那行轮号常常还没补上、
      //    id 又是另一套（页面行 id ≠ 流式行 id），于是同一个 step 被画成两张过程卡。
      //    step 是「本轮第几步」，比 id 稳，也不会误合并两个都没有轮号的不同消息
      //    （那种情况 step 也没有或不等）。
      && (
        (previous.turn !== undefined && message.turn !== undefined && previous.turn === message.turn)
        || ((previous.turn === undefined || message.turn === undefined) && previous.id === message.id)
        || ((previous.turn === undefined || message.turn === undefined)
          && previous.step !== undefined && message.step !== undefined
          && previous.step === message.step)
      )
    if (mergeableByTurn) {
      // 同轮同文：一次重试 / 一次分片重放会让同一轮出现两段一模一样的正文。
      // 这时只把工具并进来，正文别再拼一遍（否则一张卡里同一段话说两次）。
      // 阈值 16 字：太短的「好」「继续」在多步里重复是正常内容，不能吞。
      const previousText = previous.text.replace(/\s+/g, ' ').trim()
      const messageText = message.text.replace(/\s+/g, ' ').trim()
      const sameTurnSameText = previous.turn !== undefined
        && previous.turn === message.turn
        && previousText.length >= 16
        && previousText === messageText
      if (sameTurnSameText) {
        out[out.length - 1] = mergeRows(previous, { ...message, text: '' })
        continue
      }
      const merged: RenderMessage = {
        ...previous,
        // 缺轮号的那一段跟着上一条走，下游（过程条状态判据）才读得到轮号。
        ...((previous.turn === undefined && message.turn !== undefined) ? { turn: message.turn } : {}),
        ...((previous.turnStartAt === undefined && message.turnStartAt !== undefined) ? { turnStartAt: message.turnStartAt } : {}),
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
        // 合并行也要合并「搜索索引里那份正文」：只保留 previous 那段，命中片段落在
        // 后一步时会匹配不上，定位就退到按 seq 撞行（真机表现：跳到空白段）。
        ...(previous.searchText !== undefined || message.searchText !== undefined
          ? { searchText: [previous.searchText ?? '', message.searchText ?? ''].filter(part => part !== '').join('\n') }
          : {}),
        time: message.time,
        // The latest row's status wins: a finalized step (no pending flag)
        // clears the merged row's pending — an interrupted turn (every row
        // still pending) keeps the streaming shape. failed propagates once
        // set: a failed step never un-fails the turn.
        pending: message.pending === true,
        ...(message.failed === true ? { failed: true } : {}),
        ...(message.maxTokens === true ? { maxTokens: true } : {}),
        ...(message.usage !== undefined ? { usage: message.usage } : {}),
        // The turn clock rides the row: keep the FIRST row's start anchor and
        // whichever step carries the settled duration (turn/end stamps every row
        // of the turn, so the merged row sees both sides).
        ...(previous.turnStartAt !== undefined || message.turnStartAt !== undefined
          ? { turnStartAt: previous.turnStartAt ?? message.turnStartAt }
          : {}),
        ...(previous.durationMs !== undefined || message.durationMs !== undefined
          ? { durationMs: message.durationMs ?? previous.durationMs }
          : {}),
        ...(previous.firstSeenAt !== undefined || message.firstSeenAt !== undefined
          ? { firstSeenAt: previous.firstSeenAt ?? message.firstSeenAt }
          : {}),
      }
      out[out.length - 1] = merged
    } else {
      out.push(message)
    }
  }
  return mergeProcessCardsByTurn(out)
}

/**
 * 同一轮里「隔了一条用户消息的两段」不要各画一张过程卡。
 *
 * 真机证据（2026-10-30，turn 147）：
 * ```
 * 23: assistant turn=147 step=1  text=0     tools=39
 * 24: turn(本轮报告卡)        turn=147
 * 25: user                    text=251      ← 回合中途插进来的用户消息
 * 26: assistant turn=147 step=40 text=1489  tools=39   ← 和 23 是同一批工具
 * ```
 * 宿主在同一个 turn 内插入一条用户消息之后继续跑，产出落在新的 step 上 —— 两段之间
 * 有真的用户行，`coalesceTurnMessages` 拒绝合并是对的（插话必须把内容切开），于是屏幕
 * 上出现两张过程卡，而它们列的是同一批 39 个工具。用户看到的就是「同一轮多条过程条」。
 *
 * 修法：同轮跨段时，后面那段只保留自己新增的工具/工具流；已经在前一段展示过的
 * （按 callId 认）不再重复。正文与思考过程不动 —— 那是这两段真正的区别。
 */
export function mergeProcessCardsByTurn(source: readonly RenderMessage[]): RenderMessage[] {
  // 同一轮的步骤**统一挂在本轮第一段**上，后段只留正文/思考。
  //
  // 真机证据（2026-10-30，turn 147）：
  // ```
  // 23: assistant turn=147 step=1  text=0     tools=39   ← 第一张卡
  // 24: turn(本轮报告卡)        turn=147
  // 25: user                    text=251                ← 回合中途插话
  // 26: assistant turn=147 step=40 text=1489  tools=39   ← 第二张卡，同一批工具
  // ```
  // 两段之间有真的用户行，`coalesceTurnMessages` 不能合并（插话必须切开内容），于是
  // 屏幕上两张卡，列的还是同一批步骤。判据摆在这里：**过程卡是"这一轮做了什么"的
  // 汇总，按 turn 归属，不按行归属** —— 所以同轮所有步骤都归第一段，后段不再画卡。
  // 先给「缺轮号」的助手行补轮号：缓存页/实时折出来的行偶尔没有 turn，而按轮去重的
  // 判据只认 turn —— 补不上就会出现「两张卡、列同一批步骤」（真机：进会话瞬间缓存那一份
  // 与前一份并存）。补的规则保守：中间没有用户行插进来，就沿用上一条助手行的轮号。
  const withTurn: RenderMessage[] = source.slice()
  let carryTurn: number | undefined
  for (let i = 0; i < withTurn.length; i += 1) {
    const row = withTurn[i]!
    if (row.kind === 'user') { carryTurn = undefined; continue }
    if (row.kind !== 'assistant') continue
    if (row.turn !== undefined) { carryTurn = row.turn; continue }
    if (carryTurn !== undefined) withTurn[i] = { ...row, turn: carryTurn }
  }
  const messages = withTurn

  const firstByTurn = new Map<number, number>()
  const laterTools = new Map<number, ToolCallInfo[]>()
  const laterFlow = new Map<number, FlowPart[]>()
  const laterReasoning = new Map<number, string>()
  const laterSummary = new Map<number, string>()
  messages.forEach((row, index) => {
    if (row.kind !== 'assistant' || row.turn === undefined) return
    if (!firstByTurn.has(row.turn)) {
      firstByTurn.set(row.turn, index)
      return
    }
    if (row.tools !== undefined) laterTools.set(row.turn, [...(laterTools.get(row.turn) ?? []), ...row.tools])
    // 流里的「工具」和「思考」都属于过程卡的内容；只剩它们时卡照样会画出来。
    if (row.flow !== undefined) {
      laterFlow.set(row.turn, [...(laterFlow.get(row.turn) ?? []), ...row.flow.filter(part => part.kind === 'tool' || part.kind === 'reasoning')])
    }
    // 思考也算「这一轮做过什么」：卡头会写「深度思考 N 行」。后段只剩思考时，
    // 它照样会画出第二张卡（实测 d977：4 个分裂回合的第二段 tools=0 但仍有思考）。
    if (row.reasoning !== undefined && row.reasoning !== '') {
      laterReasoning.set(row.turn, [laterReasoning.get(row.turn) ?? '', row.reasoning].filter(part => part !== '').join('\n\n'))
    }
    if (row.toolSummary !== undefined) laterSummary.set(row.turn, row.toolSummary)
  })
  if (laterTools.size === 0 && laterFlow.size === 0 && laterReasoning.size === 0) return messages.slice()

  return messages.map((row, index) => {
    if (row.kind !== 'assistant' || row.turn === undefined) return row
    const first = firstByTurn.get(row.turn)
    if (first === index) {
      const seen = new Set((row.tools ?? []).map(tool => tool.callId))
      const extra = (laterTools.get(row.turn) ?? []).filter(tool => !seen.has(tool.callId))
      const tools = [...(row.tools ?? []), ...extra]
      const seenFlow = new Set((row.flow ?? []).filter(part => part.kind === 'tool').map(part => part.callId))
      const extraFlow = (laterFlow.get(row.turn) ?? []).filter(part => part.kind !== 'tool' || !seenFlow.has(part.callId))
      const flow = [...(row.flow ?? []), ...extraFlow]
      const extraReasoning = laterReasoning.get(row.turn)
      const reasoning = [row.reasoning ?? '', extraReasoning ?? ''].filter(part => part !== '').join('\n\n')
      const toolSummary = row.toolSummary ?? laterSummary.get(row.turn)
      return {
        ...row,
        ...(tools.length === 0 ? {} : { tools }),
        ...(flow.length === 0 ? {} : { flow }),
        ...(reasoning === '' ? {} : { reasoning }),
        ...(toolSummary === undefined ? {} : { toolSummary }),
      }
    }
    // 后段：工具、思考、工具摘要都上提之后，它只剩正文——卡不再画。
    // （toolSummary 自身也会让卡渲染出一行「用时 X▸」，实测 turn 9 / 17 就是这么多出
    //   两张卡的：后段 tools=0、reasoning=0，但 toolSummary 还在。）
    const flow = row.flow?.filter(part => part.kind === 'text')
    const { toolSummary: _hoistedSummary, ...rest } = row
    return {
      ...rest,
      processCardOwner: false,
      ...(row.tools === undefined ? {} : { tools: [] }),
      ...(flow === undefined ? {} : { flow }),
      ...(row.reasoning === undefined ? {} : { reasoning: '' }),
    }
  })
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

  /**
   * Replace the whole stream (history reload / session switch).
   *
   * The turn-start anchors survive: `turn/end` carries no duration, so dropping
   * them would make every turn in the rebuilt window report no elapsed time.
   * `seed` is also how a row-cap trim rewrites the window, which happens mid-turn
   * on a long session — anchors are a couple of numbers, keeping them is free.
   */
  seed(messages: readonly RenderMessage[]): void {
    const anchors = this.state.turnStarts
    const openStart = this.state.openTurnStart
    this.state = createState(messages)
    for (const [turn, startedAt] of anchors) {
      if (!this.state.turnStarts.has(turn)) this.state.turnStarts.set(turn, startedAt)
    }
    if (openStart !== undefined) this.state.openTurnStart = openStart
    this.snapshotList = undefined
  }

  /** Prepend an older history page (exact seam; no overlapping seqs). */
  prepend(older: readonly RenderMessage[]): void {
    // 宿主按消息切页，跨切口的那条消息会同时落在两页里（它不会把一条消息劈成两半）。
    // 直接拼就成了两份同 id 的行：窗口里那份已经被 turn/end 重写过（时间戳改成收工
    // 时刻、带上用时），拼进来这份是切口之前的原样（没有用时），于是同一条回答在手机
    // 上出现两次、其中一次没有秒表——实测某会话 118 行里 37 个 id 各两份。
    // 保留窗口里已有的那份：它是最新的。
    const known = new Set(this.state.messages.map(message => message.id))
    const unique: RenderMessage[] = []
    for (const message of older) {
      if (known.has(message.id)) continue
      known.add(message.id)
      unique.push(message)
    }
    if (unique.length === 0) return
    // 补进来的行属于切口之前那一页，那一页没有这一轮的 turn/end：同一轮里前面那些行
    // 于是既没有用时、时间戳也停在每一步的时刻，和后面那些行对不上。收工时刻已经记
    // 在 turnEnds 里，按它补齐（与整页重折的结果一致）。
    const settled = unique.map(message => {
      const turn = message.kind === 'assistant' ? message.turn : undefined
      const endedAt = turn === undefined ? undefined : this.state.turnEnds.get(turn)
      if (turn === undefined || endedAt === undefined) return message
      const startedAt = this.state.turnStarts.get(turn) ?? message.turnStartAt ?? message.time
      return {
        ...message,
        time: endedAt,
        durationMs: Math.max(0, endedAt - startedAt),
        turnStartAt: startedAt,
      }
    })
    const anchors = this.state.turnStarts
    const ends = this.state.turnEnds
    const openStart = this.state.openTurnStart
    this.state = createState([...settled, ...this.state.messages])
    for (const [turn, startedAt] of anchors) {
      if (!this.state.turnStarts.has(turn)) this.state.turnStarts.set(turn, startedAt)
    }
    for (const [turn, endedAt] of ends) {
      if (!this.state.turnEnds.has(turn)) this.state.turnEnds.set(turn, endedAt)
    }
    if (openStart !== undefined) this.state.openTurnStart = openStart
    this.snapshotList = undefined
  }

  /**
   * 记下宿主播报的「当前这一轮从什么时候开始」。
   *
   * 窗口里找不到 turn/start 时，收工定格只能用窗口最早一行当锚点，于是秒表在
   * 收工那一刻往回跳（真机 8分37秒 → 6分48秒）。宿主页面自带真起点
   * （`mobile.readChat` 的 page.turnStartAt / `mobile.turnState`），传进来即可。
   * 只对窗口里最新那一轮生效，见 applyTurnEnd。
   */
  noteOpenTurnStart(at: number | undefined): void {
    if (at === undefined || !Number.isFinite(at)) return
    if (this.state.openTurnStart === at) return
    this.state.openTurnStart = at
    this.snapshotList = undefined
  }

  /** 宿主说这一轮收工了：把外部锚点丢掉，别再拿去定格下一轮。 */
  clearOpenTurnStart(): void {
    if (this.state.openTurnStart === undefined) return
    this.state.openTurnStart = undefined
    this.snapshotList = undefined
  }

  /**
   * 按轮号记下一个窗口里看不到的起点（宿主从日志里翻出来的真 turn/start 时间）。
   *
   * 比 {@link noteOpenTurnStart} 更准：一次折叠里可能先后收工好几轮（旧轮的 turn/end
   * 先到），单值的"当前轮锚点"会被早收工的那一轮先吃掉。有轮号就直接按轮号存。
   */
  noteTurnStart(turn: number, at: number | undefined): void {
    if (at === undefined || !Number.isFinite(at) || !Number.isFinite(turn)) return
    if (this.state.turnStarts.has(turn)) return
    this.state.turnStarts.set(turn, at)
    this.snapshotList = undefined
  }

  /**
   * Carry turn-start anchors over from a folder this one replaces.
   *
   * A window is rebuilt from a fresh page whenever the two no longer join, and
   * that page is cut at a message boundary — the turn/start of the turn owning
   * its first message sits outside it. The rebuilt folder would therefore forget
   * every anchor the old one had, and since turn/end carries no duration, the
   * turns in that window lose their elapsed time. Anchors are tiny and never
   * wrong (a turn starts once), so the replacement inherits them.
   */
  adoptAnchors(from: EventFolder): void {
    for (const [turn, startedAt] of from.state.turnStarts) {
      if (!this.state.turnStarts.has(turn)) this.state.turnStarts.set(turn, startedAt)
    }
    for (const [turn, endedAt] of from.state.turnEnds) {
      if (!this.state.turnEnds.has(turn)) this.state.turnEnds.set(turn, endedAt)
    }
    if (from.state.openTurnStart !== undefined && this.state.openTurnStart === undefined) {
      this.state.openTurnStart = from.state.openTurnStart
    }
    // Durations already stamped on the inherited rows stay valid as well: the
    // rows themselves are replaced, so re-derive their clock from the anchors.
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
