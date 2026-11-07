/**
 * 消息模型的类型（W3-3 从 `messages.ts` 搬出来）。
 *
 * 搬它的理由很实在：todo 折线、回合报告这些投影都要 import 这些类型，
 * 而类型留在 `messages.ts` 里就会形成
 * `projections/*.ts → messages.ts → projections/*.ts` 的循环。
 * 类型没有实现、只依赖彼此，单独一层最省事。
 *
 * @module dsh-palm/mobile/projections/types
 */
import type { MessageFile, MessageImage } from './content.ts'

/**
 * One file a `present` call declared this turn — the desktop's deliverable
 * card entry: a mandatory workspace path plus the optional human description.
 */
export interface TurnDeliverable {
  readonly path: string
  readonly description?: string
}

export interface RenderMessage {
  /**
   * 这张交付卡是**猜出来的**（按工具行重建，没有真正的 turn/end）。
   *
   * 猜的卡内容可能不全（文件清单少一两个），真卡一到就会被替换 —— 用户看到的就是
   * "卡片内容又变了一次"。所以：猜的卡**不进缓存**，也不许盖掉真卡。
   */
  readonly guessed?: boolean
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
export type FlowPart =
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


/** One plan item carried by a `todo/write` snapshot (host TodoItem shape). */
export interface TodoItem {
  /** What this task is — a short imperative line shown in the UI. */
  readonly content: string
  /** Lifecycle state; parallel work may mark several `in_progress`. */
  readonly status: 'pending' | 'in_progress' | 'completed'
}
