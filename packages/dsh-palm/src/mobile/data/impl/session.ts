/**
 * **data 实现 · session 域**（W4-4：按域切分 `api.ts`）。
 *
 * 这些函数原来都挤在 `api.ts` 里——73 个端点一个文件，谁也说不清改一处会碰到谁。
 * 现在按域归位；`api.ts` 保留 re-export，所以调用点一行都不用改。
 *
 * @module dsh-palm/mobile/data/impl/session
 */
import { callUnary } from '../../platform/rpc.ts'
import { coalescedRead, dedupeRead, invalidateReadCoalescing } from '../read-coalescing.ts'
import { READ_CHAT_TIMEOUT_MS, queueBlockLabel } from '../chat-helpers.ts'
import { OBSERVE_ASSERT_MIN_MS } from '../limits.ts'
import { lastObserveAt, setLastObserveAt } from '../observe-latch.ts'
import { invalidateWorkspaceRoster } from '../invalidate-roster.ts'
import { applyArchivedSessionIds } from '../../session/list-persist.ts'
import type { ChatOpenInclude, ChatPage, CommandExecOutcome, CreatedSession, HistoryPage, IndexedSearchResult, MobileGoalAction, PromptMode, QueueAction, QueueItemView, SessionFoldersView, SessionFolderView, SessionMessageHit, SessionPage, SessionSearchHit, TurnState } from '../../mobile-types.ts'
import type { RenderMessage } from '../../render/messages.ts'
import type { SubagentCatalog } from '../../../api-proxy-types'
import type { PromptPart } from '../../platform/image.ts'

/**
 * 轮次大纲（导航清单用）。尾页为了省 87 KB 不带它，客户端在这里单独取一次；
 * 宿主查的是花名册枚举留下的投影快照，查不到就回 `turns: null`。
 */
export async function turnOutlineOf(sessionId: string): Promise<{ turns: unknown }> {
  // 进会话那一波里，大纲会被导航/仪表两处各要一次：同一帧只发一次。
  return await callUnary<{ turns: unknown }>('mobile.turnOutline', { sessionId })
}

/**
 * 一次原子的会话快照：行 + 队列 + 回合 + 队列版本都在同一个切面上。
 *
 * 手机端以前要 logTail / inbox / turnState 三次调用才能拼出一屏，三次落在不同时刻，
 * 于是"队列说还有一条、回合说已经开始了"这类矛盾随时可见。这条通道把三者收成一份，
 * 由 `session-store.ts` 按 seq / revision 单调合并（低水位的一律丢弃）。
 */
/**
 * 正在读首屏行的会话 → 到达时要放行的等待者。
 *
 * 只在这个模块里用：`sessionState` 是所有快照请求的唯一出口，闸门放这里才能覆盖
 * 收件箱、回合对账、语音、附件等全部调用点（它们各自都不知道别人在问）。
 */
const entryLoads = new Map<string, Array<() => void>>()
/**
 * 别的会话正在读首屏时，非首屏请求排在这里等。
 *
 * 2026-11-15 真机/20× 实测：切走一个会话后，**旧会话**的 `rows:false` 还在飞，
 * 和新会话的首屏一起挤进宿主单线程 —— 同一个 73 字节的响应，单独跑 TTFB 1.3ms，
 * 切会话时排队 1508ms，而首屏排在它后面。原来的闸门只挡「同会话」，挡不住这种。
 */
const anyEntryWaiters: Array<() => void> = []

/** @param options.rows - 传 `false` 就**不要行**（C2）：整页行是这份快照里最贵的一段
 *  （一次 129 KB），回合对账只读 `turn`；老宿主忽略该字段、照旧回行，两端都不破。 */
export async function sessionState(
  sessionId: string,
  options: {
    fresh?: boolean
    rows?: boolean
    /**
     * 首屏要多少行。
     *
     * 不传就是宿主默认的尾页大小（25 行）—— 那不够铺满一屏，客户端只能再走 logTail。
     * 传了之后这一份快照就能直接当首屏：行、队列、回合、目标同一次到达。
     * 老宿主忽略该字段，照旧回小页（两端都不破）。
     */
    maxRows?: number
    /** 尾部字节窗口（宿主夹在 128 KB ~ 4 MB）。 */
    windowBytes?: number
  } = {},
): Promise<{
  sessionId: string
  rows: RenderMessage[]
  maxSeq: number
  queue: QueueItemView[]
  queueRevision: number
  /** 队列内容指纹（任何客户端改动队列它都会变；老宿主缺省）。 */
  queueToken?: string
  /**
   * 队列的**单调版本**（2026-11-10 架构修法）：宿主只在「队列事件」发生时 +1，
   * 读投影不推进。客户端据此丢弃「版本不大于已应用值」的陈旧快照 ——
   * 这是排队条 TTL / 观察窗 / 隐藏表那一族补丁的替代品。老宿主缺省。
   */
  queueVersion?: number
  /** 还有更早的行（客户端据此决定要不要补页；老宿主缺省）。 */
  hasMore?: boolean
  /** 首屏投影基线（权限 / 上下文压力；老宿主缺省）。 */
  projections?: { asOfSeq?: number; values?: Record<string, unknown> }
  turn: { running: boolean; turnStartAt?: number; lastEventAt?: number }
  /** 目标投影（与 mobile.goal 同一个形状），同一切面下发。 */
  goal?: unknown
  goalActivation?: 'armed' | 'disarmed'
  /** 最新一份 todo/write 快照（宿主折叠窗口里最新的那条）。 */
  todo?: { seq: number; items: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }> }
  asOf: number
}> {
  /*
   * 首屏闸门（2026-11-15）：首屏那条还在读日志时，让「只要回合/队列」的那些请求等一下。
   *
   * 真机时间线（冷会话）：点下去同一毫秒发六条，其中 `rows:false`（收件箱/回合对账）
   * 和 `maxRows:40`（首屏）读的是**同一份日志**。宿主单线程只能排队，首屏排在后面 ——
   * 实测 `rows:false` 708ms 完成后首屏才 1682ms 返回，用户在等的是这段排队。
   * 队列状态晚几百毫秒到不影响任何操作（写操作本身是乐观的），但首屏能少排一次队。
   *
   * 用「等首屏落地」而不是定时轮询：首屏成功/失败/超时都会把等待者放出去。
   */
  const isEntryRead = options.maxRows !== undefined
  let entryWaiters: Array<() => void> | undefined
  if (isEntryRead) {
    entryWaiters = entryLoads.get(sessionId) ?? []
    entryLoads.set(sessionId, entryWaiters)
  } else if (options.rows === false && entryLoads.has(sessionId)) {
    await new Promise<void>((resolve) => {
      const list = entryLoads.get(sessionId) ?? []
      list.push(resolve)
      entryLoads.set(sessionId, list)
      // 兜底：首屏那条万一卡住/抛错，也不能把对账永久挂在这里。
      setTimeout(resolve, 3_000)
    })
  } else if (options.rows === false && entryLoads.size > 0) {
    // 别的会话正在读首屏：让一下，别和它抢宿主单线程。
    await new Promise<void>((resolve) => {
      anyEntryWaiters.push(resolve)
      setTimeout(resolve, 3_000)
    })
  }
  try {
    // 同一帧里首屏、回合对账、队列三条链路都会问一次；合并成一个请求
    // （真机：两个 750ms 的同参请求并排飞，宿主单线程里读两遍同一份日志）。
    return await dedupeRead('mobile.sessionState', {
      sessionId,
      ...(options.fresh === true ? { fresh: true } : {}),
      ...(options.rows === false ? { rows: false } : {}),
      ...(options.maxRows === undefined ? {} : { maxRows: options.maxRows }),
      ...(options.windowBytes === undefined ? {} : { windowBytes: options.windowBytes }),
    })
  } finally {
    if (entryWaiters !== undefined) {
      entryLoads.delete(sessionId)
      for (const release of entryWaiters) release()
      // 首屏都结束了，让排在后面的（含别的会话）继续。
      if (entryLoads.size === 0) {
        for (const release of anyEntryWaiters.splice(0)) release()
      }
    }
  }
}

export async function inboxOf(sessionId: string, options: { fresh?: boolean } = {}): Promise<{ inbox: unknown; queueVersion?: number }> {
  return await callUnary<{ inbox: unknown; queueVersion?: number }>('mobile.inbox', {
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

export async function runningSessions(): Promise<{ sessionIds: string[] }> {
  return await callUnary<{ sessionIds: string[] }>('mobile.runningSessions', {})
}

/**
 * 这笔投递宿主受理过没有。
 *
 * 2026-11-12：送达核实唯一一条**不是猜**的证据。宿主在处理 `session.prompt` 成功返回时
 * 记下 `sessionId + requestId`，这里直接问它。返回 `accepted: false` 表示"没有记录"
 * （宿主重启过、或真的没送到），调用方应当按 unknown 处理 —— 不要据此回撤正文。
 *
 * @param sessionId - 会话 id
 * @param requestId - 这次投递的 id
 * @returns 受理过为 true
 */
export async function deliveryAccepted(sessionId: string, requestId: string): Promise<boolean> {
  const reply = await callUnary<{ accepted?: boolean }>('session.deliveryCheck', { sessionId, requestId })
  return reply?.accepted === true
}

/** One session.list page; omit the cursor for the first page. */
export async function listSessions(cursor?: string, workspaceId?: string): Promise<SessionPage> {
  // workspaceId 让宿主在切片前就按工作区过滤：每页返回的都是本工作区的会话，
  // 客户端不再需要"连拉多页再丢弃"（那正是"点很多次"与"往深处拉超时"的共同来源）。
  // 同一 (cursor, workspaceId) 的重复调用合并：真机实测首屏同 payload 发 3 次。
  const page = await coalescedRead<SessionPage>('session.list', {
    ...(cursor === undefined ? {} : { cursor }),
    ...(workspaceId === undefined ? {} : { workspaceId }),
  })
  // 宿主每页都带归档集：抽屉合并时用它挡掉"别的设备删掉、却还画在行里"的会话。
  if (page.archivedSessionIds !== undefined) applyArchivedSessionIds(page.archivedSessionIds)
  return page
}

/** Search every session's messages across the whole host (with attribution). */
export async function searchAll(query: string): Promise<{ items: SessionSearchHit[]; hasMore: boolean; partial?: boolean }> {
  return await callUnary<{ items: SessionSearchHit[]; hasMore: boolean; partial?: boolean }>('mobile.searchAll', { query })
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
 * 最近读过的历史页（2026-11-15）。
 *
 * 真机实测：切一个会话，`session.history` 被**两条链路各拉三页**、参数逐字相同，
 * 255KB 拉了两遍。一条是分页器往上补，另一条是 `loadTurnReportRows` 补读交付卡片。
 * 会话日志越大越贵（要解压整份日志，52MB 会话实测 34 秒），这 2 倍重复直接翻倍了卡顿。
 * 历史页是过去的记录，十秒内不会变。
 */
const RECENT_HISTORY_TTL_MS = 10_000
const RECENT_HISTORY_MAX_ENTRIES = 40
const recentHistory = new Map<string, { at: number; page: HistoryPage }>()
/** 同参数正在飞的请求：两条链路几乎同时要同一页时合并成一次（缓存来不及写入）。 */
const inFlightHistory = new Map<string, Promise<HistoryPage>>()

/** 清掉短期历史缓存（测试用：同一个进程里多次调用不该互相喂数据）。 */
export function resetRecentHistoryForTest(): void {
  recentHistory.clear()
  inFlightHistory.clear()
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
  const key = `${sessionId}|${beforeSeq ?? 'tail'}|${maxMessages}`
  const cached = recentHistory.get(key)
  // 浅拷贝：调用方偶尔会挂字段，别让后来者读到被改过的版本。
  if (cached !== undefined && Date.now() - cached.at < RECENT_HISTORY_TTL_MS) return { ...cached.page }
  const running = inFlightHistory.get(key)
  if (running !== undefined) return { ...(await running) }
  const task = callUnary<HistoryPage>('session.history', {
    sessionId,
    maxMessages,
    ...(beforeSeq !== undefined ? { beforeSeq } : {}),
  }, signal, timeoutMs).then((page) => {
    if (recentHistory.size >= RECENT_HISTORY_MAX_ENTRIES) {
      const oldest = recentHistory.keys().next()
      if (oldest.done !== true) recentHistory.delete(oldest.value)
    }
    recentHistory.set(key, { at: Date.now(), page })
    return page
  })
  inFlightHistory.set(key, task)
  try {
    return { ...(await task) }
  } finally {
    inFlightHistory.delete(key)
  }
}

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
  const last = lastObserveAt()
  if (last !== undefined && last.key === key && Date.now() - last.at < OBSERVE_ASSERT_MIN_MS) return
  setLastObserveAt({ key, at: Date.now() })
  try {
    await callUnary<unknown>('mobile.observe', sessionId === undefined ? {} : { sessionId }, signal)
  } catch (error) {
    // A failed assert must not arm the window: the next cadence tick retries.
    if (lastObserveAt()?.key === key) setLastObserveAt(undefined)
    throw error
  }
}

/**
 * Send a prompt. `parts` supports text plus attached images
 * (`{ type: 'image', mediaType, data, name? }`); the host promotes image bytes
 * to durable references.
 *
 * @param mode - `queue` (default) appends a turn; `steer` injects into the
 *   running turn so the model sees it at its next step.
 */
export async function prompt(
  sessionId: string,
  parts: PromptPart[],
  /**
   * 本次投递的幂等键。宿主按 `requestId` 去重（同 id 重复提交只入队一次），
   * 手机端此前**根本不带**这个字段，任何重复投递都会在排队条上变成两条一模一样的消息。
   * 重试要复用同一个 id 才有效；新的发送意图必须换新 id。
   */
  requestId: string = newRequestId(),
  mode: PromptMode = 'queue',
): Promise<QueueAck | undefined> {
  return await callUnary<QueueAck | undefined>('session.prompt', {
    sessionId,
    mode,
    content: parts,
    requestId,
  })
}

/** 一次投递意图的幂等键（碰撞概率可忽略；无需与宿主格式一致）。 */
export function newRequestId(): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (typeof cryptoObj?.randomUUID === 'function') return cryptoObj.randomUUID()
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function queueItemViewOf(item: {
  id: string
  placement: 'queued' | 'steering' | 'context'
  message?: { content?: unknown; source?: { kind?: unknown } }
  source?: { kind?: unknown }
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
  // 只带非 user 来源：user 是缺省（插入队列按 undefined 处理），省得每行都多一个字段。
  const sourceKind = [item.message?.source?.kind, item.source?.kind].find(kind => typeof kind === 'string' && kind !== '' && kind !== 'user') as string | undefined
  return { id: item.id, placement: item.placement, text, editable, ...(sourceKind === undefined ? {} : { sourceKind }) }
}

/**
 * 写操作的应答里带回来的**权威队列**（方案 A：读己之写，2026-11-10）。
 *
 * 宿主不发队列变更事件，投影会滞后；所以由插件在写操作返回前读一次活 agent 的
 * 内存 inbox，随应答下发。undefined = 老宿主，没带（此时退回旧判据）。
 */
export interface QueueAck {
  queue?: QueueItemView[]
  queueVersion?: number
}
/** Edit / remove / steer one pending queued message on the host. */
export async function updateQueue(sessionId: string, itemId: string, action: QueueAction): Promise<QueueAck | undefined> {
  return await callUnary<QueueAck | undefined>('session.updateQueue', { sessionId, itemId, action })
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

/**
 * Delete one session the way the desktop does: an archive-set write that
 * removes it from every roster forever (the phone filters the archive set in
 * its session.list already), while the session log stays on disk — the
 * desktop can still surface it (unarchive). Idempotent; unknown id errors.
 */
export async function archiveSession(sessionId: string): Promise<{ archivedSessionIds: string[] }> {
  const archived = await callUnary<{ archivedSessionIds: string[] }>('workspace.archiveSession', { sessionId })
  // 应答就是删完之后的归档集：直接当客户端已知的归档集用（抽屉里立刻挡掉这一行）。
  // 老宿主/异常应答可能不带这个字段：没有就跳过，别让一次删除把整个调用打崩。
  if (Array.isArray(archived.archivedSessionIds)) applyArchivedSessionIds(archived.archivedSessionIds)
  invalidateReadCoalescing()
  // 会话从工作区下消失，花名册里的 sessionIds 也变了。
  invalidateWorkspaceRoster()
  return archived
}

/**
 * Read the host-side grouping.
 *
 * Host-side on purpose: the desktop and every paired phone see the same
 * folders, and revoking a phone (which wipes its local storage) cannot destroy
 * the user's organisation. A host that predates the feature answers
 * `unavailable` — callers then simply hide the chips.
 */
export async function readSessionFolders(): Promise<SessionFoldersView> {
  return await callUnary<SessionFoldersView>('mobile.folders', { action: 'list' })
}

/** Create a folder; the host refuses duplicate/empty names. */
export async function createSessionFolder(name: string): Promise<SessionFoldersView & { created?: SessionFolderView }> {
  return await callUnary<SessionFoldersView & { created?: SessionFolderView }>('mobile.folders', { action: 'create', name })
}

/** Rename one folder. */
export async function renameSessionFolder(folderId: string, name: string): Promise<SessionFoldersView> {
  return await callUnary<SessionFoldersView>('mobile.folders', { action: 'rename', folderId, name })
}

/** Delete one folder (its sessions return to "no folder"). */
export async function removeSessionFolder(folderId: string): Promise<SessionFoldersView & { removed?: boolean }> {
  return await callUnary<SessionFoldersView & { removed?: boolean }>('mobile.folders', { action: 'remove', folderId })
}

/** File one session into a folder (null clears the assignment). */
export async function assignSessionFolder(sessionId: string, folderId: string | null): Promise<SessionFoldersView> {
  return await callUnary<SessionFoldersView>('mobile.folders', { action: 'assign', sessionId, folderId })
}
