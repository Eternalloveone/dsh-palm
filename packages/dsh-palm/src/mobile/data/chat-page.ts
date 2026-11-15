/**
 * 一次聊天页读取（尾页直读 → 宿主权威页 → 原始历史兜底）与它消费的形状。
 *
 * S5c 从 `views/App.tsx` 搬出。搬的理由不是文件行数：ChatView / use-chat-history /
 * history-page 都要用它，而它留在 App 里就逼着「视图 import App」——那条边正是那个
 * 十一文件大环的最后一段。这里只依赖 api / messages / 缓存，不依赖任何视图。
 */

import { history as fetchHistory, logTail, readChat, sessionState, turnOutlineOf, type ChatOpenExtras, type ChatOpenInclude, type ChatPage } from '../api.ts'
import { EventFolder, foldEvents, foldTodoSnapshot, lastOpenTurnStartTime, type RenderMessage, type TodoSnapshot } from '../render/messages.ts'
import type { SessionProjectionsBlock } from '../../api-proxy-types'
import { saveCachedHistory, loadCachedHistory } from '../session/history-cache.ts'
import { canSkipEntryRead, noteChatSynced } from '../session/chat-sync-ledger.ts'
import { preferredTailWindowBytes } from '../platform/entry-perf.ts'
import { getCachedOutline, setCachedOutline } from '../session/outline-cache.ts'

/** One folded chat page as the surface consumes it (any source). */
export interface ChatPageResult {
  rows: RenderMessage[]
  /** Event-seq watermark (replay floor for restoring the live folder). */
  maxSeq: number
  hasMore: boolean
  todo?: TodoSnapshot
  projections?: SessionProjectionsBlock
  /** The running turn's logged `turn/start` time (epoch ms), when the tail
   *  window holds an open turn boundary — the turn-clock anchor (desktop
   *  parity). Only the tail page may carry it (an older page's boundary is
   *  not the open one). */
  turnStartAt?: number
  /** 同一次读取顺带回来的小目录（A）：只有请求了 include 的尾部读才会有。 */
  extras?: ChatOpenExtras
  /**
   * 首屏快照一起带回的目标投影（与行同一个切面）。
   *
   * 有它就不用再单独问 `mobile.goal` —— 目标条与正文同一帧到位，
   * 不会出现"正文已经在、目标条晚一步"的中间态。`null` 也是有效值（确认没有目标）。
   */
  goal?: unknown
  /** 目标的授权相位（armed / disarmed），与 goal 一起回来才有意义。 */
  goalActivation?: 'armed' | 'disarmed'
  /** 这份是原子快照（mobile.sessionState）给的，不是 logTail 单独取的。 */
  entrySnapshot?: boolean
  /** 日志里最后一条事件的宿主时间（尾页直读才有）。判「这一轮是不是被打断」要多一条
   *  静默证据：名单说不跑 + 日志彻底静默，才算死掉；只有名单说不跑可能只是名单滞后。 */
  lastEventAt?: number
}

/** The fallback fold of a raw history page (host lacks/refused readChat). */
function foldHistoryPage(page: Awaited<ReturnType<typeof fetchHistory>>, isTail: boolean): ChatPageResult {
  const events = page.events.map(entry => (
    { ...entry.event, ...(entry.view !== undefined ? { view: entry.view } : {}) }
  ))
  const folder = new EventFolder(foldEvents(events))
  // Fold the todo state under the host projection's turn-boundary rules
  // (turn/start clears, turn/end normalizes in_progress leftovers) — the
  // local fallback must match the host window service's seed exactly, so a
  // reopened session never shows an intermediate snapshot the projection
  // already resolved.
  const todo = foldTodoSnapshot(events)
  const turnStartAt = lastOpenTurnStartTime(events)
  return {
    rows: folder.snapshot(),
    maxSeq: folder.lastSeq,
    hasMore: page.hasMore,
    ...(todo === undefined ? {} : { todo }),
    ...(isTail && turnStartAt !== undefined ? { turnStartAt } : {}),
    ...(page.projections === undefined ? {} : { projections: page.projections }),
  }
}

/** 宿主权威折叠页 → 界面消费的形状（三条读取路径共用）。 */
function foldChatPage(page: ChatPage, isTail: boolean): ChatPageResult {
  return {
    rows: page.rows,
    maxSeq: page.maxSeq,
    hasMore: page.hasMore,
    ...(page.todo === undefined ? {} : { todo: page.todo }),
    ...(page.projections === undefined ? {} : { projections: page.projections }),
    ...(isTail && page.turnStartAt !== undefined ? { turnStartAt: page.turnStartAt } : {}),
    ...(page.extras === undefined ? {} : { extras: page.extras }),
  }
}

/** 尾部直读之后，多久才去宿主补权威页（避开首屏那段弱网带宽）。 */
const HOST_REFRESH_DELAY_MS = 1_500

/**
 * Fetch one folded chat page (v3): `mobile.readChat` first (host-folded
 * rows, mux-fed window cache), with an automatic fallback to the raw
 * `session.history` + local fold when the host answers unavailable or the
 * read fails — the two paths converge on the same {@link ChatPageResult}
 * shape, so the surface never has to know which one served it.
 */
/**
 * 首屏（尾页）一次取多少行。
 *
 * 以前是 25 行，进会话之后再补 2~4 页「更早」并把列表往上一顶 —— 每补一页都要重排、
 * 重钉底，真机上就是「一进会话闪一下」或者「跳到前面某轮」。宿主这条路本来能到 200 行，
 * 一次取够就没有中途插入这回事：**一次请求、一次提交、一次钉底**。
 *
 * **2026-11-14：120 → 40。** 120 行是"一次取够"的理想值，但尾窗（512 KB / 2 MB）
 * 在长会话里装不下 120 行，客户端于是链式补 4 页才提交 —— 5 个串行来回、~570 KB，
 * 首屏 3.1~3.5 s（真机 4x CPU + 4G 实测）。而一屏只放得下 5~8 条消息：
 * 40 行已经覆盖 2~3 屏，再多只是省一次"往上滑"的请求。取 40 行 → 一个请求进会话。
 */
export const ENTRY_TAIL_ROWS = 16

/**
 * 首屏取数：**一个请求**拿齐行 + 目标 + 队列 + 回合。
 *
 * 为什么要它：以前首屏要 logTail（行）、mobile.goal（目标）、队列/回合另外两条，
 * 三四个请求落在不同时刻，屏幕就是被"逐次拼装"出来的 —— 任何两方时序不同都能看见中间态。
 * `mobile.sessionState` 本来就是为这件事设计的原子快照（行 + 队列 + 回合 + 目标同一个切面），
 * 只是行数写死在 25 行、当不了首屏；宿主侧已支持 `maxRows`，这里改成走它。
 *
 * 回退：老宿主忽略 `maxRows`（只回 25 行）或这条通道报错时，走原来的 logTail。
 *
 * @param sessionId - 会话 id
 * @param rows - 首屏要多少行
 * @param signal - 取消信号
 * @param windowBytes - 尾部字节窗口
 * @returns 可直接当首屏的页（含目标；失败时是 logTail 的结果）
 */
/**
 * 宿主是否支持"首屏快照带够行数"。
 *
 * `unknown` 时试一次，按结果定成 yes/no 并**记住**：老宿主忽略 `maxRows` 只回一页，
 * 不记住的话每次进会话都白打一个请求（实测那会让首屏反而更慢）。
 * 只在模块生命周期内记住：宿主升级后刷新页面就会重新试。
 */
let entrySupport: 'unknown' | 'yes' | 'no' = 'unknown'

/**
 * 连续几次「请求 40 行却只回 25 行」：老宿主的特征就是这个固定一页。
 *
 * 2026-11-14 修（「切来切去都卡」的真因）：原判据是 `entryRows.length >= Math.min(rows, 40)`，
 * 把**任何本身不足 40 行的会话**都当成「老宿主不支持 maxRows」—— 而手机上大量会话就几十条
 * 消息，于是切到第一个短会话就把 `entrySupport` 钉成 `'no'`，本次页面生命周期剩下的每一次
 * 切换都改走 logTail（再整份拉一遍 `session.history`，几十 KB），跟会话大小彻底无关地一直慢。
 *
 * 现在只认老宿主那一个特征（忽略 `maxRows`、固定回 25 行），而且要连续两次才永久降级 ——
 * 会话本身正好 25 行时不至于被冤枉。命中的那一次仍然补一次 logTail，老宿主行为不变（多打一次）。
 */
let pagedStrikes = 0

/** 测试用：忘掉支持度结论。 */
export function resetEntrySupportForTest(): void {
  entrySupport = 'unknown'
  pagedStrikes = 0
}

async function entryOrTail(
  sessionId: string,
  rows: number,
  signal: AbortSignal | undefined,
  windowBytes: number,
): Promise<ChatPageResult> {
  if (entrySupport === 'no') {
    const tail = await logTail(sessionId, rows, signal, windowBytes)
    return foldChatPage(tail, true)
  }
  try {
    const entry = await sessionState(sessionId, { maxRows: rows, windowBytes })
    const entryRows = entry.rows
    // 老宿主会忽略 maxRows 只回一页（25 行）：那不算"取够"，补一次 logTail 把行数拉回来。
    if (Array.isArray(entryRows) && entryRows.length > 0) {
      /*
       * 判「宿主支不支持 maxRows」：只看它是不是**固定回一页 25 行**。判据用「要的不是 25 行
       * 却回 25 行」，别写「要的行数 > 25」—— 首屏行数会随视觉预算调整（2026-11-15 40→16），
       * 写死大小关系会让老宿主检测静默失效，那是全局降级、每次切换都慢。
       */
      const looksPaged = rows !== 25 && entryRows.length === 25
      pagedStrikes = looksPaged ? pagedStrikes + 1 : 0
      if (looksPaged) {
        if (pagedStrikes >= 2) entrySupport = 'no'
        const tail = await logTail(sessionId, rows, signal, windowBytes)
        return foldChatPage(tail, true)
      }
      entrySupport = 'yes'
      return {
        rows: entryRows,
        maxSeq: entry.maxSeq,
        hasMore: entry.hasMore === true,
        ...(entry.todo === undefined ? {} : { todo: entry.todo as TodoSnapshot }),
        ...(entry.projections === undefined
          ? {}
          : { projections: entry.projections as SessionProjectionsBlock }),
        ...(entry.turn?.turnStartAt === undefined ? {} : { turnStartAt: entry.turn.turnStartAt }),
        ...(entry.turn?.lastEventAt === undefined ? {} : { lastEventAt: entry.turn.lastEventAt }),
        goal: entry.goal,
        ...(entry.goalActivation === undefined ? {} : { goalActivation: entry.goalActivation }),
        entrySnapshot: true,
      }
    }
  } catch {
    // 老宿主没有这条通道 / 参数不被识别：静默回退，不让首屏失败。
  }
  const tail = await logTail(sessionId, rows, signal, windowBytes)
  return foldChatPage(tail, true)
}

export async function loadChatPage(
  sessionId: string,
  beforeSeq?: number,
  signal?: AbortSignal,
  include?: readonly ChatOpenInclude[],
  onAuthority?: (page: ChatPageResult) => void,
  // 锚定页的行数：搜索跳到深历史时，默认 25 行（原始事件）折叠后只剩七八行，
  // 目标行常常正好落在窗口外，于是「翻了一页却没到那条命中」。
  maxRows?: number,
): Promise<ChatPageResult> {
  const isTail = beforeSeq === undefined
  // C：尾部直读优先。宿主冷读要整文件解压一个 zstd 帧序列（大会话 4 s 起），
  // 而尾部几十帧只要几十毫秒，折叠也在宿主侧做好了。
  if (isTail) {
    /**
     * **切回来就是立刻**（2026-11-14）：这一场在本次页面生命周期里刚同步过、
     * 之后一条帧都没来过 —— 本地那份就是当前状态，不必再问宿主（那次读取
     * 在宿主单线程里要 500~900ms，正好是用户点完会话等的那段）。
     * 判据与三条保守约束见 `session/chat-sync-ledger.ts`。
     */
    if (canSkipEntryRead(sessionId)) {
      const cached = await loadCachedHistory<ChatPageResult>(sessionId)
      if (cached !== undefined && Array.isArray(cached.rows) && cached.rows.length > 0) {
        return cached
      }
    }
    try {
      // 首屏一次取够：以前尾页只给 25 行，进会话后再补 2~4 页「更早」，
      // 每补一页都把列表往上一顶 —— 真机上就是「一进会话闪一下 / 跳到前面某轮」。
      // 宿主这条路本来就能到 200 行，一次取回就没有中途插入这回事了。
      const fast = await entryOrTail(sessionId, maxRows ?? ENTRY_TAIL_ROWS, signal, preferredTailWindowBytes())
      // 快路径的结果先落缓存：下一次打开直接命中，不必再解日志。
      void saveCachedHistory(sessionId, fast)
      // 账本：这一场从网络同步过了（之后有没有新帧由 ChatView 的帧订阅记账）。
      noteChatSynced(sessionId)
      // 宿主的权威页只在首屏还缺东西时才补。一次 readChat 在大会话上要
      // 14~15 秒，而宿主解压是单线程的：那段时间手机端所有请求都在排队
      // （实测 session.list 从 5 ms 涨到 500 ms、日志尾读从 20 ms 涨到 1.7 秒），
      // 于是整台手机就"卡住了"，后台补读反而成了卡顿的来源。尾页已经带回
      // 首屏要用的投影，缺了才值得付这笔钱。
      // 轮次大纲不在尾页里（一个 87 KB），而下面的权威页只在"尾页完全没有投影"时才补：
      // 尾页一旦带上了权限/上下文投影，大纲就永远到不了手机 —— 轮次清单里只剩已
      // 加载的两三抡，用户以为导航坏了。这里单独补一次（宿主查花名册快照，不读日志）。
      if (fast.projections?.values?.['turnOutline'] === undefined) {
        // 同一份大纲五分钟内只下载一次：列表↔会话来回切是手机端最频繁的动作，
        // 每次都拉几十 KB 在弱网下就是肉眼可见的一两秒（见 outline-cache）。
        const reportOutline = (turns: unknown): void => {
          const base = fast.projections
          // 没有投影基线时走下面的权威页分支（那条路会连大纲一起带回来）。
          if (base === undefined) return
          onAuthority?.({
            ...fast,
            projections: { ...base, values: { ...(base.values ?? {}), turnOutline: turns } },
          })
        }
        const cachedOutline = getCachedOutline(sessionId)
        if (cachedOutline !== undefined) {
          reportOutline(cachedOutline)
        } else {
          void turnOutlineOf(sessionId).then(
            (value) => {
              if (signal?.aborted === true || value?.turns === null || value?.turns === undefined) return
              setCachedOutline(sessionId, value.turns)
              reportOutline(value.turns)
            },
            () => undefined,
          )
        }
      }
      if (fast.projections === undefined) {
        window.setTimeout(() => {
          if (signal?.aborted === true) return
          void readChat(sessionId, undefined, maxRows, signal, include).then(
            (page) => {
              const authority = foldChatPage(page, true)
              void saveCachedHistory(sessionId, authority)
              // 权威页带着尾页没有的投影（轮次大纲之类）：回流给界面，让它在首屏
              // 之后悄悄补齐，而不是等到下次打开。
              if (signal?.aborted !== true) onAuthority?.(authority)
            },
            () => undefined,
          )
        }, HOST_REFRESH_DELAY_MS)
      }
      return fast
    } catch {
      // 旧宿主没有这条通道，或者日志不在预期位置：走原来的路径。
      signal?.throwIfAborted()
      try {
        return foldChatPage(await readChat(sessionId, undefined, maxRows, signal, include), true)
      } catch {
        return foldHistoryPage(await fetchHistory(sessionId, undefined, undefined, signal), true)
      }
    }
  }
  let result: ChatPageResult
  try {
    const page: ChatPage = await readChat(sessionId, beforeSeq, maxRows, signal, include)
    result = foldChatPage(page, isTail)
  } catch {
    // Fallback: the raw event page folded locally (identical shape). Any
    // failure of THIS path propagates to the caller's own error handling.
    result = foldHistoryPage(await fetchHistory(sessionId, beforeSeq, maxRows, signal), isTail)
  }
  // Cache the tail page so a reopen paints instantly (stale-while-revalidate);
  // best-effort — a storage failure never blocks the chat.
  if (isTail) void saveCachedHistory(sessionId, result)
  return result
}
