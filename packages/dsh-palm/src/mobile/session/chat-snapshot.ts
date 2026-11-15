/**
 * 进会话第一帧用的内存快照 + 已解析交付卡的记忆：把**上一次画过的行**按会话同步存着，
 * 再进来第一帧就是内容（否则首帧必然空一帧：缓存页走 IndexedDB、网络页再一个往返）。
 *
 * 两张表都是**按会话分槽 + 最近最少使用淘汰**，实现只留一份（{@link createScopedStore}）：
 * 这类表的退役/清场写错一处，上一场的数据就会在下一场被读到（真机 2026-11-14 19:52 的
 * 幽灵交付卡就是这个形态）。
 */
import type { RenderMessage } from '../render/messages.ts'
import { turnKeyOf } from './deliveries.ts'

/** 留几场会话：与 `stream/session-store.ts` 的 8 对齐。 */
const MAX_SESSIONS = 8
/** 每场留多少行：够铺满首屏并留出上翻余量，再多交给分页。 */
const MAX_ROWS = 240
/** 交付卡缓存留几场：每场一张 turn→卡 的表，比行快照重。 */
const MAX_REPORT_SESSIONS = 4

/**
 * 会话分槽仓库：按 scope 存取，超出上限淘汰最久没写过的槽。**换会话不清空**（每场一格，
 * 回到上一场第一帧就能用），所以任何写入都必须带**算它时的那个会话 id**。
 */
export interface ScopedStore<T> {
  get(scope: string): T | undefined
  set(scope: string, value: T): void
  delete(scope: string): void
  size(): number
  clear(): void
}

/** 造一个会话分槽仓库（`limit` = 最多留几场）。 */
export function createScopedStore<T>(limit: number): ScopedStore<T> {
  const slots = new Map<string, T>()
  const set = (scope: string, value: T): void => {
    slots.delete(scope)
    slots.set(scope, value)
    while (slots.size > limit) {
      const oldest = slots.keys().next()
      if (oldest.done === true) break
      slots.delete(oldest.value)
    }
  }
  return {
    get: scope => slots.get(scope),
    set,
    delete: scope => { slots.delete(scope) },
    size: () => slots.size,
    clear: () => { slots.clear() },
  }
}

/** 一场会话上次画出来的样子。 */
interface ChatSnapshot { rows: RenderMessage[]; hasOlder: boolean }

const snapshots = createScopedStore<ChatSnapshot>(MAX_SESSIONS)

/** 记下这一场当前画出来的样子（空表不记，否则二次挂载会跳过加载态）。 */
export function rememberChatSnapshot(sessionId: string, rows: RenderMessage[], hasOlder: boolean): void {
  if (sessionId === '' || rows.length === 0) return
  const kept = rows.length > MAX_ROWS ? rows.slice(rows.length - MAX_ROWS) : [...rows]
  snapshots.set(sessionId, { rows: kept, hasOlder })
}

/** 取这一场上一次画出来的样子；没打开过就是 undefined。 */
export function recallChatSnapshot(sessionId: string): ChatSnapshot | undefined {
  const found = snapshots.get(sessionId)
  return found !== undefined && found.rows.length > 0 ? found : undefined
}

export function forgetChatSnapshot(sessionId: string): void { snapshots.delete(sessionId) }
export function clearChatSnapshots(): void { snapshots.clear() }

/** 已解析的交付卡：键 = `sessionId#turn`（turn 号每场都从 1 起，单用 turn 会串场）。 */
const turnReports = createScopedStore<Map<string, RenderMessage>>(MAX_REPORT_SESSIONS)

export function rememberTurnReports(sessionId: string, cards: readonly RenderMessage[]): void {
  if (sessionId === '' || cards.length === 0) return
  const existing = turnReports.get(sessionId) ?? new Map<string, RenderMessage>()
  for (const card of cards) {
    if (card.kind !== 'turn' || card.turn === undefined) continue
    existing.set(turnKeyOf(sessionId, card.turn), card)
  }
  turnReports.set(sessionId, existing)
}

export function recallTurnReports(sessionId: string, turns: readonly number[]): RenderMessage[] {
  const cached = turnReports.get(sessionId)
  if (cached === undefined || turns.length === 0) return []
  const picked: RenderMessage[] = []
  for (const turn of turns) {
    const card = cached.get(turnKeyOf(sessionId, turn))
    if (card !== undefined) picked.push(card)
  }
  return picked
}

export function clearTurnReportCache(): void { turnReports.clear() }
