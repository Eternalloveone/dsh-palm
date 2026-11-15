/**
 * **跨端点的共享类型**（W4-4：从 `api.ts` 抽出）。
 *
 * 为什么独立成文件：`data/impl/<域>.ts` 需要这些类型，而 `api.ts` 又要 re-export
 * 这些域的实现——两边互相 import 就成环了。类型放进一个**不依赖 api.ts** 的模块，
 * 环自然消失（`import type` 运行时会被擦除，但依赖检查看的是源码关系）。
 *
 * @module dsh-palm/mobile/mobile-types
 */
import type { AgentPresetEntry, SessionModels, SessionProjectionsBlock, SessionSummary, SubagentCatalog, WorkspaceView } from '../api-proxy-types'
import type { RenderMessage, TodoSnapshot } from './render/messages.ts'

/** One folded chat page (v3 `mobile.readChat`): rows, watermark, and seeds. */
export interface ChatPage {
  /** Folded message rows (never coalesced — the surface coalesces at render). */
  rows: RenderMessage[]
  /** Event-seq watermark of the page's source window (replay floor for live
   *  frames that may overlap a previous open of the same session). */
  maxSeq: number
  hasMore: boolean
  /** Newest valid todo/write in the page's events, when any. */
  todo?: TodoSnapshot
  /** Tail-page projection baseline, when available. */
  projections?: SessionProjectionsBlock
  /** The running turn's logged `turn/start` time (epoch ms) when the window
   *  holds an open turn boundary — the turn-clock anchor (desktop parity).
   *  Tail reads carry it; older-page reads never do. */
  turnStartAt?: number
  /** Timestamp of the newest event in the page (epoch ms). A live turn emits
   *  events constantly, so an "open" boundary whose newest event is old belongs
   *  to a finished turn whose turn/end frame never arrived. */
  lastEventAt?: number
  /** 这一轮还开着吗：true＝最后一条边界是 turn/start，false＝turn/end，缺席＝这一页
   *  根本没见到边界（不知道）。**不能**把缺席当成 false：一轮工具跑二十几步时，几十帧
   *  的尾切里全是工具事件，边界还在更远处——那样会把正跑着的一轮判成已完成。 */
  turnOpen?: boolean
  /** 随页面一起回来的模型/子代理目录（A）。缺省表示宿主没带回来，调用方按老
   *  路径单独取一次即可。只出现在请求了 include 的那一次响应里。 */
  extras?: ChatOpenExtras
}

/**
 * Health report behind the About sheet's 健康 block.
 *
 * Everything past `checks`/`now` is optional on purpose: a host that predates
 * the health extension answers the old `{ checks, now }` shape and the UI must
 * simply omit those rows instead of showing `undefined`.
 */
export interface MobileHealthView {
  /** Dependency self-check (setup registration + runtime frame counts). */
  checks: DependencyCheckView[]
  /** dsh-palm version answering. */
  palmVersion?: string
  /** Mobile wire revision. */
  wire?: number
  /** Frame discriminants the host may publish. */
  frames?: string[]
  /** Methods the host exposes on /m/api. */
  methods?: string[]
  /** Push state; absent when the notify feature is not composed. */
  push?: {
    subscriptions: number
    delivery?: { total: number; sent: number; failed: number; dropped: number; since: number }
  }
  now: number
}

/** 宿主侧「刚结束」账本的一条（与 `recent-finished.ts` 同形）。 */
export interface HostFinishedRun {
  sessionId: string
  title: string
  finishedAt: number
  status: 'done' | 'error' | 'stopped'
  durationMs?: number
  summary?: string
}

/**
 * 一张图片附件的完整引用。读字节时要**原样**交给宿主：新的 `session.attachment`
 * 按 ID / 格式 / 字节 / 尺寸逐项校验，只给 attachmentId 会被判无效请求。
 */
export interface AttachmentRef {
  attachmentId: string
  mediaType: string
  width: number
  height: number
  bytes?: number
  name?: string
}

/** The full usage surface, synced from the desktop's configured providers. */
export interface UsageView {
  providers: UsageProviderView[]
  fetchedAt: number
}

/** 同一次 `mobile.readChat` 响应里带回来的小目录。 */
export interface ChatOpenExtras {
  models?: SessionModels
  subagents?: SubagentCatalog
}

/** 一条宿主依赖的自检结果（手机端「关于」里的自检列表）。 */
export interface DependencyCheckView {
  /** 依赖名（总线事件名或 session 方法名）。 */
  name: string
  /** `event` = 宿主总线事件；`method` = 宿主 session 方法。 */
  kind: 'event' | 'method'
  /** setup 期：订阅是否被接受 / 方法是否存在。 */
  ok: boolean
  /** `ok === false` 时的原因。 */
  reason?: string
  /** 运行期收到过多少帧。 */
  frames: number
  /** 运行期最近一次收到的时刻（epoch ms）。 */
  lastAt?: number
}

/** One provider's displayed usage/balance row (display facts only, no keys). */
export interface UsageProviderView {
  name: string
  /**
   * 设置里的路由键（`llm-pi-ai.providers.<route>` / `llm-deepseek` → `deepseek`）。
   *
   * `name` 可能是 displayName（「DeepSeek 官方」），对不上会话模型目录里的 provider
   * id；抽屉「用量」行要显示**当前模型**那家的数字，只能按这个键对齐。
   * 老宿主不一定有：缺省时调用方按 `name` 兜底匹配。
   */
  route?: string
  baseURL?: string
  kind: 'usage' | 'balance'
  status: 'ok' | 'no-key' | 'unsupported' | 'error'
  plan?: string
  /**
   * 每周窗口已用比例，**0..1 的分数**（0.459 = 已用 45.9%）。
   *
   * 视图侧统一 `* 100` 出百分数，见 `views/settings/usage-section.tsx`；
   * `SettingsView.test.tsx` 用 0.459 钉住了这条单位。2026-11-10 用整数 62 造样例，
   * 页面如实画出「6200.0%」—— 契约没有注释，坑就在这儿。
   */
  usedPercent?: number
  /** 5 小时窗口已用比例，同样是 0..1 的分数。 */
  sessionUsed?: number
  /**
   * 每月窗口已用比例，0..1 的分数（只有按月结算的提供方给）。
   *
   * 抽屉小字在「5 小时 / 本周 / 本月」里挑**更紧的那个**报（2026-11-14 用户：
   * 「当前模型的本周或者本月已用用量值」）；老宿主没有这个字段，就只在两个窗口里挑。
   */
  monthlyUsed?: number
  /** 最近 5 小时窗口的下次重置时刻（epoch millis）。 */
  sessionResetsAt?: number
  /** 每周窗口的下次重置时刻（epoch millis）。 */
  weeklyResetsAt?: number
  /** 没有配额百分比可画时的一句话事实（如「近 7 天 9,447 次请求」）。 */
  summary?: string
  models?: UsageModelRow[]
  balance?: string
  /** 这行数字是什么（账户余额 / 累计已用 …）。缺省按「账户余额」显示。 */
  balanceLabel?: string
  /** 失败/不支持的一句话原因（401=key 无效、410=接口下线、超时…）。 */
  detail?: string
  /** 该提供方的控制台计费页；不支持的行走这个深链，而不是只显示「不支持」。 */
  consoleUrl?: string
  fetchedAt: number
}

/** Per-model usage inside a provider's report. */
export interface UsageModelRow {
  name: string
  requestCount: number
}

/** One delivery attempt (host telemetry). */
export interface DeliveryRecordView {
  at: number
  eventId: string
  kind: string
  channel: string
  status: 'sent' | 'failed' | 'dropped'
  detail?: string
}

/** Aggregated delivery health for the settings page. */
export interface DeliveryStatsView {
  total: number
  sent: number
  failed: number
  dropped: number
  byChannel: Array<{ channel: string; sent: number; failed: number; dropped: number }>
  byKind: Array<{ kind: string; sent: number; failed: number; dropped: number }>
  since: number
}

/** The redacted notify config the phone may read (no credentials). */
export interface NotifyConfigView {
  turnThresholdMs: number
  turnCooldownMs: number
  hideDetails: boolean
  /** Effective per-kind gates (as the host applies them). */
  kinds: { jobs: boolean; todo: boolean; turns: boolean; approvals: boolean }
  vapidPublicKey?: string
  channels: {
    serverchan: { configured: boolean }
    bark: { configured: boolean }
    telegram: { configured: boolean }
    wxpusher: { configured: boolean }
    pushplus: { configured: boolean }
  }
}

/** One completion-notification decision, as the phone's inbox renders it. */
export interface NotifyEventView {
  id: string
  kind: 'task-done' | 'task-failed' | 'turn-done' | 'todo-done' | 'approval' | 'question'
  title: string
  body: string
  sessionId: string
  workspaceId?: string
  ts: number
}

/** The pending state for one session. */
export interface PendingState {
  approvals: PendingApproval[]
  questions: PendingQuestionItem[]
}

/** One pending tool approval awaiting the user's decision. */
export interface PendingApproval {
  /** The approval/requested frame's rpcId — the wire correlation the answer echoes. */
  rpcId: string
  approvalId: string
  toolName: string
  callId?: string
  reason?: string
  /**
   * Host-side danger judgement. Absent on an older host → the panel treats it
   * as `write` (confirm + show arguments), never as read.
   */
  risk?: 'read' | 'write' | 'exec' | 'install'
}

/** One pending question group awaiting the user's answer. */
export interface PendingQuestionItem {
  /** The question/requested frame's rpcId — the wire correlation the answer echoes. */
  rpcId: string
  id: string
  question: string
  detail?: string
  header?: string
  options?: Array<{ label: string; description?: string }>
  multiSelect?: boolean
}

/** The host directory listing result (one level, with ancestor breadcrumbs). */
export interface DirectoryListing {
  path: string
  home: string
  crumbs: DirectoryEntry[]
  entries: DirectoryEntry[]
  truncated: boolean
}

/** One entry in a directory listing. */
export interface DirectoryEntry {
  name: string
  path: string
  hidden: boolean
  /** files=true 时才有：区分目录与文件。 */
  kind?: 'dir' | 'file'
  /** 文件的字节数（只有 kind === 'file' 时有）。 */
  bytes?: number
}

/** One file read back from the host for the chat's preview sheet. */
export type FilePreview =
  | { kind: 'text'; path: string; name: string; text: string }
  | { kind: 'image'; path: string; name: string; dataUrl: string }

/** One batch preview row (summary is '' when the session has no text yet). */
export interface SessionPreview {
  sessionId: string
  summary: string
  updatedAt: number
}

/** One slash command the host registry advertises (name + description). */
export interface CommandDescriptor {
  name: string
  description: string
  input?: { hint?: string }
}

/** Read-only display preferences the plugin answers locally on `/m/api`. */
export interface MobilePreferences {
  /** Plain Enter sends the drafted prompt (false: Enter inserts a newline). */
  mobileEnterToSend: boolean
}

/** The full redacted settings surface (desktop-parity configuration cards). */
export interface MobileSettingsRead {
  writable: boolean
  hasDocument: boolean
  namespaces: import('../api-proxy-types').SettingsNamespaceView[]
}

/** The paired-device roster + the cap the host enforces. */
export interface PairedDevicesView {
  devices: PairedDeviceView[]
  maxDevices: number
}

/** One paired device as the phone's device-management screen sees it. */
export interface PairedDeviceView {
  /**
   * Credential-free handle (`sha256(deviceId)` prefix). The host deliberately
   * never sends the real device id: that id IS the pairing cookie value, so
   * exposing it would let one paired phone impersonate the others.
   */
  handle: string
  createdAt: number
  lastSeenAt: number
  online: boolean
  userAgent?: string
  name?: string
  primary?: boolean
  /** Whether this row is the device the phone is currently running on. */
  current: boolean
}

/** Agent presets available when composing a new session. */
export interface AgentPresetRoster {
  presets: readonly AgentPresetEntry[]
  authorable: boolean
  hasDocument: boolean
}

/** 一个已经交给宿主暂存、等着随下一条 prompt 发出去的附件。 */
export interface UploadedAttachment {
  /** 宿主铸的收据：prompt 里 `{ type: 'file', receiptId }` 引用它。 */
  receiptId: string
  /** 展示用的文件名（宿主清洗过叶子名）。 */
  name: string
  /** 字节数（宿主回填，展示用）。 */
  bytes?: number
}

/** The result of creating a workspace from an existing directory. */
export interface WorkspaceCreateResult {
  workspace: WorkspaceView
  created: boolean
}

/** 打开会话时可以顺带取回的小目录（服务端白名单，见 mobile-api readChatInclude）。 */
export type ChatOpenInclude = 'models' | 'subagents'

/** One executed slash-command outcome from the host registry. */
export interface CommandExecOutcome {
  /** false: the line did not resolve to a registered command (nothing ran). */
  matched: boolean
  kind?: 'success' | 'error'
  /** The command's own human result text (usage/state feedback), when any. */
  text?: string
}

/** The session.create result (the id is the commit the caller navigates to). */
export interface CreatedSession {
  sessionId: string
  /** The composition the new session runs (echoed so the caller can label it). */
  agentPreset?: string
}

/** One history page (already bounded to whole messages by the host). */
export interface HistoryPage {
  events: import('../api-proxy-types').HistoryEntry[]
  hasMore: boolean
  /**
   * Projection baseline riding the tail page (permissions select etc.);
   * absent when the deployment mounts no projection registry.
   */
  projections?: SessionProjectionsBlock
}

export interface IndexedSearchResult {
  items: IndexedSearchItem[]
  total: number
  hasMore: boolean
  /** 下一页的 offset（原样传回来就是「加载更多」）。 */
  nextOffset?: number
  /** 宿主侧索引耗时（不含网络）。 */
  tookMs: number
  /**
   * 会话内搜索：这个词在**全历史**里一共出现几处（不受 items 的 200 条上限）。
   * 屏幕上的精确计数由客户端本地扫描给出，这个数用来显示"未加载区还有多少"。
   */
  matchedTotal?: number
  /** 索引是否覆盖了整个会话；false 表示 matchedTotal 只能当"至少这么多"（显示 +）。 */
  indexComplete?: boolean
  /** true = 索引还没建好（或宿主没有 node:sqlite），调用方应退回 searchAll。 */
  fallback?: boolean
  source?: 'index'
}

/** 手机上能点的四种目标动作（与桌面端 remote.goals.* 同一套语义）。 */
export type MobileGoalAction = 'pause' | 'resume' | 'edit' | 'clear'

/**
 * Delivery mode the host understands for `session.prompt`.
 *
 * Only two exist (`queue` appends a turn, `steer` injects into the running one);
 * "interrupt and send" is a client-side composition of cancel + queue, and the
 * chat view labels it as such rather than pretending the host has a third mode.
 */
export type PromptMode = 'queue' | 'steer'

export type QueueAction =
  // 编辑只改正文：附件/图片按原样拼回去（宿主那边收据还在，不用重传字节）。
  | { kind: 'edit'; content: QueueEditPart[] }
  | { kind: 'remove' }
  | { kind: 'steer' }

/** One pending inbox occurrence in the host's `session/queue` snapshot. */
export interface QueueItemView {
  /** Message identity used by queue mutations. */
  id: string
  /** FIFO placement: queued (next turn) / steering (next step) / context. */
  placement: 'queued' | 'steering' | 'context'
  /** The pending message's preview text (empty for non-text content). */
  text: string
  /** True when the pending content is plain text (the only editable kind). */
  editable: boolean
  /**
   * 宿主的 `source.kind`（用户 / agent-message / subagent-settled / …）。
   *
   * 插入条要按来源合并「用户插话」与「智能体/后台任务通知」，但队列行本身只有
   * id/placement/text —— 不带这个字段，渲染层就只能靠正文猜，同一件事会被画成
   * `Agent …` 与 `Background subagent …` 两行。
   */
  sourceKind?: string
  /** 这条排队消息带的文件附件收据（界面显示用）。 */
  receipts?: string[]
  /** 编辑时要原样拼回去的非文本块（文件/图片）：宿主那边收据还在，不用重传字节。 */
  keepParts?: unknown[]
}

/** Folders + session→folder assignments. */
export interface SessionFoldersView {
  folders: SessionFolderView[]
  assignments: Record<string, string>
}

/** One host-side session folder. */
export interface SessionFolderView {
  id: string
  name: string
  createdAt: number
}

/** One message-level hit inside one session (the lazy expanded view). */
export interface SessionMessageHit {
  /** The matched message event's seq — chat rows cover the range
   *  [startSeq, seq], so this targets the exact row to scroll to. */
  seq: number
  messageId?: string
  partId?: string
  /** Surrounding plain-text excerpt around the match (host-clipped). */
  snippet: string
}

/** One session.list page. */
export interface SessionPage {
  items: SessionSummary[]
  /** Continuation cursor; undefined once the tail is reached. */
  nextCursor?: string
  hasMore: boolean
  /** 宿主此刻的归档集：抽屉合并时用它挡掉"别的设备删掉、却还画在行里"的会话。 */
  archivedSessionIds?: string[]
}

/** One host-side full-roster search hit (message content across sessions). */
export interface SessionSearchHit {
  kind: 'title' | 'message'
  sessionId: string
  /** The matched content window (bounded by the host). */
  snippet: string
  /** Session display title when the host can resolve it. */
  title?: string
  /** Owning workspace when the host can attribute it (home-page locate). */
  workspaceId?: string
  /** Owning workspace's display title (host-resolved), so the row can label
   *  the owner even before the local roster finishes loading. */
  workspaceTitle?: string
  /** Stable folded message identity for exact locate. */
  messageId?: string
  /** Stable text-part identity inside the folded message. */
  partId?: string
  /** First matched message's event seq, retained for history paging fallback. */
  seq?: number
  /** 该会话一共命中多少条消息（索引路径才有；标题命中为 0）。 */
  hits?: number
  /** 命中来自用户消息（索引路径才有）。 */
  user?: boolean
  /** 摘要里命中词的 [start, end)：客户端据此加底色，不自己再猜一遍。 */
  ranges?: Array<[number, number]>
  /** 命中所在的整段正文（方案 C）：结果页直接摆出来，点进去前就知道是哪句话。 */
  paragraph?: string
  /** 这一段里是第几处命中（0 起，方案 A：会话内按这一处精确定位）。 */
  matchIndex?: number
  /** 这个会话里排在前面的几条命中：每条都能单独点进去定位。 */
  messages?: Array<{
    seq: number
    messageId?: string
    partId?: string
    snippet: string
    ranges?: Array<[number, number]>
    user?: boolean
    paragraph?: string
    matchIndex?: number
  }>
}

/** `mobile.turnState` 的答复。 */
export interface TurnState {
  running: boolean
  /** 这一轮的 turn/start 时刻（秒表锚点）；不在跑时缺席。 */
  turnStartAt?: number
  /** 页面上最新事件的时间：只是信息，不再参与"是否收工"的判断。 */
  lastEventAt?: number
  /** 宿主作答的时刻（用于判断这份答案有多旧）。 */
  asOf: number
  /**
   * 这个结论**基于哪一条证据**（日志边界 seq 或帧镜像 seq，取较新者）。
   *
   * 手机端用它做单调门控：晚到的旧答复不许覆盖已经应用的新结论。
   * 旧宿主没有这个字段时按 -1 处理（等于"没有证据序号"，退化为按到达顺序）。
   */
  seq?: number
}

/** 自建索引返回的一条命中：分组由宿主做完，这里只带展示所需字段。 */
export interface IndexedSearchItem {
  kind: 'title' | 'message'
  sessionId: string
  title?: string
  /** 命中处的摘要（两侧可能带省略号）。 */
  snippet?: string
  /** 摘要里每个命中词的 [start, end) —— 客户端据此加底色，不自己再猜一遍。 */
  ranges?: Array<[number, number]>
  /** 该会话一共命中多少条消息（标题命中为 0）。 */
  hits?: number
  /** 最佳命中所在的 event seq：点一下就能定位到那一条。 */
  seq?: number
  messageId?: string
  partId?: string
  /**
   * 结构坐标（2026-11-12，图谱寻址）：这条命中在第几轮、第几步。
   * 有它就能按「轮:步」查表落到那一行，不必等 messageId 恰好落在当前窗口里，
   * 也不受跨页合并影响。
   */
  turn?: number
  step?: number
  user?: boolean
  workspaceId?: string
  workspaceTitle?: string
  /** 命中所在的整段正文（方案 C）：结果页直接摆出来。 */
  paragraph?: string
  /** 这一段里是第几处命中（0 起，方案 A：会话内按这一处定位）。 */
  matchIndex?: number
  /** 这个会话里排在前面的几条命中（最多 perSession 条）：每条都能单独点进去。 */
  messages?: Array<{
    seq: number
    messageId?: string
    partId?: string
    snippet: string
    ranges?: Array<[number, number]>
    user?: boolean
    paragraph?: string
    matchIndex?: number
  }>
}

/** 一条待发消息的内容块：正文，以及原样保留的文件/图片块。 */
export type QueueEditPart =
  | { type: 'text'; text: string }
  | { type: 'file'; receiptId: string }
  | { type: 'image'; attachmentId: string }
