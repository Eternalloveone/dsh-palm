/**
 * Mobile-surface business API: the handful of host RPC methods the
 * simplified surface needs. Types come from the harness apiproxy contract
 * (type-only imports; the wire schemas stay in the bundle only through the
 * rpc/mux layers).
 */

import type { WorkspaceView } from '../api-proxy-types'
import type { AgentPresetEntry } from '../api-proxy-types'
import type { SessionSummary, SessionModels, SessionProjectionsBlock } from '../api-proxy-types'
import type { SubagentCatalog } from '../api-proxy-types'
import type { RenderMessage, TodoSnapshot } from './messages.ts'
import { callUnary } from './rpc.ts'
import type { PromptPart } from './image.ts'
import type { VoiceService } from './voice-services.ts'

/**
 * 只读调用的合并窗口。真机埋点（4G + CPU×4）实测：一次"打开工作区"里
 * `session.list` 被发了 **3 次、payload 完全相同**（1614/1874/3602ms），
 * 每次 470~720ms 且各触发一次 40 行重渲染；进会话时 `mobile.preferences`
 * 也重复。宿主侧本来就有 30s 的列表 TTL，所以这几次往返除了耗流量、
 * 占主线程之外没有任何收益 —— 并发共享一次飞行、完成后 1.2s 内复用结果。
 * 写操作成功后调用 {@link invalidateReadCoalescing} 把窗口清掉。
 */
const READ_COALESCE_TTL_MS = 1_200
/** Cap on remembered results (each is one page of JSON; 48 is a few MB at most). */
const READ_RECENT_MAX = 48
const readFlights = new Map<string, Promise<unknown>>()
const readRecent = new Map<string, { at: number; value: unknown }>()
/**
 * 失效代号：每次写操作成功 +1。飞行中的读请求带着发起时的代号，回来时代号已经变了
 * 就**不许**写进复用窗口 —— 否则「刚改完设置/刚发完消息，界面又显示旧值」会复现，
 * 而且下一次读还会从这个旧窗口里拿到它。
 */
let readGeneration = 0

/** One coalesced read: share the in-flight call, then reuse the answer briefly. */
async function coalescedRead<T>(method: string, payload: unknown, ttlMs = READ_COALESCE_TTL_MS): Promise<T> {
  const key = method + ' ' + JSON.stringify(payload ?? {})
  const recent = readRecent.get(key)
  if (recent !== undefined && Date.now() - recent.at <= ttlMs) return recent.value as T
  const flight = readFlights.get(key)
  if (flight !== undefined) return flight as T
  const generation = readGeneration
  const run = callUnary<T>(method, payload)
    .then((value) => {
      // 失效之后才回来的读：结果可能早于那次写，只能交给调用方，不能进复用窗口。
      if (generation === readGeneration) {
        readRecent.set(key, { at: Date.now(), value })
        if (readRecent.size > READ_RECENT_MAX) {
          const oldest = [...readRecent.entries()].sort((a, b) => a[1].at - b[1].at)[0]
          if (oldest !== undefined) readRecent.delete(oldest[0])
        }
      }
      return value
    })
    .finally(() => { readFlights.delete(key) })
  readFlights.set(key, run as Promise<unknown>)
  return await run
}

/**
 * Drop the coalescing window (call after any successful mutation).
 *
 * 连在飞的读一起作废：只清窗口的话，那些请求回来仍会写进去，界面上就出现「改完又被旧值盖回去」。
 */
export function invalidateReadCoalescing(): void {
  readGeneration += 1
  // 在飞的读不再共享（新的读必须自己去问宿主），它们回来的结果也不写进窗口。
  readFlights.clear()
  readRecent.clear()
}

/**
 * 观测断言的去重窗口：`mobile.observe` 每发一次就是宿主侧新建一个 follow
 * 注册。App 的 effect 在路由变化时会重跑，实测启动阶段 `{}` 被连发两次，
 * 3 秒内同值只发一次即可（re-assert 的节奏是 30s，远大于这个窗口）。
 */
const OBSERVE_ASSERT_MIN_MS = 3_000
let lastObservedAt: { key: string; at: number } | undefined

/** 显示偏好的复用窗口（设置页写成功即清窗，见 mutateSettings）。 */
const PREFERENCES_TTL_MS = 30_000

/** 模型目录的复用窗口（改选择即清窗，见 selectModel）。 */
const MODELS_TTL_MS = 30_000

/** One session.list page. */
export interface SessionPage {
  items: SessionSummary[]
  /** Continuation cursor; undefined once the tail is reached. */
  nextCursor?: string
  hasMore: boolean
}

/** The session.create result (the id is the commit the caller navigates to). */
export interface CreatedSession {
  sessionId: string
  /** The composition the new session runs (echoed so the caller can label it). */
  agentPreset?: string
}

/** Agent presets available when composing a new session. */
export interface AgentPresetRoster {
  presets: readonly AgentPresetEntry[]
  authorable: boolean
  hasDocument: boolean
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

/** Read-only display preferences the plugin answers locally on `/m/api`. */
export interface MobilePreferences {
  /** Plain Enter sends the drafted prompt (false: Enter inserts a newline). */
  mobileEnterToSend: boolean
}

/** The desktop theme preference (host `ui-theme`), synced to the phone. */
export type ThemePreference = 'light' | 'dark' | 'system'

/** The full redacted settings surface (desktop-parity configuration cards). */
export interface MobileSettingsRead {
  writable: boolean
  hasDocument: boolean
  namespaces: import('../api-proxy-types').SettingsNamespaceView[]
}

/** Read the full redacted settings surface (schemas + values, no secrets). */
export async function readSettings(): Promise<MobileSettingsRead> {
  return await callUnary<MobileSettingsRead>('settings.read', {})
}

/** Write whitelisted host setting paths (see SETTINGS_WRITE_WHITELIST). */
export async function mutateSettings(
  ns: string,
  ops: Array<{ op: 'set'; path: string[]; value: unknown }>,
  expectedRevision?: number,
): Promise<void> {
  const payload: Record<string, unknown> = { ns, ops }
  if (expectedRevision !== undefined) payload.expectedRevision = expectedRevision
  await callUnary<unknown>('settings.mutate', payload)
  // 写成功即让显示偏好的复用窗口失效（设置页改完返回，读到的必须是新值）。
  invalidateReadCoalescing()
}

/** 工作区快照的复用窗口 + 单飞。真机埋点证明：宿主侧 workspace.list 只要 0~2ms，
 *  但手机链路实测只有 0.1~3.6 KB/s —— **往返次数本身就是全部成本**。原来每次挂载
 *  会话清单要发两次（后台归属 + 首屏预算竞速）、返回工作区页再发一次，一个来回 3 次
 *  往返。这里让并发调用共享同一个请求、并在 5 秒内复用结果，把往返砍到 1/3。
 *  只缓存成功的结果，失败照旧抛出（调用方各自处理）。 */
const WORKSPACE_ROSTER_TTL_MS = 5_000
let workspaceRosterInFlight: Promise<WorkspaceView[]> | undefined
let workspaceRosterCached: { at: number; items: WorkspaceView[] } | undefined

/** The workspace roster (session ids come back per workspace). */
export async function listWorkspaces(): Promise<WorkspaceView[]> {
  const cached = workspaceRosterCached
  if (cached !== undefined && Date.now() - cached.at < WORKSPACE_ROSTER_TTL_MS) return cached.items
  const inFlight = workspaceRosterInFlight
  if (inFlight !== undefined) return inFlight
  const run = callUnary<{ items: WorkspaceView[] }>('workspace.list', {})
    .then(({ items }) => {
      workspaceRosterCached = { at: Date.now(), items }
      return items
    })
    .finally(() => { workspaceRosterInFlight = undefined })
  workspaceRosterInFlight = run
  return run
}

/**
 * 工作区花名册变了的唯一出口：建/改名/删工作区，以及会改变工作区下会话清单的
 * 建会话/改名/删会话。5 秒复用窗口是给"反复进出页面"省往返的，写入之后还留着
 * 它就会把刚删掉的行画回来、把刚建的藏起来（真机表现：删了工作区还能看见，退出
 * 再进才有变化）。所以每个写操作成功后都必须清掉它。
 */
export function invalidateWorkspaceRoster(): void {
  workspaceRosterCached = undefined
}

/** Read-only mobile display preferences (answered by the plugin, not the host proxy). */
export async function fetchMobilePreferences(): Promise<MobilePreferences> {
  // 显示偏好只在设置页里改，且改完会走 mutateSettings 清窗口：30s 的复用窗口足够。
  // 真机实测：每次进会话都会再读一次（与启动那次隔 2.2s，恰好落在 1.2s 窗口外），
  // 白跑一个往返。
  return await coalescedRead<MobilePreferences>('mobile.preferences', {}, PREFERENCES_TTL_MS)
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

/** Read the notify config (thresholds + channel presence, credentials redacted). */
export async function readNotifyConfig(): Promise<NotifyConfigView> {
  return await callUnary<NotifyConfigView>('push.config', { get: true })
}

/** Write notify config fields (thresholds; channel credentials in M2). */
export async function writeNotifyConfig(patch: {
  turnThresholdMs?: number
  turnCooldownMs?: number
  hideDetails?: boolean
  kinds?: { jobs?: boolean; todo?: boolean; turns?: boolean }
  channels?: {
    serverchan?: { sendKey: string }
    bark?: { key: string }
    telegram?: { botToken: string; chatId: string }
    wxpusher?: { spt: string }
    pushplus?: { token: string }
  }
}): Promise<void> {
  await callUnary<unknown>('push.config', { set: patch })
}

/** Push one synthetic event through the configured L3 channels (test button). */
export async function testNotifyChannels(): Promise<void> {
  await callUnary<unknown>('push.config', { test: true })
}

/** Store this device's Web Push subscription host-side (L2). */
export async function pushSubscribe(subscription: {
  endpoint: string
  keys: { p256dh: string; auth: string }
}): Promise<void> {
  await callUnary<unknown>('push.subscribe', { subscription })
}

/** Remove this device's Web Push subscription host-side (L2). */
export async function pushUnsubscribe(): Promise<void> {
  await callUnary<unknown>('push.unsubscribe', {})
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

/** The recent decisions + delivery telemetry (newest first). */
export async function notifyEvents(): Promise<{
  items: NotifyEventView[]
  stats?: DeliveryStatsView
  deliveries?: DeliveryRecordView[]
}> {
  return await callUnary<{
    items: NotifyEventView[]
    stats?: DeliveryStatsView
    deliveries?: DeliveryRecordView[]
  }>('mobile.notifyEvents', {})
}

/** The published latest version + whether the local one is behind. */
export async function latestVersion(): Promise<{ latest: string; isNewer: boolean }> {
  return await callUnary<{ latest: string; isNewer: boolean }>('mobile.latestVersion', {})
}

/**
 * 读一张会话里引用过的图片，返回可直接放进 `<img src>` 的 data URL。
 *
 * 0.1.5 起图片字节不在会话事件里（事件只带 `attachmentId` 引用），宿主按
 * "该会话确实引用过这张图"授权后才给字节；attachmentId 是内容寻址的 sha256，
 * 宿主侧按 id 长期缓存，所以重复调用很便宜。
 * @param sessionId - 授权与校验引用关系的会话。
 * @param attachmentId - 事件里折出来的附件 id。
 * @returns 媒体类型与 data URL。
 */
export async function readAttachment(sessionId: string, attachmentId: string): Promise<{ mediaType: string; dataUrl: string }> {
  return await callUnary<{ mediaType: string; dataUrl: string }>('mobile.readAttachment', { sessionId, attachmentId })
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

/**
 * 依赖自检：宿主契约是否在位 + 各总线事件运行期收到过多少帧。
 * 事件被改名或停发时订阅仍会成功，所以 `frames === 0` 才是"这条断了"的证据。
 */
export async function readDiagnostics(): Promise<{ checks: DependencyCheckView[]; now: number }> {
  return await callUnary<{ checks: DependencyCheckView[]; now: number }>('mobile.diagnostics', {})
}

/**
 * Hand one perf capture to the host (`mobile.perf`), which writes it beside its
 * own state and answers with the file name. Write-only and host-named: the phone
 * never chooses a path, and the host validates the shape and prunes old captures
 * (see mobile-api.ts). Callers fall back to the clipboard when this rejects —
 * the capture only exists in this page's memory.
 */
export async function reportPerf(capture: unknown, label: string): Promise<{ file: string; bytes: number }> {
  return await callUnary<{ file: string; bytes: number }>('mobile.perf', { capture, label })
}

/**
 * Hand one error record to the host (`mobile.error`), which validates its shape,
 * writes it under `dsh-palm-errors/` and pushes on first sight. The payload is
 * exactly the sanitized shape `errors.ts` already keeps — no full stack, no
 * origin, no argument text — and the file name is generated host-side, so the
 * record's strings can never steer a path. Write-only and best-effort: the
 * errors-report outbox swallows failures by contract.
 */
export async function reportError(report: unknown, label: string): Promise<{ file: string; bytes: number; pushed: boolean }> {
  return await callUnary<{ file: string; bytes: number; pushed: boolean }>('mobile.error', { report, label })
}

/**
 * Main-agent sessions whose attached agent is running right now (host-side
 * enumeration). The run-overview entry seeds its badge from this so a session
 * that started generating before the phone opened still counts — its
 * turn/start frame is gone by then and session.list's TTL may be stale.
 */
/**
 * 一轮的实时状态，宿主给的结论：`{ running, turnStartAt?, lastEventAt?, asOf }`。
 *
 * 这是手机唯一该问「还在跑吗」的地方。宿主把"转发的帧看到的轮次边界"和"日志写下的
 * 边界"按 seq 比一次再回答；手机端不再拿静默时长、日志窗口里看不看得见边界、会话表
 * 行的 running 去推断——那三条都曾经把正跑着的一轮判成已完成。
 */
/**
 * 轮次大纲（导航清单用）。尾页为了省 87 KB 不带它，客户端在这里单独取一次；
 * 宿主查的是花名册枚举留下的投影快照，查不到就回 `turns: null`。
 */
export async function turnOutlineOf(sessionId: string): Promise<{ turns: unknown }> {
  return await callUnary<{ turns: unknown }>('mobile.turnOutline', { sessionId })
}

/**
 * 排队消息（宿主 `inbox` 投影里的 next-turn）。
 *
 * 桌面端 QueueDock 读的就是这份投影；手机端此前只等 `session/queue` 帧，而宿主从不发
 * 它，投影帧实测也到不了手机 —— 于是排队卡片永远是空的。这里直接问宿主要快照。
 */
/**
 * 排队快照。
 *
 * resh 只在**刚改过队列**（发送/删除/编辑）时用：宿主那边 fresh=1 会现开一帧 follow
 * 并读一页 history，而手机在回合跑着的时候每 5 秒问一次 —— 那样每条排队消息都要
 * 拖一次整日志读，弱网下反而更慢。平时走宿主的投影快照，改完自己再要一次新的。
 */
/**
 * 一次原子的会话快照：行 + 队列 + 回合 + 队列版本都在同一个切面上。
 *
 * 手机端以前要 logTail / inbox / turnState 三次调用才能拼出一屏，三次落在不同时刻，
 * 于是"队列说还有一条、回合说已经开始了"这类矛盾随时可见。这条通道把三者收成一份，
 * 由 `session-store.ts` 按 seq / revision 单调合并（低水位的一律丢弃）。
 */
export async function sessionState(
  sessionId: string,
  options: { fresh?: boolean } = {},
): Promise<{
  sessionId: string
  rows: RenderMessage[]
  maxSeq: number
  queue: QueueItemView[]
  queueRevision: number
  /** 队列内容指纹（任何客户端改动队列它都会变；老宿主缺省）。 */
  queueToken?: string
  turn: { running: boolean; turnStartAt?: number; lastEventAt?: number }
  /** 目标投影（与 mobile.goal 同一个形状），同一切面下发。 */
  goal?: unknown
  goalActivation?: 'armed' | 'disarmed'
  /** 最新一份 todo/write 快照（宿主折叠窗口里最新的那条）。 */
  todo?: { seq: number; items: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }> }
  asOf: number
}> {
  return await callUnary('mobile.sessionState', {
    sessionId,
    ...(options.fresh === true ? { fresh: true } : {}),
  })
}

export async function inboxOf(sessionId: string, options: { fresh?: boolean } = {}): Promise<{ inbox: unknown }> {
  return await callUnary<{ inbox: unknown }>('mobile.inbox', {
    sessionId,
    ...(options.fresh === true ? { fresh: true } : {}),
  })
}

/**
 * 目标条：读会话的 `goal` 投影。宿主回的是线上形状 `{ goal: { current } | null }`，
 * 解析交给 `parseGoalProjection`（容忍 current / goal / 直接快照三种来路）。
 *
 * 平时不带 fresh（读花名册快照）；刚点过暂停/恢复/编辑/清除的那一次带 fresh，
 * 让宿主现取当下相位，避免条子还显示旧状态。
 */
export async function goalOf(
  sessionId: string,
  options: { fresh?: boolean } = {},
): Promise<{ goal: unknown; activation?: 'armed' | 'disarmed' }> {
  return await callUnary<{ goal: unknown; activation?: 'armed' | 'disarmed' }>('mobile.goal', {
    sessionId,
    ...(options.fresh === true ? { fresh: true } : {}),
  })
}

/** 手机上能点的四种目标动作（与桌面端 remote.goals.* 同一套语义）。 */
export type MobileGoalAction = 'pause' | 'resume' | 'edit' | 'clear'

/**
 * 目标动作：直连宿主目标服务，语义与桌面端 GoalBar 一致。
 *
 * 暂停只是撤掉"允许自动继续"的授权（durable 相位仍是 active），恢复是重新授权；
 * 编辑与清除走同一条 CAS。宿主没装目标服务时宿主会回 unavailable，调用方回退到
 * `/goal …` 命令通道。
 */
export async function goalAction(
  sessionId: string,
  action: MobileGoalAction,
  options: { objective?: string } = {},
): Promise<{ goal: unknown; activation?: 'armed' | 'disarmed' }> {
  return await callUnary<{ goal: unknown; activation?: 'armed' | 'disarmed' }>('mobile.goalAction', {
    sessionId,
    action,
    ...(options.objective === undefined ? {} : { objective: options.objective }),
  })
}

export async function turnState(sessionId: string): Promise<TurnState> {
  return await callUnary<TurnState>('mobile.turnState', { sessionId })
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
}
export async function runningSessions(): Promise<{ sessionIds: string[] }> {
  return await callUnary<{ sessionIds: string[] }>('mobile.runningSessions', {})
}

/** One session.list page; omit the cursor for the first page. */
export async function listSessions(cursor?: string, workspaceId?: string): Promise<SessionPage> {
  // workspaceId 让宿主在切片前就按工作区过滤：每页返回的都是本工作区的会话，
  // 客户端不再需要"连拉多页再丢弃"（那正是"点很多次"与"往深处拉超时"的共同来源）。
  // 同一 (cursor, workspaceId) 的重复调用合并：真机实测首屏同 payload 发 3 次。
  return await coalescedRead<SessionPage>('session.list', {
    ...(cursor === undefined ? {} : { cursor }),
    ...(workspaceId === undefined ? {} : { workspaceId }),
  })
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

/** Search every session's messages across the whole host (with attribution). */
export async function searchAll(query: string): Promise<{ items: SessionSearchHit[]; hasMore: boolean; partial?: boolean }> {
  return await callUnary<{ items: SessionSearchHit[]; hasMore: boolean; partial?: boolean }>('mobile.searchAll', { query })
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

export interface IndexedSearchResult {
  items: IndexedSearchItem[]
  total: number
  hasMore: boolean
  /** 下一页的 offset（原样传回来就是「加载更多」）。 */
  nextOffset?: number
  /** 宿主侧索引耗时（不含网络）。 */
  tookMs: number
  /** true = 索引还没建好（或宿主没有 node:sqlite），调用方应退回 searchAll。 */
  fallback?: boolean
  source?: 'index'
}

/**
 * 宿主自建索引搜索（期 2）。中文按相邻二字组入索引，所以 2 字词也搜得到，
 * 不再靠「FTS 猜 + 子串补扫」。`fallback: true` 时必须退回 {@link searchAll}：
 * 索引是后台建的，刚启动那几分钟还没追上。
 */
export async function searchSessions(
  options: { query: string; sessionId?: string; sessions?: number; perSession?: number; offset?: number },
  signal?: AbortSignal,
): Promise<IndexedSearchResult> {
  return await callUnary<IndexedSearchResult>('mobile.search', options, signal)
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

/**
 * Locate message-level hits inside ONE session (`mobile.searchMessages`,
 * answered by the host): the lazy detail behind an expanded search-hit row.
 * Bounded to the first 8 hits and a defensive history-page ceiling; the
 * locate scan continues through the session so deep search results remain
 * addressable. Results are cached for 60s.
 */
export async function searchMessages(sessionId: string, query: string): Promise<{ items: SessionMessageHit[] }> {
  return await callUnary<{ items: SessionMessageHit[] }>('mobile.searchMessages', { sessionId, query })
}

/** Read the available agent compositions for a new session. */
export async function listAgentPresets(): Promise<AgentPresetRoster> {
  return await callUnary<AgentPresetRoster>('agentPreset.list', {})
}

/**
 * Create a blank session (entity birth precedes the first message). Name a
 * workspace to attach it there, or a cwd; omitting both uses the host cwd.
 */
export async function createSession(
  options: { workspaceId?: string; cwd?: string; agentPreset?: string } = {},
): Promise<CreatedSession> {
  const created = await callUnary<CreatedSession>('session.create', options)
  // 新会话必须立刻出现在列表里：清掉读取合并窗口与工作区花名册窗口。
  invalidateReadCoalescing()
  invalidateWorkspaceRoster()
  return created
}

/**
 * One history window; omit beforeSeq for the tail page, pass a signal to abort.
 * The mobile page size is 25 (the desktop uses 30): a page of 30 messages
 * can exceed 1 MB of JSON for tool-heavy sessions, which over a slow phone
 * link outlives the client's history-load timeout and surfaces as a
 * transport error. 25 keeps the tail page small enough to load reliably
 * while still showing a screen and a half of context on open (the loadOlder
 * button pages further on demand).
 */
export async function history(
  sessionId: string,
  beforeSeq?: number,
  maxMessages = 25,
  signal?: AbortSignal,
  // 冷宿主/大会话的首页与锚定页实测 17~109 s，默认 60 s 会先掐断（见 READ_CHAT_TIMEOUT_MS）。
  timeoutMs: number = READ_CHAT_TIMEOUT_MS,
): Promise<HistoryPage> {
  return await callUnary<HistoryPage>('session.history', {
    sessionId,
    maxMessages,
    ...(beforeSeq !== undefined ? { beforeSeq } : {}),
  }, signal, timeoutMs)
}

/** 打开会话时可以顺带取回的小目录（服务端白名单，见 mobile-api readChatInclude）。 */
export type ChatOpenInclude = 'models' | 'subagents'

/** 同一次 `mobile.readChat` 响应里带回来的小目录。 */
export interface ChatOpenExtras {
  models?: SessionModels
  subagents?: SubagentCatalog
}

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
 * Folded-view chat read (v3): the host serves message rows from its mux-fed
 * window cache instead of the raw event stream — a repeat visit to a session
 * costs zero log reads, and the wire carries rows instead of the full chunk/
 * tool event tail. Fall back to {@link history} + a local fold when the host
 * answers unavailable (older plugin); see App.loadChatPage.
 */
/**
 * `mobile.readChat` 的 RPC 上限。默认 60 s 对热宿主够用，但冷启动/大会话被
 * 换出内存时，实测首页读要 17~109 s（317 会话里最大的那个 6986 条），60 s 一到
 * 就被 RPC 层掐断，页面停在「加载中…」——用户看到的就是「点了结果进不去」。
 */
export const READ_CHAT_TIMEOUT_MS = 180_000

export async function readChat(
  sessionId: string,
  beforeSeq?: number,
  maxRows = 25,
  signal?: AbortSignal,
  include?: readonly ChatOpenInclude[],
  timeoutMs: number = READ_CHAT_TIMEOUT_MS,
): Promise<ChatPage> {
  return await callUnary<ChatPage>('mobile.readChat', {
    sessionId,
    ...(beforeSeq !== undefined ? { beforeSeq } : {}),
    ...(maxRows !== 25 ? { maxRows } : {}),
    ...(include !== undefined && include.length > 0 ? { include: [...include] } : {}),
  }, signal, timeoutMs)
}

/**
 * 会话日志尾部直读（C）：宿主只解日志尾部若干 zstd 帧，在服务端就折叠成与
 * readChat 同形的页（rows/maxSeq/todo/turnStartAt），手机拿到直接渲染。
 *
 * 宿主的 readChat 冷读要整文件解压（52 MB 会话实测 4.1 s），这条通道几十
 * 毫秒，用来铺首屏；翻旧页仍走 readChat，它掌握投影与窗口缓存。宿主不认这个
 * 方法时（旧插件）调用会失败，调用方回落到 readChat。
 */
export async function logTail(
  sessionId: string,
  maxRows?: number,
  signal?: AbortSignal,
): Promise<ChatPage> {
  return await callUnary<ChatPage>('mobile.logTail', {
    sessionId,
    ...(maxRows !== undefined ? { maxRows } : {}),
  }, signal)
}

/**
 * Tell the host which session this phone has open (v3.4). The host keeps ONE
 * `session.follow({assistantStream:true})` for the observed sessions — that is
 * what makes the phone stream token-by-token like the desktop. The phone
 * re-asserts on a slow cadence so a dropped SSE stream (which releases the
 * registration host-side) heals without leaving the chat; `undefined` means
 * the chat was left.
 */
export async function observeSession(sessionId: string | undefined, signal?: AbortSignal): Promise<void> {
  // 同一状态在窗口内只断言一次：实测启动时 `{}` 被连发两次（路由从首页
  // 切到列表，effect 重跑），每次都是一个新的宿主侧 follow 注册，没有收益。
  const key = sessionId ?? ''
  const last = lastObservedAt
  if (last !== undefined && last.key === key && Date.now() - last.at < OBSERVE_ASSERT_MIN_MS) return
  lastObservedAt = { key, at: Date.now() }
  try {
    await callUnary<unknown>('mobile.observe', sessionId === undefined ? {} : { sessionId }, signal)
  } catch (error) {
    // A failed assert must not arm the window: the next cadence tick retries.
    if (lastObservedAt?.key === key) lastObservedAt = undefined
    throw error
  }
}

/** One batch preview row (summary is '' when the session has no text yet). */
export interface SessionPreview {
  sessionId: string
  summary: string
  updatedAt: number
}

/** Cap on one batch preview request (host-side limit is the same). */
export const SESSION_PREVIEW_BATCH_LIMIT = 200

/**
 * Batch last-message previews (v3.1): the session-list page's preview lines
 * served by the host in ONE call — cached rows cost zero host log reads; a
 * session without a cache entry costs one lazy tail read. Fall back to
 * per-row {@link history} reads when the host answers unavailable (older
 * plugin); see SessionListView.loadPreviews.
 */
export async function previews(
  sessionIds: readonly string[],
  // 合并后的读无法逐个取消：保留参数只为调用点签名稳定。
  _signal?: AbortSignal,
): Promise<SessionPreview[]> {
  const ids = sessionIds.filter(id => id !== '').slice(0, SESSION_PREVIEW_BATCH_LIMIT)
  if (ids.length === 0) return []
  // 预览只是列表的摘要行：同一批 id 在一次进列表里会被触发多次（真机实测 3 次，
  // 其中两次相隔 100ms），合并成一次即可。signal 不参与合并——这是可放弃的读。
  const response = await coalescedRead<{ items: SessionPreview[] }>('mobile.previews', { sessionIds: ids })
  return response.items
}

/**
 * Send a prompt (queued: the agent picks it up in order). `parts` supports
 * text plus attached images (`{ type: 'image', mediaType, data, name? }`);
 * the host promotes image bytes to durable references.
 */
export async function prompt(sessionId: string, parts: PromptPart[]): Promise<void> {
  await callUnary<{ accepted: true }>('session.prompt', {
    sessionId,
    mode: 'queue',
    content: parts,
  })
}

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
  /** 这条排队消息带的文件附件收据（界面显示用）。 */
  receipts?: string[]
  /** 编辑时要原样拼回去的非文本块（文件/图片）：宿主那边收据还在，不用重传字节。 */
  keepParts?: unknown[]
}

/**
 * Map one raw host queue item (the `session/queue` frame shape) into the
 * phone's queue row view. The host frame type is merge-extensible (content
 * blocks carry a wide payload), so the mapper reads only the narrow fields it
 * needs and never asserts the full shape.
 */
/** 非文本块的占位词：排队条上出现 [image] [file] 这种半英文，普通用户读不懂。 */
function queueBlockLabel(type: string | undefined): string {
  switch (type) {
    case 'image': return '图片'
    case 'file': return '文件'
    case 'audio': return '音频'
    case 'video': return '视频'
    case 'document': return '文档'
    default: return '内容'
  }
}

export function queueItemViewOf(item: {
  id: string
  placement: 'queued' | 'steering' | 'context'
  message?: { content?: unknown }
}): QueueItemView {
  const blocks = Array.isArray(item.message?.content)
    ? (item.message.content as Array<{ type?: string; text?: string }>)
    : []
  const editable = blocks.length > 0 && blocks.every(block => block.type === 'text' && typeof block.text === 'string')
  const text = editable
    ? (blocks as Array<{ text: string }>).map(block => block.text).join('')
    : blocks
      .map(block => block.type === 'text' && typeof block.text === 'string' ? block.text : `[${queueBlockLabel(block.type)}]`)
      .join(' ')
      .trim()
  return { id: item.id, placement: item.placement, text, editable }
}

/** A queue mutation: edit the pending text, remove it, or steer it into the
 *  running turn (only while the agent is running). */
/** 一条待发消息的内容块：正文，以及原样保留的文件/图片块。 */
export type QueueEditPart =
  | { type: 'text'; text: string }
  | { type: 'file'; receiptId: string }
  | { type: 'image'; attachmentId: string }

export type QueueAction =
  // 编辑只改正文：附件/图片按原样拼回去（宿主那边收据还在，不用重传字节）。
  | { kind: 'edit'; content: QueueEditPart[] }
  | { kind: 'remove' }
  | { kind: 'steer' }

/** Edit / remove / steer one pending queued message on the host. */
export async function updateQueue(sessionId: string, itemId: string, action: QueueAction): Promise<void> {
  await callUnary<{ accepted: true }>('session.updateQueue', { sessionId, itemId, action })
}

/** One slash command the host registry advertises (name + description). */
export interface CommandDescriptor {
  name: string
  description: string
  input?: { hint?: string }
}

/**
 * List the host's registered slash commands for one session (read-only
 * discovery). The session id resolves the agent whose effective command view
 * the phone shows — the same catalog the desktop composer's `/` popup lists.
 */
export async function listCommands(sessionId: string): Promise<CommandDescriptor[]> {
  const response = await callUnary<{ items?: CommandDescriptor[] }>('mobile.commands', { sessionId })
  return response.items ?? []
}

/** One executed slash-command outcome from the host registry. */
export interface CommandExecOutcome {
  /** false: the line did not resolve to a registered command (nothing ran). */
  matched: boolean
  kind?: 'success' | 'error'
  /** The command's own human result text (usage/state feedback), when any. */
  text?: string
}

/**
 * Execute one slash-command line through the host command registry
 * (`mobile.commandExec` — the same interception the desktop composer uses).
 * Never send a `/`-line through `prompt`: the host prompt channel does not
 * dispatch commands, so the line would reach the model verbatim.
 *
 * The cap is long (180 s) instead of the 60 s default: `/compact` summarizes
 * through the model and can outlive it. A finite ceiling still beats the
 * old disabled timeout — a hung link otherwise pins the composer's sending
 * state forever with no way to recover.
 */
export async function sendCommand(sessionId: string, line: string): Promise<CommandExecOutcome> {
  return await callUnary<CommandExecOutcome>('mobile.commandExec', { sessionId, line }, undefined, 180_000)
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

/**
 * 把一个文件的 base64 交给宿主暂存（`mobile.uploadAttachment`）。
 *
 * 手机端不直传宿主桌面的 `/upload` 通道（那条走桌面鉴权），由插件代传：宿主的附件
 * 服务落盘后回一个 receiptId，prompt 里带 `{ type: 'file', receiptId }` 即可。超时
 * 给到 120 秒：一张照片在隧道里也要几十秒，而误触重发比等久一点更烦人。
 */
/**
 * 把一份附件交给宿主暂存。
 *
 * `signal` 是**用户取消**用的（弱网传 20 MB 卡住时，chip 上要能点掉重来）。
 * 超时另有 120 秒的兜底，两者互相独立：取消是主动的，超时是兜底。
 */
export async function uploadAttachment(
  sessionId: string,
  file: { name: string; data: string },
  signal?: AbortSignal,
): Promise<UploadedAttachment> {
  return await callUnary<UploadedAttachment>('mobile.uploadAttachment', { sessionId, ...file }, signal, 120_000)
}

/**
 * Transcribe one base64 WAV through the phone-configured speech-to-text
 * services (`mobile.transcribe`, answered by the plugin). The services are
 * tried in order by the host; the cap is long (180 s) because a slow link
 * can stretch the call.
 */
export async function transcribeVoice(audio: string, services: VoiceService[]): Promise<string> {
  const response = await callUnary<{ text: string }>('mobile.transcribe', { audio, services }, undefined, 180_000)
  return response.text
}

/**
 * The host-side fallback transcription services (dsh-palm.yaml `transcribe:`),
 * if any — display facts only. The host API keys never leave the host, so
 * these services cannot be used from the phone and are not merged into the
 * local service list (see syncHostVoiceServices).
 */
export async function fetchHostVoiceServices(): Promise<Array<{ name: string; baseURL: string; model: string }>> {
  const response = await callUnary<{ services: Array<{ name: string; baseURL: string; model: string }> }>('mobile.voiceServices', {})
  return response.services
}

/* ── per-provider usage / balance display ─────────────────────────────── */

/** Per-model usage inside a provider's report. */
export interface UsageModelRow {
  name: string
  requestCount: number
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

/** The full usage surface, synced from the desktop's configured providers. */
export interface UsageView {
  providers: UsageProviderView[]
  fetchedAt: number
}

/**
 * Fetch the per-provider usage/balance surface (`mobile.usage`, answered by the
 * plugin host-side). The desktop's configured providers drive the rows; a
 * provider with no public balance/usage endpoint is labelled `unsupported`, one
 * the desktop has no key for is `no-key`. Pass `refresh` to bypass the host's
 * short cache.
 */
export async function fetchUsage(refresh?: boolean): Promise<UsageView> {
  return await callUnary<UsageView>('mobile.usage', refresh === true ? { refresh: true } : {})
}

/** Rename one session (the chat page's 更多 menu). */
export async function renameSession(sessionId: string, title: string): Promise<unknown> {
  const renamed = await callUnary<unknown>('session.rename', { sessionId, title })
  // 新标题要能立刻回列表看到：清掉列表的复用窗口（工作区页也用同一份）。
  invalidateReadCoalescing()
  invalidateWorkspaceRoster()
  return renamed
}

/**
 * Stop the session's active turn (the mobile stop button). Pending queued
 * work is preserved and resumes in FIFO order once cancellation settles.
 */
export async function cancelSession(sessionId: string): Promise<{ accepted: true }> {
  return await callUnary<{ accepted: true }>('session.cancel', { sessionId })
}

/** Direct-child subagent catalog for one parent (labels + activity + hasChildren). */
export async function subagentsList(parentSessionId: string): Promise<SubagentCatalog> {
  // 进会话时实测同一 parent 连发多次（5 次）：合并成一次。
  return await coalescedRead<SubagentCatalog>('subagent.list', { parentSessionId })
}

/**
 * Fresh advisory model directory for one session (current + groups + failures).
 *
 * 模型目录只在用户改选择或宿主配置变更时变，而手机端每次进会话、每次点开会
 * 选择器都会重读一遍（真机实测 4G 下 ~190ms、弱网 ~1s）。这里给 30 秒窗口，
 * 改过选择（selectModel）立刻清窗，所以不会看到旧选中项。
 */
export async function models(sessionId: string): Promise<SessionModels> {
  return await coalescedRead<SessionModels>('session.models', { sessionId }, MODELS_TTL_MS)
}

/** Select the complete model selection (provider/model/reasoning effort) for a session. */
export async function selectModel(
  sessionId: string,
  selection: { provider: string; model: string; reasoningEffort?: string },
): Promise<{ selected: { provider: string; model: string; reasoningEffort?: string } }> {
  const result = await callUnary<{ selected: { provider: string; model: string; reasoningEffort?: string } }>('session.selectModel', {
    sessionId,
    provider: selection.provider,
    model: selection.model,
    ...(selection.reasoningEffort !== undefined ? { reasoningEffort: selection.reasoningEffort } : {}),
  })
  // 换了模型就必须让缓存里的目录（current 字段）失效，否则选择器会显示旧选中项。
  invalidateReadCoalescing()
  return result
}

/* ── pending approvals / questions (#1025) ───────────────────────────── */

/** One pending tool approval awaiting the user's decision. */
export interface PendingApproval {
  /** The approval/requested frame's rpcId — the wire correlation the answer echoes. */
  rpcId: string
  approvalId: string
  toolName: string
  callId?: string
  reason?: string
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

/** The pending state for one session. */
export interface PendingState {
  approvals: PendingApproval[]
  questions: PendingQuestionItem[]
}

/** Fetch pending approvals and questions for one session (polling fallback data source). */
export async function fetchPending(sessionId: string): Promise<PendingState> {
  return await callUnary<PendingState>('mobile.pending', { sessionId })
}

/* ── read-only git summary ───────────────────────────────────────────── */

/** One changed path (see the host's mobile-git module). */
export interface GitFileChange {
  path: string
  status: string
  staged: boolean
}

/** One recent commit. */
export interface GitCommit {
  shortHash: string
  subject: string
  author: string
  at: number
}

/** What the git sheet renders. */
export interface GitSummary {
  repo: boolean
  branch?: string
  ahead?: number
  behind?: number
  files: GitFileChange[]
  commits: GitCommit[]
  warning?: string
}

/** Read the repository state of one directory (never mutates it). */
export async function fetchGitSummary(cwd: string): Promise<GitSummary> {
  return await callUnary<GitSummary>('mobile.gitSummary', { cwd })
}

/** Submit an approval decision (allowed-once or rejected). The answer is a
 * client-response echoing the approval/requested frame's rpcId. */
export async function respondApproval(
  rpcId: string,
  sessionId: string,
  approvalId: string,
  outcome: 'allowed-once' | 'rejected',
): Promise<void> {
  await callUnary<unknown>('mobile.respond', {
    rpcId,
    response: { sessionId, approvalId, outcome },
  })
}

/** Submit answers to a question group (one batch per ask, echoing its rpcId). */
export async function respondQuestion(
  rpcId: string,
  sessionId: string,
  answer: { answers: Array<{ id: string; selected: string[]; custom?: string }> },
): Promise<void> {
  await callUnary<unknown>('mobile.respond', {
    rpcId,
    response: { sessionId, answer },
  })
}

/* ── directory browsing / workspace creation (#977) ──────────────────── */

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

/** The host directory listing result (one level, with ancestor breadcrumbs). */
export interface DirectoryListing {
  path: string
  home: string
  crumbs: DirectoryEntry[]
  entries: DirectoryEntry[]
  truncated: boolean
}

/** The result of creating a workspace from an existing directory. */
export interface WorkspaceCreateResult {
  workspace: WorkspaceView
  created: boolean
}

/** Browse one directory level on the host (defaults to home directory). */
export async function listDirectory(path?: string, options?: { files?: boolean }): Promise<DirectoryListing> {
  // Local patch (2026-08-23): host.listDirectory is gated on the composed
  // directory-picker capability (native on Windows loopback binds), so the
  // mobile browser uses the plugin's own fs listing instead.
  return await callUnary<DirectoryListing>('mobile.listDirectory', {
    ...(path === undefined ? {} : { path }),
    ...(options?.files === true ? { files: true } : {}),
  })
}

/** One file read back from the host for the chat's preview sheet. */
export type FilePreview =
  | { kind: 'text'; path: string; name: string; text: string }
  | { kind: 'image'; path: string; name: string; dataUrl: string }

/** Read one host file (text/image) for preview. A relative path resolves
 * against the owning session's cwd when `sessionId` is given. */
export async function readFile(path: string, sessionId?: string): Promise<FilePreview> {
  return await callUnary<FilePreview>('mobile.readFile', sessionId === undefined ? { path } : { path, sessionId })
}

/** Create a workspace from an existing host directory (does not mkdir). */
export async function createWorkspace(path: string): Promise<WorkspaceCreateResult> {
  const created = await callUnary<WorkspaceCreateResult>('workspace.create', { path })
  // 刚建好的工作区必须立刻出现在花名册里，不能被 5 秒窗口挡住。
  invalidateWorkspaceRoster()
  return created
}

/** Rename a workspace's display title (host validates trim/conflict). */
export async function renameWorkspace(workspaceId: string, title: string): Promise<{ workspace: WorkspaceView }> {
  const renamedWs = await callUnary<{ workspace: WorkspaceView }>('workspace.rename', { workspaceId, title })
  // 改完名字回列表要看到新名字。
  invalidateWorkspaceRoster()
  return renamedWs
}

/** Remove a workspace registration (the directory and session logs stay). */
export async function deleteWorkspace(workspaceId: string): Promise<{ deleted: true }> {
  const deleted = await callUnary<{ deleted: true }>('workspace.delete', { workspaceId })
  // 删掉的行不能再从复用窗口里画回来。
  invalidateWorkspaceRoster()
  return deleted
}

/**
 * Delete one session the way the desktop does: an archive-set write that
 * removes it from every roster forever (the phone filters the archive set in
 * its session.list already), while the session log stays on disk — the
 * desktop can still surface it (unarchive). Idempotent; unknown id errors.
 */
export async function archiveSession(sessionId: string): Promise<{ archivedSessionIds: string[] }> {
  const archived = await callUnary<{ archivedSessionIds: string[] }>('workspace.archiveSession', { sessionId })
  invalidateReadCoalescing()
  // 会话从工作区下消失，花名册里的 sessionIds 也变了。
  invalidateWorkspaceRoster()
  return archived
}

/* ── paired-device management (P1/P2/P3) ─────────────────────────────── */

/** One paired device as the phone's device-management screen sees it. */
export interface PairedDeviceView {
  id: string
  createdAt: number
  lastSeenAt: number
  online: boolean
  userAgent?: string
  name?: string
  primary?: boolean
  /** Whether this row is the device the phone is currently running on. */
  current: boolean
}

/** The paired-device roster + the cap the host enforces. */
export interface PairedDevicesView {
  devices: PairedDeviceView[]
  maxDevices: number
}

/** List every paired device (the phone's device-management screen). */
export async function listDevices(): Promise<PairedDevicesView> {
  return await callUnary<PairedDevicesView>('pair.devices', {})
}

/** Revoke one paired device (its next gated request is refused). */
export async function revokeDevice(deviceId: string): Promise<{ removed: boolean }> {
  return await callUnary<{ removed: boolean }>('pair.revoke', { deviceId })
}

/** Assign a user-facing display name to a device (empty clears it). */
export async function renameDevice(deviceId: string, name: string): Promise<{ renamed: boolean }> {
  return await callUnary<{ renamed: boolean }>('pair.rename', { deviceId, name })
}

/** Promote one device to primary (demotes the previous primary). */
export async function setPrimaryDevice(deviceId: string): Promise<{ promoted: boolean }> {
  return await callUnary<{ promoted: boolean }>('pair.setPrimary', { deviceId })
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

/** 读宿主账本（跨刷新、跨设备都在）。失败就当没有。 */
export async function fetchFinishedRuns(): Promise<HostFinishedRun[]> {
  const value = await callUnary<{ entries: HostFinishedRun[] }>('mobile.finishedRuns', { op: 'read' })
  return Array.isArray(value.entries) ? value.entries : []
}

/** 记一条到宿主账本（fire-and-forget：本地已经先记了，这里只是同步）。 */
export async function appendFinishedRun(entry: HostFinishedRun): Promise<void> {
  await callUnary('mobile.finishedRuns', { op: 'append', entries: [entry] })
}

/**
 * 从宿主账本里删掉一个会话的「刚结束」记录（用户已经点进去看过了）。
 *
 * 只删这一条：运行中页的口径是「只保留没打开过的」，所以打开即删。
 */
export async function removeHostFinishedRun(sessionId: string): Promise<void> {
  await callUnary('mobile.finishedRuns', { op: 'remove', sessionIds: [sessionId] })
}
