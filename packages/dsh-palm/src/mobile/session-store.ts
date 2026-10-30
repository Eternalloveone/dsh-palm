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

import type { ChatPage } from './api.ts'
import {
  QUEUE_EMPTY_HOLD_MS as QUEUE_EMPTY_HOLD_MS_FROM_STATUS,
  QUEUE_HIDDEN_MS,
  QUEUE_OPTIMISTIC_MS,
  visibleQueue,
} from './session-status.ts'
import type { QueueItemView } from './api.ts'

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
  /** 回合状态（与 `mobile.turnState` 同形）。 */
  turn: { running: boolean; turnStartAt?: number; lastEventAt?: number }
  /** 折叠时的宿主时间。 */
  asOf: number
}

/** 本地乐观项：写操作发出后、宿主快照回来之前先画在界面上。 */
export interface OptimisticQueueItem {
  /** 本地 id（不会与宿主 id 冲突：前缀 `local-`）。 */
  pendingId: string
  text: string
  /** 写操作发生在这个队列版本之上；更新的快照一到就该退场。 */
  baseRevision: number
  placement: 'queued' | 'steering'
  at: number
  /** 提交那一刻宿主队列里已有的条目 id（用于「多出新条目」退场判据）。 */
  knownHostIds?: readonly string[]
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
  optimistic: OptimisticQueueItem[]
  /** 本地已经删掉/插队掉的队列项：id → 它被隐藏时的队列版本。 */
  hidden: Map<string, number>
  /** 同上：id → 隐藏时刻（TTL 兜底，避免宿主永不收敛时永久屏蔽）。 */
  hiddenAt: Map<string, number>
  /**
   * 最近一次非空队列，以及「读到空队列」的观察窗截止时刻。
   *
   * 真机：切到后台再回来，排队条没了，重进会话才又出现。宿主投影偶尔会先回一个
   * 空队列（刷新中的瞬时态），一次就把界面清空；之后版本号没再涨，界面就一直是空的。
   * 所以读到空时先留一会儿：窗口内还按上一次的非空队列显示，窗口过了才真的清空。
   */
  emptyHold?: { items: QueueItemView[]; until: number }
  /** 最近一次读写时间，用于 LRU。 */
  touchedAt: number
}

/**
 * 读到空队列后先撑多久（毫秒）。
 *
 * 取 4 秒：宿主的投影刷新一般在一两次轮询内收敛；再长就会让「消息已经被这一轮认领」
 * 的排队条多挂好几秒。
 */
export const QUEUE_EMPTY_HOLD_MS = QUEUE_EMPTY_HOLD_MS_FROM_STATUS

/** 仓里最多留几个会话（手机上同时翻的会话不会很多）。 */
export const SESSION_STORE_MAX = 8

const entries = new Map<string, Entry>()
const listeners = new Set<(sessionId: string) => void>()

function entryOf(sessionId: string): Entry {
  let entry = entries.get(sessionId)
  if (entry === undefined) {
    entry = { optimistic: [], hidden: new Map(), hiddenAt: new Map(), touchedAt: Date.now() }
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

function publish(sessionId: string): void {
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
 * 乐观项存活上限：超过这个时间还没被权威队列认下来，就当它已经投递出去了
 * （宿主认领成下一轮时它就不再是「排队」），免得留一张永远不走的卡。
 */
export const OPTIMISTIC_TTL_MS = QUEUE_OPTIMISTIC_MS

/**
 * 队列的当前视图：权威队列 + 还没退场的乐观项。
 *
 * 乐观项**只**在两种情况下退场：①权威队列里出现了同一条文本（宿主已经排进去了，
 * 真行接上）；②超过 `OPTIMISTIC_TTL_MS`。

 * 曾经还按「队列版本变了就退场」来判断 —— 那是错的：宿主读到的是几分钟前的投影
 * 快照，版本先涨、条目后到，中间这段时间界面上什么都没有（真机：点发送后排队条
 * 还是空的）。
 */
export function queueView(sessionId: string): QueueItemView[] {
  const entry = entries.get(sessionId)
  if (entry === undefined) return []
  const snapshot = entry.snapshot
  const authoritative = snapshot !== undefined ? snapshot.queue : entry.fallbackQueue ?? []
  // 判据只有一份：在 `session-status.ts` 的 `visibleQueue` 里（隐藏 TTL、乐观 TTL、
  // 空队列观察窗、正文归一化）。这里只负责把存储层的字段凑成它的输入 ——
  // 于是「界面上该显示哪几条排队」不会再有两套实现各自漂移。
  return [...visibleQueue({
    host: authoritative,
    optimistic: entry.optimistic,
    hiddenIds: new Set(entry.hidden.keys()),
    hiddenAt: entry.hiddenAt,
    spokenTexts: userTextsOf(entry),
    // 新宿主（带 queueToken）的队列是活的，不需要「已进对话」兜底；只有老宿主才用。
    ...(entry.snapshot?.queueToken === undefined && lastUserTextOf(entry) !== undefined
      ? { lastUserText: lastUserTextOf(entry), legacyQueue: true }
      : {}),
    normalize: normalizeQueueText,
    ...(entry.emptyHold === undefined ? {} : { emptyHold: entry.emptyHold }),
  }, Date.now())]
}

/**
 * 本地先隐藏一条真实队列项（删除/插队立刻生效，不等宿主快照）。
 *
 * 隐藏带上当时的队列版本：宿主把这次写处理完、版本跟上之后，`applySnapshot` 会把它
 * 从隐藏表里清掉 —— 于是"宿主的权威队列"重新说了算，不会出现本地永久屏蔽。
 */
export function hideQueueItem(sessionId: string, itemId: string): void {
  const entry = entryOf(sessionId)
  entry.hidden.set(itemId, entry.snapshot?.queueRevision ?? -1)
  entry.hiddenAt.set(itemId, Date.now())
  publish(sessionId)
}

/** 写操作被拒（比如回合已经结束、steer 不被接受）时把隐藏撤掉。 */
export function unhideQueueItem(sessionId: string, itemId: string): void {
  const entry = entries.get(sessionId)
  if (entry === undefined) return
  const removed = entry.hidden.delete(itemId)
  entry.hiddenAt.delete(itemId)
  if (!removed) return
  publish(sessionId)
}

/**
 * 只更新队列（老宿主的 `mobile.inbox` 回退路径用）。
 *
 * 没有原子快照时，队列仍然要进仓：否则本地一隐藏某一条（删除/插队），订阅者按仓里
 * 的空快照重算，整条排队条会瞬间清空、再被下一次轮询填回来 —— 正是"闪一下"的来源。
 */
export function applyQueueItems(sessionId: string, items: QueueItemView[]): void {
  const entry = entryOf(sessionId)
  entry.fallbackQueue = items
  // 隐藏表**不整表清空**：快照可能早于「本地认领那一刻」（弱网/帧乱序），
  // 一清就会把已经进回合的那条画回来 —— 真机：「发送完，排队条还残留」。
  // 只丢过期的，剩下的按 HIDDEN_TTL_MS 自然退场。
  const now = Date.now()
  for (const [id, at] of entry.hiddenAt) {
    if (now - at > HIDDEN_TTL_MS) {
      entry.hiddenAt.delete(id)
      entry.hidden.delete(id)
    }
  }
  publish(sessionId)
}

/** 隐藏表的兜底寿命：宿主迟迟不收敛时别永久屏蔽这一条。 */
export const HIDDEN_TTL_MS = QUEUE_HIDDEN_MS

/** 对话里最新一条用户消息的正文（归一化）；没有就是 undefined。 */
function lastUserTextOf(entry: Entry): string | undefined {
  const rows = entry.snapshot?.rows ?? []
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i]
    if (row?.kind !== 'user') continue
    const text = normalizeQueueText(row.text ?? '')
    if (text !== '') return text
  }
  return undefined
}

/** 最近这些行里用户自己说的话（归一化后的文本集合）。 */
function userTextsOf(entry: Entry): Set<string> {
  const rows = entry.snapshot?.rows ?? []
  const texts = new Set<string>()
  for (const row of rows) {
    if (row.kind !== 'user') continue
    if (typeof row.text !== 'string' || row.text === '') continue
    texts.add(normalizeQueueText(row.text))
  }
  return texts
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
    const [first, ...rest] = snapshot.queue
    entry.snapshot = { ...snapshot, queue: rest }
    if (first !== undefined) {
      // 已经进了这一轮：标记为「本地已认领」，陈旧快照不许把它画回来。
      // （以前这里是把 hidden 删掉，等于把唯一的证据扔了。）
      entry.hidden.set(first.id, entry.snapshot?.queueRevision ?? -1)
      entry.hiddenAt.set(first.id, Date.now())
    }
    changed = true
  } else if (entry.fallbackQueue !== undefined && entry.fallbackQueue.length > 0) {
    const [first] = entry.fallbackQueue
    entry.fallbackQueue = entry.fallbackQueue.slice(1)
    // 只有 inbox 投影时也一样要记「已认领」：否则下一份陈旧投影会把它画回来。
    if (first !== undefined) {
      entry.hidden.set(first.id, entry.snapshot?.queueRevision ?? -1)
      entry.hiddenAt.set(first.id, Date.now())
    }
    changed = true
  }
  // 乐观项同样按 FIFO 认领：队首那条进这一轮，后面的还排着。
  if (entry.optimistic.length > 0) {
    entry.optimistic = entry.optimistic.slice(1)
    changed = true
  }
  if (changed) publish(sessionId)
}

/** 写操作发出时记一条乐观项（立刻可见）；返回它的 pendingId。 */export function addOptimisticQueueItem(
  sessionId: string,
  item: { text: string; placement: 'queued' | 'steering' },
): string {
  const entry = entryOf(sessionId)
  const pendingId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  // 同一条正文只留一份乐观项：弱网下「排队」被点两次会塞进两条只差本地 id 的记录，
  // 屏幕上就是「莫名其妙多出来一个一模一样的排队条」。后到的那份替换前一份（时间更新，
  // TTL 也从它算），pendingId 换成新的，调用方拿到的 id 才是屏幕上那一条。
  const key = normalizeQueueText(item.text)
  const kept = entry.optimistic.filter(existing => normalizeQueueText(existing.text) !== key)
  // 记下提交那一刻宿主队列里已有的条目：之后只要多出新 id，就说明这次投递落地了
  // （正文可能被宿主改写 —— 图片/引用/折行 —— 只靠正文比对会永远对不上）。
  const knownHostIds = (entry.snapshot?.queue ?? entry.fallbackQueue ?? []).map(existing => existing.id)
  entry.optimistic = [...kept, {
    pendingId,
    text: item.text,
    baseRevision: entry.snapshot?.queueRevision ?? -1,
    placement: item.placement,
    at: Date.now(),
    knownHostIds,
  }]
  publish(sessionId)
  return pendingId
}

/** 写操作失败/被拒时把乐观项撤掉（不留假条目）。 */
export function dropOptimisticQueueItem(sessionId: string, pendingId: string): void {
  const entry = entries.get(sessionId)
  if (entry === undefined) return
  const next = entry.optimistic.filter(item => item.pendingId !== pendingId)
  if (next.length === entry.optimistic.length) return
  entry.optimistic = next
  publish(sessionId)
}

/** 写操作成功后立刻让乐观项退场（宿主已认账，不必等快照）。 */
export function settleOptimisticQueueItem(sessionId: string, pendingId: string): void {
  dropOptimisticQueueItem(sessionId, pendingId)
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
    changed = true
  } else {
    // 行按水位、队列按版本各自单调：允许"行更新但队列更旧"这种部分更新。
    const rowsNewer = snapshot.maxSeq > current.maxSeq
    // 队列"变了没"看内容指纹优先：桌面端入队不会动 queueRevision，只认计数器就会把
    // 权威队列挡在门外（真机：宿主 queue=1，手机一直没有排队条）。
    const queueTokenChanged = snapshot.queueToken !== undefined && snapshot.queueToken !== current.queueToken
    const queueNewer = snapshot.queueRevision > current.queueRevision || queueTokenChanged
    const turnChanged = current.turn.running !== snapshot.turn.running
      || current.turn.turnStartAt !== snapshot.turn.turnStartAt
    if (rowsNewer || queueNewer || turnChanged) {
      entry.snapshot = {
        sessionId: snapshot.sessionId,
        rows: rowsNewer ? snapshot.rows : current.rows,
        maxSeq: rowsNewer ? snapshot.maxSeq : current.maxSeq,
        queue: queueNewer ? snapshot.queue : current.queue,
        queueRevision: queueNewer ? snapshot.queueRevision : current.queueRevision,
        ...(queueNewer && snapshot.queueToken !== undefined
          ? { queueToken: snapshot.queueToken }
          : (current.queueToken === undefined ? {} : { queueToken: current.queueToken })),
        turn: turnChanged || rowsNewer ? snapshot.turn : current.turn,
        asOf: snapshot.asOf,
      }
      changed = true
    }
  }
  // 空队列观察窗：这次读到空、上次非空 → 先留一会儿再清（见 Entry.emptyHold）。
  const applied = entry.snapshot?.queue ?? []
  if (applied.length > 0) {
    entry.emptyHold = undefined
  } else if (currentQueueLength > 0) {
    // 但如果「空」正好是本地刚删掉的（那一条已经进了隐藏表），就别留 —— 用户点了删除，
    // 界面必须立刻空掉，不能靠观察窗拖 4 秒。
    const visiblePrevious = previousQueue.filter(item => !entry.hidden.has(item.id))
    if (visiblePrevious.length > 0) {
      entry.emptyHold = { items: visiblePrevious, until: Date.now() + QUEUE_EMPTY_HOLD_MS }
    }
  }
  // 隐藏表（本地删除/插队过的条目）：只在「权威队列真的没有这一条」时清掉，
  // 或者等到 HIDDEN_TTL_MS 兜底。
  //
  // 曾经是「版本一变就清」—— 那是错的：宿主队列读的是投影快照，版本先涨、
  // 快照里那条还在，清掉之后它立刻又被画回来（真机：删了又回来）。
  const queueNow = entry.snapshot?.queue ?? entry.fallbackQueue ?? []
  const present = new Set(queueNow.map(item => item.id))
  const nowMs = Date.now()
  for (const [id] of entry.hidden) {
    const stale = nowMs - (entry.hiddenAt.get(id) ?? 0) > HIDDEN_TTL_MS
    if (!present.has(id) || stale) {
      entry.hidden.delete(id)
      entry.hiddenAt.delete(id)
    }
  }
  if (changed) publish(snapshot.sessionId)
  return changed
}

/** 队列项 → 视图（乐观项 id 带 `local-` 前缀，界面据它判断"还没被宿主认账"）。 */
function toQueueItem(item: OptimisticQueueItem): QueueItemView {
  return {
    id: item.pendingId,
    placement: item.placement,
    text: item.text,
    editable: false,
  }
}

/** 文本归一：空白折叠，避免"多一个空格"就认不出是同一条。 */
export function normalizeQueueText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** 只给测试用：清空仓。 */
export function resetSessionStoreForTest(): void {
  entries.clear()
}
