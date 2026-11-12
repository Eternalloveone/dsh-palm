/**
 * 会话状态仓：一台手机对一个会话只留**一份**权威状态。
 *
 * 为什么要有它（2026-10-28 真机反馈的三条不稳定）：
 *  - 排队条点发送后半天不出来：队列只有 `inboxOf()` 轮询这一条来源，宿主不给手机推
 *    queue 帧，发出去的那一刻界面上什么都没有。
 *  - 插队后时有时无：宿主的旧快照会盖掉刚刚删掉的那条，因为它没有"版本"概念。
 *  - 进出会话内容刷新/缺失：首屏走 logTail、翻页走 readChat、实时走 mux 帧，三路各
 *    自合并；路由一换组件重挂，缓存随组件销毁，于是重新拉、重新合并、行会短暂消失。
 *
 * 这个模块定的三条规矩：
 *  1. **单调**：行按 `maxSeq`、队列按 `queueRevision`，低水位的一律丢弃（幂等，重复
 *     应用同一份快照不会改变状态）。
 *  2. **乐观项有主**：点发送/插队先本地改，写操作带 `baseRevision`；宿主回执带的
 *     `queueRevision` 比它新时，乐观项退场，界面直接切到权威值，不再来回跳。
 *  3. **常驻**：仓在页面生命周期内按会话 LRU 常驻，重进会话先拿缓存秒开，再对齐。
 *
 * 纯逻辑、无 DOM、无网络：网络那一层（`mobile.sessionState`）由调用方注入，便于单测。
 *
 * @module dsh-palm/mobile/session-store
 */

import type { ChatPage } from '../api.ts'
import {
  visibleQueue,
} from './session-status.ts'
import type { QueueItemView } from '../api.ts'
import {
  insertSourceOfKind,
  mergeInserts,
  normalizeInsertText,
  observeInsertPresence,
  visibleInserts,
  type InsertEntry,
  type InsertState,
  type InsertVisibility,
} from '../session/insert-queue.ts'

/** 一份权威快照（宿主 `mobile.sessionState` 的返回）。 */
export interface SessionSnapshot {
  sessionId: string
  /** 这一轮窗口里折叠好的行（与 logTail 同形）。 */
  rows: ChatPage['rows']
  /** 行的水位：更大的快照才允许覆盖。 */
  maxSeq: number
  /** 排队等下一轮的消息。 */
  queue: QueueItemView[]
  /** 队列版本：只有**手机端自己的写操作**会 +1，用来判"我那次写落地了吗"。 */
  queueRevision: number
  /**
   * 队列**内容指纹**（宿主按 id + 正文长度算）：任何客户端改了队列它都会变。
   *
   * 为什么要它：`queueRevision` 只由手机端自己的写操作递增，桌面端排一条消息时它不变，
   * 而下面按「版本没变 = 队列没变」处理 —— 桌面排的消息手机永远看不到（2026-10-30 真机
   * 复现：宿主 queue=1、手机 25 秒无排队条）。判定"权威队列变了没"必须用内容，而不是
   * 谁写的计数器。老宿主没有这个字段时退回 `queueRevision` 判据。
   */
  queueToken?: string
  /** 队列的单调版本（见 data/impl/session.ts 的同名字段；老宿主缺省）。 */
  queueVersion?: number
  /** 回合状态（与 `mobile.turnState` 同形）。 */
  turn: { running: boolean; turnStartAt?: number; lastEventAt?: number }
  /** 折叠时的宿主时间。 */
  asOf: number
}

/** 仓里一个会话的完整状态。 */
interface Entry {
  /** 权威快照（新宿主 `mobile.sessionState`）。 */
  snapshot?: SessionSnapshot
  /**
   * 老宿主（只有 `mobile.inbox` 投影）的队列。
   *
   * 单独存一份而不是塞进 `snapshot`：那份投影没有版本号，塞进去就会跟权威快照抢
   * 同一个水位 —— 权威快照回来时反而被它挡住。只有拿不到权威快照时才用它。
   */
  fallbackQueue?: QueueItemView[]
  /**
   * 已经被这一轮认领走（`turn/start`）的队列 id。
   *
   * 认领是**确定性事实**：宿主自己说它被取走了，而 id 是唯一的，所以记下来就永不重画。
   * 旧实现靠隐藏表 + 正文比对，两者都已删除（C1b，2026-11-11）。
   */
  claimed: Set<string>
  /** 已经应用到仓里的队列版本（版本栅栏：不大于它的快照/帧一律不改队列）。 */
  queueVersion?: number
  /**
   * 重订阅基线（`session/subscribed`）记下的队列版本。
   *
   * 新连接是新的起点：之前那份队列可能已经过期，桌面端同样会把镜像清空。
   * 记下当时的 `queueRevision`，在此之后直到宿主给出**更新的**队列
   * （`session/queue` 帧或更高 revision 的快照）视图都是空的。
   * 同 revision 的重放**不算**新数据 —— 否则一重放就画回来，等于没清。
   */
  queueRebaselineAt?: number
  /**
   * 「已插入本轮」的补充消息（**唯一写入点**）。
   *
   * 与排队队列分开存：排队项等下一轮，插入项已经进了这一轮（next-step）。
   * 合并规则在 `session/insert-queue.ts`：按 id 并集、missing 不删、只有回执才删。
   */
  inserts: InsertEntry[]
  /** 可见性元数据（最短可见起点 / 连续缺失次数 / 缺失起点）。 */
  insertShownAt: Map<string, number>
  insertMissingCount: Map<string, number>
  insertMissingSince: Map<string, number>
  /**
   * 已消费/已撤回的墓碑：宿主投影慢半拍时，陈旧快照不许把它们画回来
   * （否则就是「撤回后又自己出现」）。
   */
  insertRetired: Map<string, number>
  /** 当前轮号：由 turnStartAt 变化推进；同一轮内 agent/job 合并成一条摘要。 */
  insertTurnNo: number
  insertTurnStartAt?: number
  /** 最近一次读写时间，用于 LRU。 */
  touchedAt: number
}

/**
 * 读到空队列后先撑多久（毫秒）。
 *
 * 取 4 秒：宿主的投影刷新一般在一两次轮询内收敛；再长就会让「消息已经被这一轮认领」
 * 的排队条多挂好几秒。
 */

/** 仓里最多留几个会话（手机上同时翻的会话不会很多）。 */
export const SESSION_STORE_MAX = 8

const entries = new Map<string, Entry>()
const listeners = new Set<(sessionId: string) => void>()

function entryOf(sessionId: string): Entry {
  let entry = entries.get(sessionId)
  if (entry === undefined) {
    entry = {
      claimed: new Set(),
      inserts: [],
      insertShownAt: new Map(),
      insertMissingCount: new Map(),
      insertMissingSince: new Map(),
      insertRetired: new Map(),
      insertTurnNo: 0,
      touchedAt: Date.now(),
    }
    entries.set(sessionId, entry)
  }
  entry.touchedAt = Date.now()
  // LRU：超了就丢最久没碰的（它的 rows 只是缓存，丢了下次重新拉）。
  if (entries.size > SESSION_STORE_MAX) {
    const oldest = [...entries.entries()]
      .filter(([id]) => id !== sessionId)
      .sort((a, b) => a[1].touchedAt - b[1].touchedAt)[0]
    if (oldest !== undefined) entries.delete(oldest[0])
  }
  return entry
}

/**
 * 每个会话的**变更版本**：只增不减，随每次 `publish` 上涨。
 *
 * 用途只有一个：给视图一个**稳定的**订阅快照。`queueView()` 每次调用都新建数组、
 * 判据里还带 `Date.now()`（乐观项 TTL、空队列观察窗），直接塞进
 * `useSyncExternalStore` 的 getSnapshot 会无限重渲染；订阅版本号、版本变了才重算
 * 视图，事实仍然只在仓里。
 */
const versions = new Map<string, number>()

/** 当前会话仓的变更版本（没有变化时不涨，可安全用作快照）。 */
export function sessionStoreVersion(sessionId: string): number {
  return versions.get(sessionId) ?? 0
}

function publish(sessionId: string): void {
  versions.set(sessionId, (versions.get(sessionId) ?? 0) + 1)
  for (const listener of listeners) listener(sessionId)
}

/** 订阅任意会话的变化（视图按 sessionId 过滤）。 */
export function subscribeSessionStore(listener: (sessionId: string) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 缓存快照（不会触发网络）。重进会话时先拿它秒开。 */
export function cachedSnapshot(sessionId: string): SessionSnapshot | undefined {
  return entries.get(sessionId)?.snapshot
}

/** 缓存的行（没有快照时给空数组）。 */
export function cachedRows(sessionId: string): ChatPage['rows'] {
  return entries.get(sessionId)?.snapshot?.rows ?? []
}

/**
 * 队列的当前视图：**就是仓里那份权威队列**（按 id 去重）。
 *
 * C1b（2026-11-11）之后这里没有任何猜测：
 *  · 不再有乐观项（发送应答直接带回权威队列）；
 *  · 不再有隐藏表（删除/插队的应答同样带回来）；
 *  · 不再有空队列观察窗（空就是空，版本栅栏挡住陈旧投影）；
 *  · 不再按正文比对（身份走 `requestId` / 队列 id）。
 */
export function queueView(sessionId: string): QueueItemView[] {
  const entry = entries.get(sessionId)
  if (entry === undefined) return []
  // 重订阅基线生效中：宿主还没给出比基线更新的队列，界面就是空的
  // （新的连接是新的起点，旧队列可能早就不成立）。
  if (entry.queueRebaselineAt !== undefined && (entry.snapshot?.queueRevision ?? -1) <= entry.queueRebaselineAt) return []
  const snapshot = entry.snapshot
  const authoritative = snapshot !== undefined ? snapshot.queue : entry.fallbackQueue ?? []
  return [...visibleQueue({ host: authoritative.filter(item => !entry.claimed.has(item.id)) })]
}

/* ────────────────────── 插入队列（本轮补充消息） ────────────────────── */

const LOCAL_INSERT_PREFIX = 'local-insert-'
/** 墓碑寿命：宿主投影可能慢半拍到分钟级，够挡住陈旧快照就行。 */
const INSERT_RETIRED_TTL_MS = 10 * 60_000

function insertVisibilityOf(entry: Entry): InsertVisibility {
  return {
    shownAt: Object.fromEntries(entry.insertShownAt),
    missingCount: Object.fromEntries(entry.insertMissingCount),
    missingSince: Object.fromEntries(entry.insertMissingSince),
  }
}

function pruneInsertMeta(entry: Entry, keep: ReadonlySet<string>): void {
  for (const map of [entry.insertShownAt, entry.insertMissingCount, entry.insertMissingSince]) {
    for (const id of [...map.keys()]) if (!keep.has(id)) map.delete(id)
  }
}

/**
 * turnStartAt 变了就是**新一轮**：旧轮条目整体退场。
 *
 * 这不是「快照里没看到」——那是 missing，必须保留；轮次边界是明确的作用域切换，
 * 旧轮插的话不属于「已插入本轮」。
 */
function advanceInsertTurn(entry: Entry, startAt: number | undefined): void {
  if (startAt === undefined) return
  // 只认更晚的起点：陈旧快照/乱序 turn/start 的 turnStartAt 可能更早，
  // 若当成「新一轮」就会把当前轮的插入项整体清掉（条子又闪一次）。
  if (entry.insertTurnStartAt !== undefined && startAt <= entry.insertTurnStartAt) return
  entry.insertTurnStartAt = startAt
  entry.insertTurnNo += 1
  entry.inserts = entry.inserts.filter(item => item.turnNo >= entry.insertTurnNo)
}

/** steering 行 → 插入条目；看不见的注入（runtime-context 等）不占摘要。 */
function insertCandidatesOf(items: readonly QueueItemView[], turnNo: number, now: number): InsertEntry[] {
  const candidates: InsertEntry[] = []
  for (const item of items) {
    if (item.placement !== 'steering') continue
    const source = insertSourceOfKind(item.sourceKind)
    if (source === undefined) continue
    candidates.push({ id: item.id, turnNo, source, text: item.text, at: now })
  }
  return candidates
}

/**
 * 一次宿主快照的落地：并集 + 回执删除 + 可见性观察。
 *
 * 本地乐观项（没有宿主 id）在宿主出现同文同来源的 steering 行时视为已落地：
 * 把本地 id 当作 consumed 回执传进去，避免同一句话占两行。
 */
function applyInsertObservation(entry: Entry, candidates: readonly InsertEntry[], now: number): void {
  const localMatched = entry.inserts
    .filter(item => item.id.startsWith(LOCAL_INSERT_PREFIX)
      && candidates.some(candidate => candidate.turnNo === entry.insertTurnNo
        && candidate.source === 'user'
        && normalizeInsertText(candidate.text) === normalizeInsertText(item.text)))
    .map(item => item.id)
  entry.inserts = mergeInserts(entry.inserts, candidates, {
    consumedIds: localMatched,
    withdrawnIds: entry.insertRetired.keys(),
  })
  const present = new Set<string>(candidates.map(item => item.id))
  for (const item of entry.inserts) if (item.id.startsWith(LOCAL_INSERT_PREFIX)) present.add(item.id)
  const visibility = observeInsertPresence(insertVisibilityOf(entry), entry.inserts, present, now)
  entry.insertShownAt = new Map(Object.entries(visibility.shownAt))
  entry.insertMissingCount = new Map(Object.entries(visibility.missingCount))
  entry.insertMissingSince = new Map(Object.entries(visibility.missingSince))
  pruneInsertMeta(entry, new Set(entry.inserts.map(item => item.id)))
  for (const [id, at] of entry.insertRetired) {
    if (now - at > INSERT_RETIRED_TTL_MS) entry.insertRetired.delete(id)
  }
}

/** 渲染层唯一读口：这一拍该显示哪些插入条目（去抖/最短可见已应用）。 */
export function insertView(sessionId: string, now: number = Date.now()): InsertEntry[] {
  const entry = entries.get(sessionId)
  if (entry === undefined || entry.inserts.length === 0) return []
  const state: InsertState = {
    entries: entry.inserts,
    turnNo: entry.insertTurnNo,
    ...insertVisibilityOf(entry),
  }
  return [...visibleInserts(state, now)]
}

/** 本地乐观插入（steer 点下去马上可见，不等宿主快照）。 */
export function addOptimisticInsert(sessionId: string, text: string): string {
  const entry = entryOf(sessionId)
  const now = Date.now()
  const id = `${LOCAL_INSERT_PREFIX}${now}-${Math.random().toString(36).slice(2, 8)}`
  entry.inserts = mergeInserts(entry.inserts, [{ id, turnNo: entry.insertTurnNo, source: 'user', text, at: now }])
  entry.insertShownAt.set(id, now)
  entry.insertMissingCount.set(id, 0)
  publish(sessionId)
  return id
}

/** 本地乐观插入失败：从事实源里摘掉（用户撤回走 `withdrawInsert`）。 */
export function dropOptimisticInsert(sessionId: string, id: string): void {
  const entry = entries.get(sessionId)
  if (entry === undefined || !entry.inserts.some(item => item.id === id)) return
  entry.inserts = entry.inserts.filter(item => item.id !== id)
  pruneInsertMeta(entry, new Set(entry.inserts.map(item => item.id)))
  publish(sessionId)
}

function retireInsert(entry: Entry, id: string, now: number): boolean {
  // 墓碑先记，哪怕这一拍还没看到条目：回执可能先于快照到达，晚到的陈旧快照
  // 不许再把已经消费/撤回的 id 画回来。
  entry.insertRetired.set(id, now)
  if (!entry.inserts.some(item => item.id === id)) return false
  entry.inserts = entry.inserts.filter(item => item.id !== id)
  pruneInsertMeta(entry, new Set(entry.inserts.map(item => item.id)))
  return true
}

/** 撤回回执：宿主 remove 成功（或本地决定不发）→ 墓碑 + 立即退场。 */
export function withdrawInsert(sessionId: string, id: string): void {
  const entry = entries.get(sessionId)
  if (entry === undefined) return
  if (retireInsert(entry, id, Date.now())) publish(sessionId)
}

/** 撤回失败（请求没送到宿主）：撤掉墓碑，下一次快照会把它画回来。 */
export function restoreInsert(sessionId: string, id: string): void {
  const entry = entries.get(sessionId)
  if (entry === undefined) return
  if (entry.insertRetired.delete(id)) publish(sessionId)
}

/** WS `user/message` 帧：按 id 认领；本地乐观项没有宿主 id，再按正文补一刀。 */
export function consumeInsertMessage(sessionId: string, event: { data?: unknown }): void {
  const entry = entries.get(sessionId)
  if (entry === undefined) return
  const data = typeof event.data === 'object' && event.data !== null ? event.data as Record<string, unknown> : {}
  const now = Date.now()
  let changed = false
  const id = typeof data['id'] === 'string' ? data['id'] : undefined
  if (id !== undefined) changed = retireInsert(entry, id, now) || changed
  const source = typeof data['source'] === 'object' && data['source'] !== null
    ? data['source'] as Record<string, unknown>
    : {}
  const sourceKind = typeof source['kind'] === 'string' ? source['kind'] : undefined
  if (sourceKind === undefined || sourceKind === 'user') {
    const text = insertTextOfContent(data['content'])
    if (text !== '') {
      // 宿主可能给落地的消息换一个新 id：正文是用户插话的稳定指纹，按它补一刀。
      const matched = entry.inserts.find(item => item.source === 'user'
        && normalizeInsertText(item.text) === text)
      if (matched !== undefined) changed = retireInsert(entry, matched.id, now) || changed
    }
  }
  if (changed) publish(sessionId)
}

/** turn/start 帧：推进轮号（旧轮插入项随作用域退场）。 */
export function noteInsertTurnStart(sessionId: string, startAt: number | undefined): void {
  const entry = entryOf(sessionId)
  const before = entry.insertTurnNo
  advanceInsertTurn(entry, startAt)
  if (entry.insertTurnNo === before) return
  pruneInsertMeta(entry, new Set(entry.inserts.map(item => item.id)))
  publish(sessionId)
}

function insertTextOfContent(content: unknown): string {
  if (typeof content === 'string') return normalizeInsertText(content)
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const part = block as { type?: unknown; text?: unknown }
    if (part.type === 'text' && typeof part.text === 'string') parts.push(part.text)
  }
  return normalizeInsertText(parts.join(' '))
}

/**
 * 当前会话的队列读数**可不可信**。
 *
 * `queueView()` 在几种情况下会返回空，但那个空**不是证据**：
 *  · 重订阅基线生效中（刚从断线恢复，宿主还没给出更新的队列）；
 *  · 这个会话还没有任何快照。
 *
 * 「排队消息对账」必须先用它判一次 —— 否则一次重连就会把还躺在宿主队列里的消息
 * 判成丢失，塞回输入框（2026-11-10 真机：「排队了却突然回撤到输入框」）。
 *
 * @param sessionId - 会话 id
 * @returns 队列读数是否可信
 */
export function queueAuthoritative(sessionId: string): boolean {
  const entry = entries.get(sessionId)
  // 还没有这个会话：没有任何「旧读数」可陈旧，不能因此拦下回填 —— 冷启动首帧
  // 正是「宿主重启把排队吞了、要把原文还给用户」的场景。
  if (entry === undefined) return true
  if (entry.queueRebaselineAt === undefined) return true
  return (entry.snapshot?.queueRevision ?? -1) > entry.queueRebaselineAt
}

/**
 * 重订阅基线：把当前看到的队列清掉，直到宿主给出更新的队列（见 `Entry.queueRebaselineAt`）。
 *
 * 调用点是 `session/subscribed` 帧（新一条连接的起点）。手机上原来清的是组件里
 * 的镜像数组；队列改成仓的只读投影之后，这个"清空"只能由仓来表达。
 */
export function rebaselineQueueView(sessionId: string): void {
  const entry = entryOf(sessionId)
  entry.queueRebaselineAt = entry.snapshot?.queueRevision ?? -1
  // 版本基准同样作废：宿主进程重启后计数器从 0 开始，旧基准会让客户端
  // 永远拒绝新快照（队列冻结）。新连接的下一份快照就是新基准。
  entry.queueVersion = undefined
  publish(sessionId)
}

/**
 * 写操作被宿主**接受**、但应答没带队列（老宿主）时，按动作收敛本地那一条。
 *
 * 这不是猜测：RPC 已经 resolve，宿主就是收下了这次改动，队列里那一条的去留是确定的。
 * 其余条目保持不变，等下一次快照/投影对齐（`refreshInbox` 由调用方触发）。
 *
 * @param kind - `remove`/`steer` 表示这一条离开队列；`edit` 表示只换正文
 * @returns 是否改动了队列
 */
export function applyQueueMutation(
  sessionId: string,
  itemId: string,
  kind: 'remove' | 'steer' | 'edit',
  text?: string,
): boolean {
  const entry = entries.get(sessionId)
  if (entry === undefined) return false
  const next = (items: QueueItemView[]): QueueItemView[] => kind === 'edit'
    ? items.map(item => (item.id === itemId && text !== undefined ? { ...item, text } : item))
    : items.filter(item => item.id !== itemId)
  let changed = false
  if (entry.snapshot !== undefined) {
    const queue = next(entry.snapshot.queue)
    if (queue.length !== entry.snapshot.queue.length || kind === 'edit') {
      entry.snapshot = { ...entry.snapshot, queue }
      changed = true
    }
  }
  if (entry.fallbackQueue !== undefined) {
    const queue = next(entry.fallbackQueue)
    if (queue.length !== entry.fallbackQueue.length || kind === 'edit') {
      entry.fallbackQueue = queue
      changed = true
    }
  }
  // 删掉/插队的这一条宿主已经收下了：之后任何陈旧投影都不许把它画回来。
  if (kind !== 'edit') entry.claimed.add(itemId)
  if (changed) publish(sessionId)
  return changed
}

/**
 * 应用写操作应答里的**权威队列**（方案 A：读己之写，2026-11-10）。
 *
 * 写操作的 RPC 返回前，插件读了一次活 agent 的内存 inbox 并随应答带回来。
 * 客户端拿到就当定论：不用乐观项、不用 TTL、不用正文比对。
 *
 * @param ack - { queue, queueVersion }；老宿主不带这两个字段时返回 false（保持旧路径）
 * @returns 是否应用了权威队列
 */
export function applyQueueAck(
  sessionId: string,
  ack: { queue?: unknown; queueVersion?: unknown } | undefined,
): boolean {
  if (ack === undefined || !Array.isArray(ack.queue) || typeof ack.queueVersion !== 'number') return false
  const items = ack.queue as QueueItemView[]
  // 版本栅栏拒绝（**严格更旧**的 ack）时不许覆盖快照：否则"先删 v7、后到编辑 v6"
  // 会把已删项写回，并毒化 queueVersion（2026-11-11 审计 P1）。
  //
  // 同版本要收（2026-11-11 真机「点完发送排队条不出现」）：宿主的版本只在**内容变化**
  // 时推进（见 host/queue-inbox 的 queueVersionForRead），所以"版本相同 + 内容不同"
  // 说明客户端手上的那个号来自事件帧，而 ack 是刚现读的活队列 —— 它更权威。
  if (!applyQueueItems(sessionId, items, ack.queueVersion, true)) return false
  // `queueView()` 在**有快照**时优先读 `snapshot.queue`（历史页带来那一份），
  // 只写 `fallbackQueue` 会被它挡掉：真机上表现为"写入成功、界面不动"。
  // 权威应答比手里的任何快照都新，所以这里同时覆盖快照里的队列。
  const entry = entries.get(sessionId)
  if (entry?.snapshot !== undefined) {
    entry.snapshot = { ...entry.snapshot, queue: items }
    publish(sessionId)
  }
  return true
}
export function applyQueueItems(
  sessionId: string,
  items: QueueItemView[],
  queueVersion?: number,
  /**
   * 允许「同版本」覆盖（只有**写操作应答**这么用：它是刚现读的活队列）。
   * 投影/轮询快照永远走严格大于，否则隧道降级时陈旧 inbox 会把已删项写回来。
   */
  allowEqual = false,
): boolean {
  const entry = entryOf(sessionId)
  // 没有版本号的投影（轮询补发的 inbox）只在"还没见过权威版本"时可用；
  // 一旦有版本，它就必须让位给 ack / mobile.sessionState —— 否则隧道降级时
  // 每 1.5–3s 就会用一份陈旧 inbox 把已删除的队列项写回来（2026-11-11 P1）。
  if (queueVersion === undefined && entry.queueVersion !== undefined) return false
  // 版本栅栏：比已应用值旧（或同版本）的帧不许改队列 —— 陈旧投影就是这样被挡住的。
  if (queueVersion !== undefined) {
    if (entry.queueVersion !== undefined && (allowEqual ? queueVersion < entry.queueVersion : queueVersion <= entry.queueVersion)) return false
    entry.queueVersion = queueVersion
  }
  entry.fallbackQueue = items
  // 这一帧就是宿主的**新**队列：重订阅基线到此为止。
  entry.queueRebaselineAt = undefined
  // 这条回退路径也可能带着 steering 行（老宿主的 inbox 投影）：插入队列照样要观察。
  const now = Date.now()
  applyInsertObservation(entry, insertCandidatesOf(items, entry.insertTurnNo, now), now)
  publish(sessionId)
  return true
}
/**
 * `turn/start` 到了：宿主按 FIFO 认领队首那一条。
 *
 * 以前视图这边直接 `setQueueItems([])` 清空本地状态，而状态仓里那份快照还留着整队 ——
 * 于是下一次快照（可能是几分钟前的投影）把被认领的那条又画回来：
 * 排队条「闪一下消失、再闪一下出现」（真机反馈的
「不稳定」）。
 * 正确做法是让队首也**从仓里**移走，其余不动，然后靠新鲜快照收敛。
 */
export function claimQueueHead(sessionId: string): void {
  const entry = entries.get(sessionId)
  if (entry === undefined) return
  let changed = false
  const snapshot = entry.snapshot
  if (snapshot !== undefined && snapshot.queue.length > 0) {
    // 队首已经被宿主认领进这一轮：从权威队列里移走，并记下 id 永不再画。
    const claimedId = snapshot.queue[0]?.id
    if (claimedId !== undefined) entry.claimed.add(claimedId)
    entry.snapshot = { ...snapshot, queue: snapshot.queue.slice(1) }
    changed = true
  } else if (entry.fallbackQueue !== undefined && entry.fallbackQueue.length > 0) {
    const claimedId = entry.fallbackQueue[0]?.id
    if (claimedId !== undefined) entry.claimed.add(claimedId)
    entry.fallbackQueue = entry.fallbackQueue.slice(1)
    changed = true
  }
  if (changed) publish(sessionId)
}

/**
 * 应用一份宿主快照（单调规则见模块头）。
 * @returns 是否真的改变了状态（调用方可以据此避免无谓渲染）。
 */
export function applySnapshot(snapshot: SessionSnapshot): boolean {
  const entry = entryOf(snapshot.sessionId)
  const current = entry.snapshot
  const previousQueue = current?.queue ?? entry.fallbackQueue ?? []
  const currentQueueLength = previousQueue.length
  let changed = false
  if (current === undefined) {
    entry.snapshot = snapshot
    if (snapshot.queueVersion !== undefined) entry.queueVersion = snapshot.queueVersion
    changed = true
  } else {
    // 行按水位、队列按版本各自单调：允许"行更新但队列更旧"这种部分更新。
    const rowsNewer = snapshot.maxSeq > current.maxSeq
    // 队列"变了没"看内容指纹优先：桌面端入队不会动 queueRevision，只认计数器就会把
    // 权威队列挡在门外（真机：宿主 queue=1，手机一直没有排队条）。
    const queueTokenChanged = snapshot.queueToken !== undefined && snapshot.queueToken !== current.queueToken
    // **版本栅栏**（2026-11-10 架构修法）：宿主给了单调版本时，只认「比已应用值更新」的快照。
    // 同版本 = 队列自上次事件后没变过，哪怕投影内容不一样（陈旧投影）也不许改队列。
    const versioned = snapshot.queueVersion !== undefined
    const versionNewer = versioned && (entry.queueVersion === undefined || snapshot.queueVersion! > entry.queueVersion)
    const queueNewer = versioned
      ? versionNewer
      : (snapshot.queueRevision > current.queueRevision || queueTokenChanged)
    const turnChanged = current.turn.running !== snapshot.turn.running
      || current.turn.turnStartAt !== snapshot.turn.turnStartAt
    if (rowsNewer || queueNewer || turnChanged) {
      // 更新的一版队列到了：重订阅基线自动失效。
      if (queueNewer) entry.queueRebaselineAt = undefined
      entry.snapshot = {
        sessionId: snapshot.sessionId,
        rows: rowsNewer ? snapshot.rows : current.rows,
        maxSeq: rowsNewer ? snapshot.maxSeq : current.maxSeq,
        queue: queueNewer ? snapshot.queue : current.queue,
        queueRevision: queueNewer ? snapshot.queueRevision : current.queueRevision,
        ...(queueNewer && snapshot.queueVersion !== undefined ? { queueVersion: snapshot.queueVersion } : {}),
        ...(queueNewer && snapshot.queueToken !== undefined
          ? { queueToken: snapshot.queueToken }
          : (current.queueToken === undefined ? {} : { queueToken: current.queueToken })),
        turn: turnChanged || rowsNewer ? snapshot.turn : current.turn,
        asOf: snapshot.asOf,
      }
      changed = true
    }
    if (versionNewer && snapshot.queueVersion !== undefined) entry.queueVersion = snapshot.queueVersion
  }
  // 插入队列跟着同一份原子快照落地：turnStartAt 推进轮号，steering 行按并集合并。
  const insertIds = entry.inserts.map(item => item.id).join('\u0000')
  advanceInsertTurn(entry, snapshot.turn.turnStartAt)
  const nowMs = Date.now()
  applyInsertObservation(entry, insertCandidatesOf(entry.snapshot?.queue ?? [], entry.insertTurnNo, nowMs), nowMs)
  if (entry.inserts.map(item => item.id).join('\u0000') !== insertIds) changed = true
  if (changed) publish(snapshot.sessionId)
  return changed
}

/** 文本归一：空白折叠，避免"多一个空格"就认不出是同一条。 */
export function normalizeQueueText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** 只给测试用：清空仓。 */
export function resetSessionStoreForTest(): void {
  entries.clear()
  versions.clear()
}
