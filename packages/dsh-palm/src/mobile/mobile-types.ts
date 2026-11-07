/**
 * **跨端点的共享类型**（W4-4：从 `api.ts` 抽出）。
 *
 * 为什么独立成文件：`data/impl/<域>.ts` 需要这些类型，而 `api.ts` 又要 re-export
 * 这些域的实现——两边互相 import 就成环了。类型放进一个**不依赖 api.ts** 的模块，
 * 环自然消失（`import type` 运行时会被擦除，但依赖检查看的是源码关系）。
 *
 * @module dsh-palm/mobile/mobile-types
 */
import type { AgentPresetEntry, SessionModels, SessionProjectionsBlock, SubagentCatalog, WorkspaceView } from '../api-proxy-types'
import type { RenderMessage, TodoSnapshot } from './messages.ts'

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
  baseURL?: string
  kind: 'usage' | 'balance'
  status: 'ok' | 'no-key' | 'unsupported' | 'error'
  plan?: string
  usedPercent?: number
  sessionUsed?: number
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
